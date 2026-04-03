import { Router } from 'express';
import { dbGet, dbAll } from '../db/init.js';

const router = Router();

// GET /api/tags
router.get('/', (req, res) => {
  const sort = req.query.sort || 'count';
  const category = req.query.category || null;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];

  if (category) { where.push('c.slug = ?'); params.push(category); }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = sort === 'name' ? 't.name ASC' : 't.use_count DESC';

  const total = dbGet(`SELECT COUNT(*) as c FROM tags t LEFT JOIN categories c ON t.category_id = c.id ${whereClause}`, ...params).c;

  const rows = dbAll(
    `SELECT t.id, t.name, t.category_id, c.slug as category_slug, t.use_count FROM tags t LEFT JOIN categories c ON t.category_id = c.id ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  res.json({ data: rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
});

// GET /api/tags/popular
router.get('/popular', (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const rows = dbAll('SELECT id, name, use_count FROM tags WHERE use_count > 0 ORDER BY use_count DESC LIMIT ?', limit);
  res.json(rows);
});

// GET /api/tags/search
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const rows = dbAll("SELECT id, name, use_count FROM tags WHERE name LIKE ? ORDER BY use_count DESC LIMIT 10", `${q}%`);
  res.json(rows);
});

export default router;
