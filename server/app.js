import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

import { initDb, dbGet, dbRun, dbExec } from './db/init.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import imageRoutes from './routes/images.js';
import tagRoutes from './routes/tags.js';
import categoryRoutes from './routes/categories.js';
import adminRoutes from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  const app = express();

  // 信任本地反向代理传递的真实IP
  app.set('trust proxy', 'loopback');

  // 初始化数据库（异步，更好兼容）
  await initDb();

  // ===== 基础中间件 =====
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ===== Session（SQLite 存储）=====
  dbExec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
  `);

  class SQLiteStore extends session.Store {
    get(sid, cb) {
      try {
        const row = dbGet('SELECT sess FROM sessions WHERE sid = ? AND expired > ?', sid, Date.now());
        cb(null, row ? JSON.parse(row.sess) : null);
      } catch (e) { cb(e); }
    }
    set(sid, sess, cb) {
      try {
        const maxAge = sess.cookie?.maxAge || 86400000;
        const expired = Date.now() + maxAge;
        dbRun('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)', sid, JSON.stringify(sess), expired);
        cb(null);
      } catch (e) { cb(e); }
    }
    destroy(sid, cb) {
      try { dbRun('DELETE FROM sessions WHERE sid = ?', sid); cb(null); } catch (e) { cb(e); }
    }
    touch(sid, sess, cb) {
      try {
        const maxAge = sess.cookie?.maxAge || 86400000;
        dbRun('UPDATE sessions SET expired = ? WHERE sid = ?', Date.now() + maxAge, sid);
        cb(null);
      } catch (e) { cb(e); }
    }
  }

  const store = new SQLiteStore();

  app.use(session({
    store,
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'aitag.sid',
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  }));

  // ===== Rate Limiting =====
  app.use('/api/', rateLimit({
    windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' },
  }));

  // 认证接口专用严格限流（防暴力破解 + 批量注册）
  const authLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: '登录/注册请求过于频繁' } });
  app.use('/api/auth/local', authLimiter);

  const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: '上传过于频繁' } });
  app.use('/api/images', (req, res, next) => {
    if (req.method === 'POST') return uploadLimiter(req, res, next);
    next();
  });

  // ===== 静态文件 =====
  const uploadDir = process.env.UPLOAD_DIR || join(__dirname, '..', 'uploads');

  // 防盗链中间件：阻止外站通过 <img src> 直接引用本站图片
  app.use('/uploads', (req, res, next) => {
    const referer = req.get('referer') || '';
    // 允许无 referer（浏览器直接访问）和本站 referer
    if (!referer) return next();
    try {
      const refOrigin = new URL(referer).origin;
      // 构建本站 origin 用于比较
      const proto = req.protocol;
      const host = req.get('host'); // 包含端口，如 localhost:3000
      const selfOrigin = `${proto}://${host}`;
      if (refOrigin === selfOrigin) return next();
      // 也检查 FRONTEND_URL
      const frontendUrl = process.env.FRONTEND_URL;
      if (frontendUrl) {
        const feOrigin = new URL(frontendUrl).origin;
        if (refOrigin === feOrigin) return next();
      }
    } catch {}
    return res.status(403).end();
  });

  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true }));

  const publicDir = join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // ===== API 路由 =====
  app.use('/api/auth', authRoutes);
  app.use('/api/images', imageRoutes);
  app.use('/api/tags', tagRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // SPA Fallback（Express 5 不支持 '*' 通配符）
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.sendFile(join(publicDir, 'index.html'), (err) => {
      if (err) next(); // 如果 index.html 不存在就跳过
    });
  });

  app.use(errorHandler);

  // 定期清理过期 session
  setInterval(() => {
    try { dbRun('DELETE FROM sessions WHERE expired < ?', Date.now()); } catch {}
  }, 60 * 60 * 1000);

  return app;
}
