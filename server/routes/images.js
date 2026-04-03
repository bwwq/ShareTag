import { Router } from 'express';
import { dbGet, dbAll, dbRun, getConfig } from '../db/init.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { extractTags, cleanTag } from '../services/metadata.js';
import { getImageMeta, compressIfNeeded, generateThumbnail, saveImage, deleteFile } from '../services/storage.js';
import { validateImageUrl } from '../services/urlValidator.js';

const router = Router();

// 归一化客户端 IP（配合 app.set('trust proxy', 'loopback') 后安全获取真实 IP）
function getClientIp(req) {
  let ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (ip === '::1') ip = '127.0.0.1';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function parseTags(rawTags) {
  if (!rawTags) return [];
  return rawTags.split(',')
    .map(t => cleanTag(t))
    .filter(t => t && t.length > 0 && t.length < 100);
}

function syncImageTags(imageId, tagNames, categorySlug = null) {
  dbRun('DELETE FROM image_tags WHERE image_id = ?', imageId);
  if (tagNames.length === 0) return;

  let categoryId = null;
  if (categorySlug) {
    const cat = dbGet('SELECT id FROM categories WHERE slug = ?', categorySlug);
    if (cat) categoryId = cat.id;
  }

  for (const name of tagNames) {
    if (categoryId) {
      dbRun('INSERT OR IGNORE INTO tags (name, category_id) VALUES (?, ?)', name, categoryId);
      dbRun('UPDATE tags SET category_id = ? WHERE name = ? AND category_id IS NULL', categoryId, name);
    } else {
      dbRun('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
    }
    const tag = dbGet('SELECT id FROM tags WHERE name = ?', name);
    if (tag) dbRun('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)', imageId, tag.id);
  }

  // 更新全局 use_count
  dbRun('UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE tag_id = tags.id)');
}

function formatImage(img, tags) {
  return {
    id: img.id,
    title: img.title,
    description: img.description,
    image_url: img.file_path,
    thumbnail_url: img.thumbnail_path || img.file_path,
    storage_type: img.storage_type,
    width: img.width,
    height: img.height,
    file_size: img.file_size,
    raw_tags: img.raw_tags,
    tags: tags || [],
    likes: img.likes || 0,
    views: img.views || 0,
    status: img.status,
    is_nsfw: img.is_nsfw ?? 1,
    prompt_text: img.prompt_text,
    negative_prompt_text: img.negative_prompt_text,
    created_at: img.created_at,
    user: img.username ? { id: img.user_id, username: img.username, avatar_url: img.avatar_url } : undefined,
  };
}

// GET /api/images
router.get('/', optionalAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || (getConfig('images_per_page') || 24)));
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'latest';
  const tag = req.query.tag || null;
  const category = req.query.category || null;
  const userId = req.query.user_id ? parseInt(req.query.user_id) : null;
  const q = req.query.q || null;

  let status = 'approved';
  if (req.query.status) {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'trusted')) {
      status = req.query.status;
    } else if (req.user && userId === req.user.id) {
      status = req.query.status;
    }
  }

  // 构建 SQL（sql.js 不支持命名参数，用 ? 占位）
  let where = [];
  let params = [];

  // 未登录用户不展示 NSFW 内容
  if (!req.user) { where.push('i.is_nsfw = 0'); }

  if (status !== 'all') { where.push('i.status = ?'); params.push(status); }
  if (userId) { where.push('i.user_id = ?'); params.push(userId); }
  if (q) { where.push("(i.title LIKE ? OR i.raw_tags LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }

  if (tag) {
    const tagNames = tag.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tagNames.length > 0) {
      const ph = tagNames.map(() => '?').join(',');
      where.push(`i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE t.name IN (${ph}) GROUP BY it.image_id HAVING COUNT(DISTINCT t.name) = ?)`);
      params.push(...tagNames, tagNames.length);
    }
  }

  if (category) {
    where.push(`i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE t.category_id = (SELECT id FROM categories WHERE slug = ?))`);
    params.push(category);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  let orderBy = 'i.created_at DESC';
  if (sort === 'popular') orderBy = 'i.likes DESC, i.created_at DESC';
  if (sort === 'random') orderBy = 'RANDOM()';

  const total = dbGet(`SELECT COUNT(*) as total FROM images i ${whereClause}`, ...params).total;

  const rows = dbAll(
    `SELECT i.*, u.username, u.avatar_url FROM images i JOIN users u ON i.user_id = u.id ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  // 批量加载 tags
  let tagMap = {};
  if (rows.length > 0) {
    const imageIds = rows.map(r => r.id);
    const ph = imageIds.map(() => '?').join(',');
    const tagRows = dbAll(`SELECT it.image_id, t.name FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE it.image_id IN (${ph})`, ...imageIds);
    for (const tr of tagRows) {
      if (!tagMap[tr.image_id]) tagMap[tr.image_id] = [];
      tagMap[tr.image_id].push(tr.name);
    }
  }

  res.json({
    data: rows.map(r => formatImage(r, tagMap[r.id] || [])),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  });
});

// GET /api/images/:id
router.get('/:id', optionalAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const image = dbGet('SELECT i.*, u.username, u.avatar_url FROM images i JOIN users u ON i.user_id = u.id WHERE i.id = ?', id);
  if (!image) return res.status(404).json({ error: '图片不存在' });

  if (image.status !== 'approved') {
    if (!req.user || (req.user.id !== image.user_id && req.user.role === 'user')) {
      return res.status(404).json({ error: '图片不存在' });
    }
  }

  // 未登录用户不能查看 NSFW 内容
  if (image.is_nsfw && !req.user) {
    return res.status(403).json({ error: '请登录后查看该内容' });
  }

  // 增加浏览量
  dbRun('UPDATE images SET views = views + 1 WHERE id = ?', id);
  image.views = (image.views || 0) + 1;

  const tags = dbAll(
    'SELECT t.id, t.name, c.slug as category FROM image_tags it JOIN tags t ON it.tag_id = t.id LEFT JOIN categories c ON t.category_id = c.id WHERE it.image_id = ?',
    id
  );

  const related = dbAll(
    `SELECT i2.id, i2.title, i2.thumbnail_path as thumbnail_url, i2.file_path as image_url, COUNT(it2.tag_id) as shared_tags
     FROM image_tags it1 JOIN image_tags it2 ON it1.tag_id = it2.tag_id AND it2.image_id != ?
     JOIN images i2 ON it2.image_id = i2.id AND i2.status = 'approved'
     WHERE it1.image_id = ? GROUP BY i2.id ORDER BY shared_tags DESC LIMIT 8`,
    id, id
  );

  const result = formatImage(image, tags);
  result.related_images = related.map(r => ({ id: r.id, title: r.title, thumbnail_url: r.thumbnail_url || r.image_url }));
  if (req.user) {
    const bm = dbGet('SELECT 1 FROM bookmarks WHERE user_id = ? AND image_id = ?', req.user.id, id);
    result.bookmarked = !!bm;
  }
  // 按 IP 判断是否已点赞
  const clientIp = getClientIp(req);
  const liked = dbGet('SELECT 1 FROM image_likes WHERE image_id = ? AND ip_address = ?', id, clientIp);
  result.liked = !!liked;
  res.json(result);
});

// POST /api/images/:id/like（按 IP 去重）
router.post('/:id/like', optionalAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const clientIp = getClientIp(req);
  const existing = dbGet('SELECT 1 FROM image_likes WHERE image_id = ? AND ip_address = ?', id, clientIp);
  if (existing) return res.json({ ok: true, already_liked: true });
  dbRun('INSERT INTO image_likes (image_id, ip_address) VALUES (?, ?)', id, clientIp);
  dbRun('UPDATE images SET likes = likes + 1 WHERE id = ?', id);
  res.json({ ok: true });
});

// POST /api/images/:id/bookmark
router.post('/:id/bookmark', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  dbRun('INSERT OR IGNORE INTO bookmarks (user_id, image_id) VALUES (?, ?)', req.user.id, id);
  res.json({ bookmarked: true });
});

// DELETE /api/images/:id/bookmark
router.delete('/:id/bookmark', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  dbRun('DELETE FROM bookmarks WHERE user_id = ? AND image_id = ?', req.user.id, id);
  res.json({ bookmarked: false });
});

// POST /api/images/extract-tags
router.post('/extract-tags', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少文件' });
    const result = extractTags(req.file.buffer, req.file.mimetype);
    if (!result) return res.json({ extracted_tags: '' });
    res.json({
      extracted_tags: result.extracted_tags || '',
      extracted_negative_tags: result.extracted_negative_tags || '',
      prompt_text: result.prompt_text || '',
      negative_prompt_text: result.negative_prompt_text || ''
    });
  } catch (e) { next(e); }
});

// POST /api/images
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const user = req.user;
    const maxSizeMb = getConfig('max_upload_size_mb') || 20;
    const isUrlMode = !req.file && req.body.url;

    if (!req.file && !isUrlMode) {
      return res.status(400).json({ error: '请上传图片文件或提供图片 URL' });
    }

    let status = 'pending';
    if (['admin', 'trusted'].includes(user.role)) status = 'approved';
    else if (getConfig('upload_require_review') === false) status = 'approved';

    let imageId, autoExtracted = null, compressed = false;

    if (isUrlMode) {
      await validateImageUrl(req.body.url);
      const rawTags = parseTags(req.body.tags || '').join(', ');
      const promptText = req.body.prompt_text || null;
      const negativeText = req.body.negative_prompt_text || null;
      const isNsfw = req.body.is_nsfw !== undefined ? (req.body.is_nsfw === '0' || req.body.is_nsfw === false ? 0 : 1) : 1;
      const result = dbRun(
        `INSERT INTO images (user_id, title, description, storage_type, file_path, thumbnail_path, status, raw_tags, prompt_text, negative_prompt_text, is_nsfw) VALUES (?, ?, ?, 'url', ?, NULL, ?, ?, ?, ?, ?)`,
        user.id, req.body.title || null, req.body.description || null, req.body.url, status, rawTags, promptText, negativeText, isNsfw
      );
      imageId = result.lastInsertRowid;
      syncImageTags(imageId, parseTags(rawTags), req.body.category_slug);
    } else {
      const buffer = req.file.buffer;
      if (buffer.length > maxSizeMb * 1024 * 1024) {
        return res.status(413).json({ error: `文件超过 ${maxSizeMb}MB 限制` });
      }

      let rawTags = req.body.tags || '';
      let promptText = req.body.prompt_text || null;
      let negativeText = req.body.negative_prompt_text || null;
      
      if (!rawTags && req.body.auto_tags !== 'false') {
        const extracted = extractTags(buffer, req.file.mimetype);
        if (extracted) {
          rawTags = extracted.extracted_tags || '';
          if (!promptText) promptText = extracted.prompt_text;
          if (!negativeText) negativeText = extracted.negative_prompt_text;
          autoExtracted = rawTags;
        }
      }
      rawTags = parseTags(rawTags).join(', ');

      const meta = await getImageMeta(buffer);
      const comp = await compressIfNeeded(buffer, meta);
      compressed = comp.compressed;
      const thumb = await generateThumbnail(comp.buffer);
      const ext = comp.compressed ? (comp.format || 'webp') : (meta.format || 'png');
      const saved = await saveImage(comp.buffer, ext);

      const isNsfw = req.body.is_nsfw !== undefined ? (req.body.is_nsfw === '0' || req.body.is_nsfw === false ? 0 : 1) : 1;
      const result = dbRun(
        `INSERT INTO images (user_id, title, description, storage_type, file_path, thumbnail_path, width, height, file_size, status, raw_tags, prompt_text, negative_prompt_text, is_nsfw) VALUES (?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        user.id, req.body.title || req.file.originalname || null, req.body.description || null,
        saved.path, thumb.path, comp.width, comp.height, comp.size, status, rawTags, promptText, negativeText, isNsfw
      );
      imageId = result.lastInsertRowid;
      syncImageTags(imageId, parseTags(rawTags), req.body.category_slug);
    }

    const imageData = dbGet('SELECT * FROM images WHERE id = ?', imageId);
    res.status(201).json({
      id: imageData.id, title: imageData.title,
      image_url: imageData.file_path, thumbnail_url: imageData.thumbnail_path || imageData.file_path,
      status: imageData.status, extracted_tags: autoExtracted, compressed,
    });
  } catch (e) { next(e); }
});

// PUT /api/images/:id
router.put('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const image = dbGet('SELECT * FROM images WHERE id = ?', id);
    if (!image) return res.status(404).json({ error: '图片不存在' });
    if (image.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '无权修改' });

    const { title, description, tags, category_slug, is_nsfw } = req.body;
    const updates = []; const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (tags !== undefined) { updates.push('raw_tags = ?'); params.push(parseTags(tags).join(', ')); }
    if (is_nsfw !== undefined) { updates.push('is_nsfw = ?'); params.push(is_nsfw ? 1 : 0); }

    if (updates.length > 0) {
      params.push(id);
      dbRun(`UPDATE images SET ${updates.join(', ')} WHERE id = ?`, ...params);
    }
    if (tags !== undefined) syncImageTags(id, parseTags(tags), category_slug);

    const updated = dbGet('SELECT * FROM images WHERE id = ?', id);
    res.json(formatImage(updated, []));
  } catch (e) { next(e); }
});

// DELETE /api/images/:id
router.delete('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const image = dbGet('SELECT * FROM images WHERE id = ?', id);
  if (!image) return res.status(404).json({ error: '图片不存在' });
  if (image.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '无权删除' });

  if (image.storage_type === 'local') {
    deleteFile(image.file_path);
    deleteFile(image.thumbnail_path);
  }

  dbRun('DELETE FROM image_tags WHERE image_id = ?', id);
  dbRun('DELETE FROM images WHERE id = ?', id);
  dbRun('UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE tag_id = tags.id)');
  res.json({ ok: true });
});

export default router;
