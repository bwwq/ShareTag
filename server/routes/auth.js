import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { dbGet, dbRun, dbAll } from '../db/init.js';
import { getOidcProvider, buildAuthUrl, exchangeCodeForUser } from '../services/oidc.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/auth/providers
router.get('/providers', (req, res) => {
  const providers = dbAll('SELECT name, display_name, icon_url FROM oidc_providers WHERE enabled = 1');
  res.json(providers.map(p => ({
    name: p.name,
    display_name: p.display_name,
    icon_url: p.icon_url,
    login_url: `/api/auth/login/${p.name}`,
  })));
});

// GET /api/auth/login/:provider
router.get('/login/:provider', async (req, res, next) => {
  try {
    const { provider, config } = await getOidcProvider(req.params.provider);
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    req.session.oidcState = state;
    req.session.oidcNonce = nonce;
    req.session.oidcProvider = req.params.provider;

    const authUrl = buildAuthUrl(config, provider, state, nonce);
    res.redirect(authUrl);
  } catch (e) {
    if (e.message === 'Provider not found or disabled') {
      return res.status(404).json({ error: 'OIDC Provider 不存在或未启用' });
    }
    next(e);
  }
});

// GET /api/auth/callback/:provider
router.get('/callback/:provider', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    const savedState = req.session.oidcState;
    const savedNonce = req.session.oidcNonce;
    const providerName = req.params.provider;

    if (!code || !state || state !== savedState) {
      return res.status(400).json({ error: 'State 验证失败' });
    }

    const { provider, config, clientSecret, fieldMapping } = await getOidcProvider(providerName);
    const userinfo = await exchangeCodeForUser(config, provider, clientSecret, code, state, savedNonce, fieldMapping);

    delete req.session.oidcState;
    delete req.session.oidcNonce;
    delete req.session.oidcProvider;

    // 查找已有用户
    let user = dbGet('SELECT * FROM users WHERE oidc_provider = ? AND oidc_sub = ?', providerName, userinfo.sub);

    if (user) {
      // 角色只升不降
      let newRole = user.role;
      if (user.role === 'user' && userinfo.trust_level >= provider.auto_trust_level) {
        newRole = 'trusted';
      }

      dbRun(
        `UPDATE users SET username = ?, email = ?, avatar_url = ?, oidc_trust_level = ?, role = ?, updated_at = datetime('now') WHERE id = ?`,
        userinfo.username, userinfo.email, userinfo.avatar_url,
        userinfo.trust_level, newRole, user.id
      );

      user = dbGet('SELECT * FROM users WHERE id = ?', user.id);
    } else {
      // 新用户
      const userCount = dbGet('SELECT COUNT(*) as c FROM users').c;
      let role = 'user';
      if (userCount === 0) {
        role = 'admin';
      } else if (userinfo.trust_level >= provider.auto_trust_level) {
        role = 'trusted';
      }

      const result = dbRun(
        `INSERT INTO users (username, email, avatar_url, role, oidc_provider, oidc_sub, oidc_trust_level) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        userinfo.username, userinfo.email, userinfo.avatar_url,
        role, providerName, userinfo.sub, userinfo.trust_level
      );

      user = dbGet('SELECT * FROM users WHERE id = ?', result.lastInsertRowid);
    }

    if (user.is_banned) {
      return res.status(403).json({ error: '账户已被封禁' });
    }

    req.session.userId = user.id;
    const frontendUrl = process.env.FRONTEND_URL || '';
    res.redirect(frontendUrl || '/');
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: '登出失败' });
    res.clearCookie('aitag.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = dbGet(
    'SELECT id, username, email, avatar_url, role, oidc_provider, created_at FROM users WHERE id = ? AND is_banned = 0',
    req.session.userId
  );

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json(user);
});

// GET /api/auth/status
router.get('/status', (req, res) => {
  const count = dbGet('SELECT COUNT(*) as c FROM users').c;
  res.json({ needsSetup: count === 0, hasProviders: true });
});

// POST /api/auth/local/register
router.post('/local/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: '用户名至少3位，密码至少6位' });
    }

    const userCount = dbGet('SELECT COUNT(*) as c FROM users').c;
    const role = userCount === 0 ? 'admin' : 'user';

    const existing = dbGet("SELECT * FROM users WHERE username = ? AND oidc_provider = 'local'", username);
    if (existing) return res.status(400).json({ error: '用户名已被注册' });

    const hash = await bcrypt.hash(password, 10);
    const result = dbRun(
      `INSERT INTO users (username, role, oidc_provider, oidc_sub, password_hash) VALUES (?, ?, 'local', ?, ?)`,
      username, role, username, hash
    );

    req.session.userId = result.lastInsertRowid;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '注册失败: ' + e.message });
  }
});

// PUT /api/auth/local/password
router.put('/local/password', requireAuth, async (req, res) => {
  try {
    const { old_password, new_password, target_user_id } = req.body;
    
    // Admin 强制重置密码
    if (target_user_id && req.user.role === 'admin') {
      if (!new_password || new_password.length < 6) return res.status(400).json({ error: '新密码至少6位' });
      const hash = await bcrypt.hash(new_password, 10);
      dbRun('UPDATE users SET password_hash = ? WHERE id = ?', hash, target_user_id);
      return res.json({ ok: true });
    }

    // 用户自助修改密码
    if (!old_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ error: '请提供旧密码，且新密码至少6位' });
    }
    
    const user = dbGet('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!user.password_hash) return res.status(400).json({ error: '第三方登录用户请勿直接修改密码，去第三方平台修改' });

    const isValid = await bcrypt.compare(old_password, user.password_hash);
    if (!isValid) return res.status(403).json({ error: '原密码不正确' });

    const hash = await bcrypt.hash(new_password, 10);
    dbRun('UPDATE users SET password_hash = ? WHERE id = ?', hash, req.user.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: '修改失败' });
  }
});

// POST /api/auth/local/login
router.post('/local/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = dbGet("SELECT * FROM users WHERE username = ? AND oidc_provider = 'local'", username);
    if (!user || user.is_banned) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '用户名或密码错误' });

    req.session.userId = user.id;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '登录失败: ' + e.message });
  }
});
// PUT /api/auth/profile — 仅管理员可修改自己的名字和头像
router.put('/profile', requireAuth, (req, res) => {
  const user = dbGet('SELECT * FROM users WHERE id = ?', req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可修改个人信息' });
  }
  const { username, avatar_url } = req.body;
  const updates = []; const params = [];
  if (username && username.trim()) { updates.push('username = ?'); params.push(username.trim()); }
  if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url || null); }
  if (updates.length === 0) return res.status(400).json({ error: '无有效字段' });
  params.push(user.id);
  dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);
  const updated = dbGet('SELECT id, username, email, avatar_url, role, created_at FROM users WHERE id = ?', user.id);
  res.json(updated);
});

// GET /api/users/:id — 用户主页数据
router.get('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const user = dbGet('SELECT id, username, avatar_url, role, created_at FROM users WHERE id = ? AND is_banned = 0', id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const uploads = dbAll(
    `SELECT i.*, u.username, u.avatar_url FROM images i JOIN users u ON i.user_id = u.id WHERE i.user_id = ? AND i.status = 'approved' ORDER BY i.created_at DESC`,
    id
  );
  const bookmarks = dbAll(
    `SELECT i.*, u.username, u.avatar_url FROM bookmarks b JOIN images i ON b.image_id = i.id JOIN users u ON i.user_id = u.id WHERE b.user_id = ? AND i.status = 'approved' ORDER BY b.created_at DESC`,
    id
  );

  res.json({
    user,
    uploads: uploads.map(img => ({
      id: img.id, title: img.title, image_url: img.file_path,
      thumbnail_url: img.thumbnail_path || img.file_path,
      width: img.width, height: img.height, likes: img.likes || 0, views: img.views || 0,
      user: { id: img.user_id, username: img.username, avatar_url: img.avatar_url },
    })),
    bookmarks: bookmarks.map(img => ({
      id: img.id, title: img.title, image_url: img.file_path,
      thumbnail_url: img.thumbnail_path || img.file_path,
      width: img.width, height: img.height, likes: img.likes || 0, views: img.views || 0,
      user: { id: img.user_id, username: img.username, avatar_url: img.avatar_url },
    })),
  });
});

export default router;
