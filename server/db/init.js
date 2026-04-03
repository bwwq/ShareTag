import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db;
let dbPath;

/**
 * 初始化数据库
 */
export async function initDb() {
  if (db) return db;

  const dataDir = join(__dirname, '..', '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  dbPath = join(dataDir, 'aitag.db');

  if (existsSync(dbPath)) {
    console.log('[DB] Loaded existing database from', dbPath);
  } else {
    console.log('[DB] Created new database');
  }

  // 同步初始化 better-sqlite3
  db = new Database(dbPath);

  // 启用高效的 WAL 模式和外键
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 执行建表
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // 执行 seed
  const seed = readFileSync(join(__dirname, 'seed.sql'), 'utf-8');
  db.exec(seed);

  // 自动迁移
  try { db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT'); console.log('[DB] Migrated: added password_hash to users'); } catch (e) {}
  try { db.exec('ALTER TABLE images ADD COLUMN likes INTEGER DEFAULT 0'); console.log('[DB] Migrated: added likes to images'); } catch (e) {}
  try { db.exec('ALTER TABLE images ADD COLUMN views INTEGER DEFAULT 0'); console.log('[DB] Migrated: added views to images'); } catch (e) {}
  try { db.exec('ALTER TABLE images ADD COLUMN prompt_text TEXT'); console.log('[DB] Migrated: added prompt_text to images'); } catch (e) {}
  try { db.exec('ALTER TABLE images ADD COLUMN negative_prompt_text TEXT'); console.log('[DB] Migrated: added negative_prompt_text to images'); } catch (e) {}
  try { db.exec('ALTER TABLE images ADD COLUMN is_nsfw INTEGER NOT NULL DEFAULT 1'); console.log('[DB] Migrated: added is_nsfw to images'); } catch (e) {}
  try { db.exec("ALTER TABLE images ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'"); console.log('[DB] Migrated: added visibility to images'); } catch (e) {}

  // 迁移分类排序：NovelAI 首位，三次元末位
  try {
    const real = db.prepare("SELECT sort_order FROM categories WHERE slug = 'real'").get();
    const nai = db.prepare("SELECT sort_order FROM categories WHERE slug = 'nai'").get();
    if (real && nai && real.sort_order < nai.sort_order) {
      db.exec("UPDATE categories SET sort_order = 1 WHERE slug = 'nai'");
      db.exec("UPDATE categories SET sort_order = 2 WHERE slug = 'sd'");
      db.exec("UPDATE categories SET sort_order = 99 WHERE slug = 'real'");
      console.log('[DB] Migrated: reordered categories (nai first, real last)');
    }
  } catch (e) {}

  console.log('[DB] SQLite initialized at', dbPath);
  return db;
}

/**
 * 获取 DB 实例
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ===== 兼容 better-sqlite3 风格的包装 =====

/**
 * 执行 prepare().get() — 返回单行
 */
export function dbGet(sql, ...params) {
  return db.prepare(sql).get(...params);
}

/**
 * 执行 prepare().all() — 返回多行
 */
export function dbAll(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/**
 * 执行 prepare().run() — 执行修改操作
 */
export function dbRun(sql, ...params) {
  const info = db.prepare(sql).run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

/**
 * 执行 exec — 执行多条 SQL
 */
export function dbExec(sql) {
  db.exec(sql);
}

// ===== site_config 便捷方法 =====

export function getConfig(key) {
  const row = dbGet('SELECT value FROM site_config WHERE key = ?', key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function getAllConfig() {
  const rows = dbAll('SELECT key, value FROM site_config');
  const config = {};
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }
  return config;
}

export function setConfig(key, value) {
  const serialized = JSON.stringify(value);
  dbRun(
    "INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    key, serialized
  );
}
