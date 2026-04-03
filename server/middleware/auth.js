import { dbGet } from '../db/init.js';

// 安全列名：不包含 password_hash
const USER_SAFE_COLS = 'id, username, email, avatar_url, role, oidc_provider, oidc_sub, oidc_trust_level, created_at, updated_at, is_banned';

/**
 * 要求用户已登录
 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = dbGet(`SELECT ${USER_SAFE_COLS} FROM users WHERE id = ?`, req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User not found' });
  }

  if (user.is_banned) {
    req.session.destroy(() => {});
    return res.status(403).json({ error: 'Account is banned' });
  }

  req.user = user;
  next();
}

/**
 * 要求用户拥有指定角色之一
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    next();
  };
}

/**
 * 可选认证
 */
export function optionalAuth(req, res, next) {
  if (req.session?.userId) {
    const user = dbGet(`SELECT ${USER_SAFE_COLS} FROM users WHERE id = ? AND is_banned = 0`, req.session.userId);
    if (user) req.user = user;
  }
  next();
}
