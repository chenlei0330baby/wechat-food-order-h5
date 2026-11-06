import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const schema = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  customer_id INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  stock_on_hand INTEGER NOT NULL,
  stock_reserved INTEGER NOT NULL DEFAULT 0,
  on_sale INTEGER NOT NULL DEFAULT 1,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  receiver_region TEXT NOT NULL,
  receiver_detail TEXT NOT NULL,
  pay_expire_at INTEGER NOT NULL,
  prepay_id TEXT,
  wx_transaction_id TEXT,
  paid_at INTEGER,
  carrier TEXT,
  tracking_no TEXT,
  shipped_at INTEGER,
  pay_anomaly TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_expire ON orders(status, pay_expire_at);
`;

const samples = [
  ['红烧肉', '当日现烧', '肥瘦相间，连汤汁一起装盒。', 3800, 40],
  ['番茄牛腩', '慢炖两小时', '番茄熬出酸甜，牛腩软烂。', 4200, 30],
  ['清炒时蔬', '当季青菜', '少油快炒，建议当天吃完。', 1600, 50],
  ['白米饭', '现蒸', '一盒约二两。', 300, 200],
  ['酸梅汤', '冰镇', '独立瓶装，随餐发出。', 800, 80],
  ['卤味拼盘', '适合下酒', '卤牛肉、豆干和海带结。', 5600, 20],
];

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec(schema);
  seed(db);
  return db;
}

function seed(db) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (Number(row.count) > 0) return;
  const insert = db.prepare(`
    INSERT INTO products (
      name, subtitle, description, price_cents, stock_on_hand,
      low_stock_threshold, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, 5, ?, ?)
  `);
  const now = Date.now();
  samples.forEach((item, index) => {
    insert.run(...item, index + 1, now);
  });
}

export function withTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already closed */
    }
    throw err;
  }
}
