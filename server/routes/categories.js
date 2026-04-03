import { Router } from 'express';
import { dbGet, dbAll, dbRun } from '../db/init.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/categories
router.get('/', (req, res) => {
  const rows = dbAll(`
    SELECT c.*,
      (SELECT COUNT(DISTINCT it.image_id)
       FROM image_tags it JOIN tags t ON it.tag_id = t.id JOIN images i ON it.image_id = i.id
       WHERE t.category_id = c.id AND i.status = 'approved'
      ) as image_count
    FROM categories c ORDER BY c.sort_order ASC, c.id ASC
  `);
  res.json(rows);
});

// POST /api/categories
router.post('/', requireAuth, requireRole('admin', 'trusted'), (req, res) => {
  const { name, slug, description, cover_url, sort_order } = req.body;
  if (!name || !slug) return res.status(422).json({ error: '名称和 slug 不能为空' });

  const existing = dbGet('SELECT id FROM categories WHERE slug = ?', slug);
  if (existing) return res.status(422).json({ error: 'slug 已存在' });

  const result = dbRun(
    'INSERT INTO categories (name, slug, description, cover_url, sort_order) VALUES (?, ?, ?, ?, ?)',
    name, slug, description || null, cover_url || null, sort_order || 0
  );
  const category = dbGet('SELECT * FROM categories WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(category);
});

// PUT /api/categories/:id
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const cat = dbGet('SELECT * FROM categories WHERE id = ?', id);
  if (!cat) return res.status(404).json({ error: '分类不存在' });

  const { name, slug, description, cover_url, sort_order } = req.body;
  if (slug && slug !== cat.slug) {
    const existing = dbGet('SELECT id FROM categories WHERE slug = ? AND id != ?', slug, id);
    if (existing) return res.status(422).json({ error: 'slug 已存在' });
  }

  dbRun(
    'UPDATE categories SET name = COALESCE(?, name), slug = COALESCE(?, slug), description = COALESCE(?, description), cover_url = COALESCE(?, cover_url), sort_order = COALESCE(?, sort_order) WHERE id = ?',
    name || null, slug || null, description, cover_url, sort_order, id
  );
  const updated = dbGet('SELECT * FROM categories WHERE id = ?', id);
  res.json(updated);
});

// DELETE /api/categories/:id
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const cat = dbGet('SELECT * FROM categories WHERE id = ?', id);
  if (!cat) return res.status(404).json({ error: '分类不存在' });

  dbRun('UPDATE tags SET category_id = NULL WHERE category_id = ?', id);
  dbRun('DELETE FROM categories WHERE id = ?', id);
  res.json({ ok: true });
});

export default router;
