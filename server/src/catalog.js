import { HttpError } from './errors.js';

export function listPublicProducts(db) {
  return db.prepare(`
    SELECT * FROM products WHERE on_sale = 1 ORDER BY sort_order, id
  `).all().map((row) => presentProduct(row));
}

export function getPublicProduct(db, id) {
  const row = db.prepare('SELECT * FROM products WHERE id = ? AND on_sale = 1').get(id);
  if (!row) throw new HttpError(404, '商品不存在');
  return presentProduct(row);
}

export function listAdminProducts(db) {
  return db.prepare('SELECT * FROM products ORDER BY sort_order, id').all().map((row) => presentProduct(row, true));
}

export function createProduct(db, input) {
  const product = normalizeProduct(input);
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM products').get();
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO products (
      name, subtitle, description, price_cents, stock_on_hand,
      on_sale, low_stock_threshold, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.name,
    product.subtitle,
    product.description,
    product.priceCents,
    product.stockOnHand,
    product.onSale ? 1 : 0,
    product.lowStockThreshold,
    Number(sort.max_sort) + 1,
    now,
  );
  return presentProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(result.lastInsertRowid)), true);
}

export function updateProduct(db, id, input) {
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, '商品不存在');
  const product = normalizeProduct({
    name: input.name ?? current.name,
    subtitle: input.subtitle ?? current.subtitle,
    description: input.description ?? current.description,
    priceCents: input.priceCents ?? current.price_cents,
    stockOnHand: input.stockOnHand ?? current.stock_on_hand,
    onSale: input.onSale ?? Boolean(current.on_sale),
    lowStockThreshold: input.lowStockThreshold ?? current.low_stock_threshold,
  });
  if (product.stockOnHand < current.stock_reserved) {
    throw new HttpError(400, '库存不能小于待支付占用');
  }
  db.prepare(`
    UPDATE products SET
      name = ?, subtitle = ?, description = ?, price_cents = ?,
      stock_on_hand = ?, on_sale = ?, low_stock_threshold = ?
    WHERE id = ?
  `).run(
    product.name,
    product.subtitle,
    product.description,
    product.priceCents,
    product.stockOnHand,
    product.onSale ? 1 : 0,
    product.lowStockThreshold,
    id,
  );
  return presentProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id), true);
}

function normalizeProduct(input) {
  return {
    name: requireText(input.name, 1, 40, '商品名称'),
    subtitle: requireText(input.subtitle ?? '', 0, 40, '简介'),
    description: requireText(input.description ?? '', 0, 500, '描述'),
    priceCents: requireInt(input.priceCents, 1, 9_999_900, '价格'),
    stockOnHand: requireInt(input.stockOnHand, 0, 1_000_000, '库存'),
    onSale: Boolean(input.onSale ?? true),
    lowStockThreshold: requireInt(input.lowStockThreshold ?? 5, 0, 100_000, '低库存提醒'),
  };
}

export function requireText(value, min, max, label) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) {
    throw new HttpError(400, min === 0 ? `${label}不能超过 ${max} 个字` : `${label}需为 ${min}-${max} 个字`);
  }
  return text;
}

export function requireInt(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label}不正确`);
  }
  return number;
}

export function presentProduct(row, admin = false) {
  const available = Math.max(0, row.stock_on_hand - row.stock_reserved);
  const product = {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    priceCents: row.price_cents,
    available,
    lowStock: available > 0 && available <= row.low_stock_threshold,
  };
  if (admin) {
    product.stockOnHand = row.stock_on_hand;
    product.stockReserved = row.stock_reserved;
    product.onSale = Boolean(row.on_sale);
    product.lowStockThreshold = row.low_stock_threshold;
  }
  return product;
}
