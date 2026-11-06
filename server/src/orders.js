import crypto from 'node:crypto';
import { requireInt, requireText } from './catalog.js';
import { withTx } from './db.js';
import { HttpError } from './errors.js';

export const CARRIERS = ['顺丰', '京东', '邮政', '中通', '圆通', '申通', '韵达', '极兔', '其他'];

export function createOrder(db, input, now = Date.now()) {
  const receiver = readReceiver(input);
  const items = normalizeItems(input.items);
  const timeoutMs = input.timeoutMs ?? 15 * 60 * 1000;

  return withTx(db, () => {
    const priced = items.map((item) => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId);
      if (!product || !product.on_sale) throw new HttpError(409, '有商品已下架，请重新选择');
      const reserved = db.prepare(`
        UPDATE products SET stock_reserved = stock_reserved + ?
        WHERE id = ? AND on_sale = 1 AND stock_on_hand - stock_reserved >= ?
      `).run(item.qty, item.productId, item.qty);
      if (Number(reserved.changes) !== 1) throw new HttpError(409, `${product.name}库存不足`);
      return {
        productId: product.id,
        name: product.name,
        priceCents: product.price_cents,
        qty: item.qty,
      };
    });
    const totalCents = priced.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
    const orderNo = uniqueOrderNo(db, now);
    const result = db.prepare(`
      INSERT INTO orders (
        order_no, customer_id, status, total_cents,
        receiver_name, receiver_phone, receiver_region, receiver_detail,
        pay_expire_at, created_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderNo,
      input.customerId,
      totalCents,
      receiver.name,
      receiver.phone,
      receiver.region,
      receiver.detail,
      now + timeoutMs,
      now,
    );
    const orderId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, name, price_cents, qty)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of priced) {
      insertItem.run(orderId, item.productId, item.name, item.priceCents, item.qty);
    }
    return hydrate(db, orderId);
  });
}

export function confirmPaid(db, input, now = Date.now()) {
  return withTx(db, () => {
    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(input.orderNo);
    if (!row) throw new HttpError(404, '订单不存在');
    if (input.totalCents !== row.total_cents || (input.payerCents != null && input.payerCents !== row.total_cents)) {
      throw new HttpError(400, '支付金额不匹配');
    }
    if (input.appid !== input.expectedAppId || input.mchid !== input.expectedMchId) {
      throw new HttpError(400, '支付商户不匹配');
    }
    const customer = db.prepare('SELECT openid FROM customers WHERE id = ?').get(row.customer_id);
    if (!customer || customer.openid !== input.openid) throw new HttpError(400, '支付用户不匹配');
    if (!input.transactionId) throw new HttpError(400, '缺少微信支付单号');

    if (row.status === 'paid' || row.status === 'shipped') {
      if (row.wx_transaction_id && row.wx_transaction_id !== input.transactionId) {
        throw new HttpError(409, '订单已有另一笔支付');
      }
      return { order: hydrate(db, row.id), duplicate: true };
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
    if (row.status === 'pending') {
      for (const item of items) {
        const updated = db.prepare(`
          UPDATE products
          SET stock_on_hand = stock_on_hand - ?, stock_reserved = stock_reserved - ?
          WHERE id = ? AND stock_on_hand >= ? AND stock_reserved >= ?
        `).run(item.qty, item.qty, item.product_id, item.qty, item.qty);
        if (Number(updated.changes) !== 1) throw new HttpError(500, '扣减库存失败');
      }
      markPaid(db, row.id, input.transactionId, now);
      return { order: hydrate(db, row.id), duplicate: false };
    }

    if (row.status === 'closed') {
      const enough = items.every((item) => {
        const product = db.prepare('SELECT stock_on_hand FROM products WHERE id = ?').get(item.product_id);
        return product && product.stock_on_hand >= item.qty;
      });
      if (!enough) {
        db.prepare(`
          UPDATE orders SET wx_transaction_id = ?, pay_anomaly = 'paid_after_close_no_stock', paid_at = ?
          WHERE id = ?
        `).run(input.transactionId, now, row.id);
        return { order: hydrate(db, row.id), anomaly: true };
      }
      for (const item of items) {
        const updated = db.prepare(`
          UPDATE products SET stock_on_hand = stock_on_hand - ?
          WHERE id = ? AND stock_on_hand >= ?
        `).run(item.qty, item.product_id, item.qty);
        if (Number(updated.changes) !== 1) throw new HttpError(500, '扣减库存失败');
      }
      markPaid(db, row.id, input.transactionId, now);
      return { order: hydrate(db, row.id), duplicate: false };
    }

    throw new HttpError(409, '订单状态不能确认收款');
  });
}

function markPaid(db, orderId, transactionId, now) {
  db.prepare(`
    UPDATE orders
    SET status = 'paid', wx_transaction_id = ?, paid_at = ?, pay_anomaly = NULL
    WHERE id = ?
  `).run(transactionId, now, orderId);
}

export function closeUnpaid(db, orderId) {
  return withTx(db, () => {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!row || row.status !== 'pending') return false;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    for (const item of items) {
      const updated = db.prepare(`
        UPDATE products SET stock_reserved = stock_reserved - ?
        WHERE id = ? AND stock_reserved >= ?
      `).run(item.qty, item.product_id, item.qty);
      if (Number(updated.changes) !== 1) throw new HttpError(500, '释放库存失败');
    }
    const closed = db.prepare(`
      UPDATE orders SET status = 'closed' WHERE id = ? AND status = 'pending'
    `).run(orderId);
    return Number(closed.changes) === 1;
  });
}

export async function expireDueOrders(db, wechat, now = Date.now()) {
  const due = db.prepare(`
    SELECT * FROM orders WHERE status = 'pending' AND pay_expire_at <= ?
  `).all(now);
  for (const order of due) {
    if (order.prepay_id && !wechat) {
      console.error('skip expire, pay client missing', order.order_no);
      continue;
    }
    if (order.prepay_id && wechat) {
      try {
        await wechat.close(order.order_no);
      } catch (err) {
        if (err.code === 'ORDERPAID' || err.code === 'ORDER_PAID') {
          await settleFromQuery(db, wechat, order.order_no, now);
          continue;
        }
        if (err.code !== 'ORDERCLOSED' && err.code !== 'ORDER_CLOSED') {
          console.error('close unpaid failed', order.order_no, err.code || err.message);
          continue;
        }
      }
    }
    closeUnpaid(db, order.id);
  }
}

export async function settleFromQuery(db, wechat, orderNo, now = Date.now()) {
  const remote = await wechat.query(orderNo);
  if (remote.trade_state !== 'SUCCESS') return getOrderByNo(db, orderNo);
  const result = confirmPaid(db, {
    orderNo,
    transactionId: remote.transaction_id,
    totalCents: remote.amount?.total,
    payerCents: remote.amount?.payer_total,
    appid: remote.appid,
    mchid: remote.mchid,
    openid: remote.payer?.openid,
    expectedAppId: wechat.appId,
    expectedMchId: wechat.mchId,
  }, now);
  return result.order;
}

export function savePrepayId(db, orderNo, prepayId) {
  db.prepare(`
    UPDATE orders SET prepay_id = ? WHERE order_no = ? AND prepay_id IS NULL
  `).run(prepayId, orderNo);
}

export function shipOrder(db, input, now = Date.now()) {
  const carrier = requireText(input.carrier, 1, 20, '快递公司');
  if (!CARRIERS.includes(carrier)) throw new HttpError(400, '请选择快递公司');
  const trackingNo = requireText(input.trackingNo, 6, 40, '快递单号');
  if (!/^[A-Za-z0-9-]{6,40}$/.test(trackingNo)) throw new HttpError(400, '快递单号格式不正确');
  const updated = db.prepare(`
    UPDATE orders
    SET status = 'shipped', carrier = ?, tracking_no = ?, shipped_at = ?
    WHERE order_no = ? AND status = 'paid'
  `).run(carrier, trackingNo, now, input.orderNo);
  if (Number(updated.changes) !== 1) throw new HttpError(409, '只有已支付订单可以发货');
  return getOrderByNo(db, input.orderNo);
}

export function getOrderByNo(db, orderNo) {
  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!row) return null;
  return hydrate(db, row.id);
}

export function listCustomerOrders(db, customerId) {
  const rows = db.prepare(`
    SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC
  `).all(customerId);
  return rows.map((row) => hydrate(db, row.id));
}

export function listMerchantOrders(db, status) {
  const where = status === 'shipped'
    ? "status = 'shipped'"
    : status === 'paid'
      ? "status = 'paid' OR pay_anomaly IS NOT NULL"
      : "status IN ('paid', 'shipped') OR pay_anomaly IS NOT NULL";
  const rows = db.prepare(`SELECT id FROM orders WHERE ${where} ORDER BY created_at DESC, id DESC`).all();
  return rows.map((row) => hydrate(db, row.id));
}

export function readReceiver(input) {
  const phone = String(input.receiverPhone ?? '').trim();
  if (!/^1\d{10}$/.test(phone)) throw new HttpError(400, '请填写 11 位手机号');
  return {
    name: requireText(input.receiverName, 1, 30, '收货人'),
    phone,
    region: requireText(input.receiverRegion, 2, 40, '省市区'),
    detail: requireText(input.receiverDetail, 4, 120, '详细地址'),
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    throw new HttpError(400, '请选择商品');
  }
  return items.map((item) => ({
    productId: requireInt(item.productId, 1, 1_000_000_000, '商品'),
    qty: requireInt(item.qty, 1, 99, '数量'),
  }));
}

function uniqueOrderNo(db, now) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now)).replaceAll('-', '');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rand = crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');
    const orderNo = `D${day}${rand}`;
    const exists = db.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(orderNo);
    if (!exists) return orderNo;
  }
  throw new HttpError(500, '生成订单号失败');
}

function hydrate(db, orderId) {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = db.prepare(`
    SELECT product_id, name, price_cents, qty FROM order_items WHERE order_id = ? ORDER BY id
  `).all(orderId);
  return {
    orderNo: row.order_no,
    status: row.status,
    totalCents: row.total_cents,
    receiverName: row.receiver_name,
    receiverPhone: row.receiver_phone,
    receiverRegion: row.receiver_region,
    receiverDetail: row.receiver_detail,
    payExpireAt: row.pay_expire_at,
    paidAt: row.paid_at,
    carrier: row.carrier,
    trackingNo: row.tracking_no,
    shippedAt: row.shipped_at,
    payAnomaly: row.pay_anomaly,
    prepayId: row.prepay_id,
    createdAt: row.created_at,
    customerId: row.customer_id,
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.name,
      priceCents: item.price_cents,
      qty: item.qty,
    })),
  };
}

export function presentOrder(order) {
  if (!order) return null;
  const { customerId, prepayId, ...rest } = order;
  return rest;
}
