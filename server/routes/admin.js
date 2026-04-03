import { Router } from 'express';
import { dbGet, dbAll, dbRun, dbExec, getAllConfig, setConfig } from '../db/init.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { clearCache } from '../services/oidc.js';
import { deleteFile } from '../services/storage.js';

const router = Router();
const SECRET = () => process.env.SESSION_SECRET || 'dev-secret';

// ===================== Dashboard =====================
router.get('/dashboard', requireAuth, requireRole('admin'), (req, res) => {
  const stats = {
    total_users: dbGet('SELECT COUNT(*) as c FROM users').c,
    total_images: dbGet('SELECT COUNT(*) as c FROM images').c,
    approved_images: dbGet("SELECT COUNT(*) as c FROM images WHERE status = 'approved'").c,
    pending_images: dbGet("SELECT COUNT(*) as c FROM images WHERE status = 'pending'").c,
    rejected_images: dbGet("SELECT COUNT(*) as c FROM images WHERE status = 'rejected'").c,
    total_tags: dbGet('SELECT COUNT(*) as c FROM tags').c,
    total_categories: dbGet('SELECT COUNT(*) as c FROM categories').c,
    storage_used_bytes: dbGet("SELECT COALESCE(SUM(file_size), 0) as s FROM images WHERE storage_type = 'local'").s,
  };

  const recent_uploads = dbAll(
    `SELECT i.id, i.title, i.thumbnail_path as thumbnail_url, i.file_path as image_url, i.status, i.created_at, u.username, u.avatar_url
     FROM images i JOIN users u ON i.user_id = u.id ORDER BY i.created_at DESC LIMIT 10`
  ).map(r => ({
    ...r, thumbnail_url: r.thumbnail_url || r.image_url,
    user: { username: r.username, avatar_url: r.avatar_url },
  }));

  const top_uploaders = dbAll(
    `SELECT u.id as user_id, u.username, u.avatar_url, COUNT(i.id) as upload_count
     FROM users u JOIN images i ON u.id = i.user_id GROUP BY u.id ORDER BY upload_count DESC LIMIT 10`
  );

  res.json({ stats, recent_uploads, top_uploaders });
});

// ===================== OIDC CRUD =====================
router.get('/oidc', requireAuth, requireRole('admin'), (req, res) => {
  const rows = dbAll('SELECT * FROM oidc_providers ORDER BY id');
  res.json(rows.map(r => ({ ...r, client_secret: '******', enabled: !!r.enabled })));
});

router.post('/oidc', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, display_name, icon_url, issuer_url, client_id, client_secret, scopes, redirect_uri, userinfo_endpoint, field_mapping, auto_trust_level } = req.body;
    if (!name || !display_name || !issuer_url || !client_id || !client_secret || !redirect_uri) {
      return res.status(422).json({ error: '缺少必填字段' });
    }

    const encryptedSecret = encrypt(client_secret, SECRET());
    const fieldMappingStr = field_mapping ? (typeof field_mapping === 'string' ? field_mapping : JSON.stringify(field_mapping)) : null;

    const result = dbRun(
      `INSERT INTO oidc_providers (name, display_name, icon_url, issuer_url, client_id, client_secret, scopes, redirect_uri, userinfo_endpoint, field_mapping, auto_trust_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, display_name, icon_url || null, issuer_url, client_id, encryptedSecret,
      scopes || 'openid profile email', redirect_uri, userinfo_endpoint || null,
      fieldMappingStr, auto_trust_level || 3
    );
    const created = dbGet('SELECT * FROM oidc_providers WHERE id = ?', result.lastInsertRowid);
    res.status(201).json({ ...created, client_secret: '******', enabled: !!created.enabled });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(422).json({ error: 'Provider name 已存在' });
    next(e);
  }
});

router.put('/oidc/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = dbGet('SELECT * FROM oidc_providers WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: 'Provider 不存在' });

  const { display_name, icon_url, issuer_url, client_id, client_secret, scopes, redirect_uri, userinfo_endpoint, field_mapping, auto_trust_level, enabled } = req.body;
  const updates = []; const params = [];

  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (icon_url !== undefined) { updates.push('icon_url = ?'); params.push(icon_url); }
  if (issuer_url !== undefined) { updates.push('issuer_url = ?'); params.push(issuer_url); clearCache(existing.issuer_url); }
  if (client_id !== undefined) { updates.push('client_id = ?'); params.push(client_id); }
  if (client_secret) { updates.push('client_secret = ?'); params.push(encrypt(client_secret, SECRET())); }
  if (scopes !== undefined) { updates.push('scopes = ?'); params.push(scopes); }
  if (redirect_uri !== undefined) { updates.push('redirect_uri = ?'); params.push(redirect_uri); }
  if (userinfo_endpoint !== undefined) { updates.push('userinfo_endpoint = ?'); params.push(userinfo_endpoint); }
  if (field_mapping !== undefined) { updates.push('field_mapping = ?'); params.push(typeof field_mapping === 'string' ? field_mapping : JSON.stringify(field_mapping)); }
  if (auto_trust_level !== undefined) { updates.push('auto_trust_level = ?'); params.push(auto_trust_level); }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }

  if (updates.length > 0) {
    params.push(id);
    dbRun(`UPDATE oidc_providers SET ${updates.join(', ')} WHERE id = ?`, ...params);
  }

  const updated = dbGet('SELECT * FROM oidc_providers WHERE id = ?', id);
  res.json({ ...updated, client_secret: '******', enabled: !!updated.enabled });
});

router.delete('/oidc/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = dbGet('SELECT * FROM oidc_providers WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: 'Provider 不存在' });
  clearCache(existing.issuer_url);
  dbRun('DELETE FROM oidc_providers WHERE id = ?', id);
  res.json({ ok: true });
});

// ===================== 用户管理 =====================
router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const q = req.query.q || null;
  const role = req.query.role || null;

  let where = []; let params = [];
  if (q) { where.push("(u.username LIKE ? OR u.email LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (role) { where.push("u.role = ?"); params.push(role); }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = dbGet(`SELECT COUNT(*) as c FROM users u ${whereClause}`, ...params).c;
  const rows = dbAll(
    `SELECT u.id, u.username, u.email, u.avatar_url, u.role, u.oidc_provider, u.oidc_sub, u.oidc_trust_level, u.created_at, u.is_banned,
            (SELECT COUNT(*) FROM images WHERE user_id = u.id) as upload_count
     FROM users u ${whereClause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  res.json({
    data: rows.map(u => ({ ...u, is_banned: !!u.is_banned })),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  });
});

router.put('/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body;
  if (!['user', 'trusted', 'admin'].includes(role)) return res.status(422).json({ error: '无效的角色' });
  if (id === req.user.id && role !== 'admin') return res.status(422).json({ error: '不能降级自己' });
  const target = dbGet('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  dbRun('UPDATE users SET role = ? WHERE id = ?', role, id);
  res.json({ ok: true });
});

router.put('/users/:id/ban', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const { is_banned } = req.body;
  if (id === req.user.id) return res.status(422).json({ error: '不能封禁自己' });
  const target = dbGet('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  dbRun('UPDATE users SET is_banned = ? WHERE id = ?', is_banned ? 1 : 0, id);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(422).json({ error: '不能删除自己' });
  const target = dbGet('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const images = dbAll("SELECT * FROM images WHERE user_id = ? AND storage_type = 'local'", id);
  for (const img of images) { deleteFile(img.file_path); deleteFile(img.thumbnail_path); }

  // 收集受影响的 tag id
  const affectedTagIds = dbAll('SELECT DISTINCT it.tag_id FROM image_tags it JOIN images i ON it.image_id = i.id WHERE i.user_id = ?', id).map(r => r.tag_id);

  // 级联删除用户及其所有关联数据
  dbRun('DELETE FROM users WHERE id = ?', id);

  // 局部更新受影响 tag
  for (const tid of affectedTagIds) {
    dbRun('UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE tag_id = ?) WHERE id = ?', tid, tid);
  }
  res.json({ ok: true });
});

// ===================== 内容审核（trusted + admin）=====================
router.get('/images', requireAuth, requireRole('trusted', 'admin'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 24);
  const offset = (page - 1) * limit;
  const status = req.query.status || 'pending';

  let where = []; let params = [];
  if (status !== 'all') { where.push('i.status = ?'); params.push(status); }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = dbGet(`SELECT COUNT(*) as c FROM images i ${whereClause}`, ...params).c;
  const rows = dbAll(
    `SELECT i.*, u.username, u.avatar_url FROM images i JOIN users u ON i.user_id = u.id ${whereClause} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  let tagMap = {};
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    const ph = ids.map(() => '?').join(',');
    const tagRows = dbAll(`SELECT it.image_id, t.name FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE it.image_id IN (${ph})`, ...ids);
    for (const tr of tagRows) { if (!tagMap[tr.image_id]) tagMap[tr.image_id] = []; tagMap[tr.image_id].push(tr.name); }
  }

  res.json({
    data: rows.map(r => ({
      id: r.id, title: r.title, thumbnail_url: r.thumbnail_path || r.file_path, image_url: r.file_path,
      tags: tagMap[r.id] || [], raw_tags: r.raw_tags, status: r.status, created_at: r.created_at,
      user: { id: r.user_id, username: r.username, avatar_url: r.avatar_url },
    })),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  });
});

router.put('/images/:id/review', requireAuth, requireRole('trusted', 'admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(422).json({ error: '状态只能是 approved 或 rejected' });
  const image = dbGet('SELECT * FROM images WHERE id = ?', id);
  if (!image) return res.status(404).json({ error: '图片不存在' });
  dbRun("UPDATE images SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?", status, req.user.id, id);
  res.json({ ok: true });
});

router.put('/images/batch-review', requireAuth, requireRole('trusted', 'admin'), (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(422).json({ error: '请提供图片 ID 列表' });
  if (!['approved', 'rejected'].includes(status)) return res.status(422).json({ error: '状态只能是 approved 或 rejected' });

  for (const id of ids) {
    dbRun("UPDATE images SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?", status, req.user.id, id);
  }
  res.json({ ok: true, count: ids.length });
});

router.delete('/images/:id', requireAuth, requireRole('trusted', 'admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const image = dbGet('SELECT * FROM images WHERE id = ?', id);
  if (!image) return res.status(404).json({ error: '图片不存在' });

  if (image.storage_type === 'local') {
    deleteFile(image.file_path);
    if (image.thumbnail_path) deleteFile(image.thumbnail_path);
  }

  const affectedTagIds = dbAll('SELECT tag_id FROM image_tags WHERE image_id = ?', id).map(r => r.tag_id);
  dbRun('DELETE FROM images WHERE id = ?', id);
  for (const tid of affectedTagIds) {
    dbRun('UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE tag_id = ?) WHERE id = ?', tid, tid);
  }
  
  res.json({ ok: true });
});

// ===================== 站点配置 =====================
router.get('/config', requireAuth, requireRole('admin'), (req, res) => {
  res.json(getAllConfig());
});

router.put('/config', requireAuth, requireRole('admin'), (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(422).json({ error: '无效的配置数据' });
  for (const [key, value] of Object.entries(updates)) { setConfig(key, value); }
  res.json(getAllConfig());
});

export default router;
