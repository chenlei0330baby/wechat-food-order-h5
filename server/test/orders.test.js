import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { confirmPaid, createOrder, expireDueOrders, getOrderByNo, shipOrder } from '../src/orders.js';
import { listPublicProducts, updateProduct } from '../src/catalog.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-order-'));
  const db = openDatabase(path.join(dir, 'shop.sqlite'));
  const customer = db.prepare('INSERT INTO customers (openid, created_at) VALUES (?, ?)').run('openid-a', Date.now());
  return {
    dir,
    db,
    customerId: Number(customer.lastInsertRowid),
    close() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function receiver() {
  return {
    receiverName: '陈磊',
    receiverPhone: '13800138000',
    receiverRegion: '上海市浦东新区',
    receiverDetail: '世纪大道 100 号',
  };
}

const expected = { expectedAppId: 'wx1234567890abcd', expectedMchId: '1234567890' };

test('reserve stock on order and release it when unpaid order expires', () => {
  const ctx = setup();
  try {
    const before = listPublicProducts(ctx.db).find((item) => item.name === '红烧肉');
    const order = createOrder(ctx.db, {
      customerId: ctx.customerId,
      ...receiver(),
      items: [{ productId: before.id, qty: 2 }],
      timeoutMs: 0,
    });
    const held = listPublicProducts(ctx.db).find((item) => item.id === before.id);
    assert.equal(held.available, before.available - 2);
    assert.equal(order.status, 'pending');
    assert.equal(order.totalCents, before.priceCents * 2);

    expireDueOrders(ctx.db, null, Date.now() + 1);
    const released = listPublicProducts(ctx.db).find((item) => item.id === before.id);
    assert.equal(released.available, before.available);
    assert.equal(getOrderByNo(ctx.db, order.orderNo).status, 'closed');
  } finally {
    ctx.close();
  }
});

test('payment confirms stock once, mismatch and oversell do not', () => {
  const ctx = setup();
  try {
    const product = listPublicProducts(ctx.db)[0];
    assert.equal(createOrder(ctx.db, {
      customerId: ctx.customerId,
      ...receiver(),
      items: [{ productId: product.id, qty: product.available + 1 }],
    }).orderNo, undefined);
  } catch (err) {
    assert.equal(err.status, 409);
  } finally {
    ctx.close();
  }

  const ctx2 = setup();
  try {
    const product = listPublicProducts(ctx2.db)[0];
    const order = createOrder(ctx2.db, {
      customerId: ctx2.customerId,
      ...receiver(),
      items: [{ productId: product.id, qty: 1 }],
    });
    assert.throws(() => confirmPaid(ctx2.db, {
      orderNo: order.orderNo,
      transactionId: 'wx-tx-1',
      totalCents: order.totalCents - 1,
      appid: expected.expectedAppId,
      mchid: expected.expectedMchId,
      openid: 'openid-a',
      ...expected,
    }), (err) => err.status === 400);
    assert.equal(getOrderByNo(ctx2.db, order.orderNo).status, 'pending');

    const paid = confirmPaid(ctx2.db, {
      orderNo: order.orderNo,
      transactionId: 'wx-tx-1',
      totalCents: order.totalCents,
      payerCents: order.totalCents,
      appid: expected.expectedAppId,
      mchid: expected.expectedMchId,
      openid: 'openid-a',
      ...expected,
    });
    const again = confirmPaid(ctx2.db, {
      orderNo: order.orderNo,
      transactionId: 'wx-tx-1',
      totalCents: order.totalCents,
      appid: expected.expectedAppId,
      mchid: expected.expectedMchId,
      openid: 'openid-a',
      ...expected,
    });
    const after = listPublicProducts(ctx2.db).find((item) => item.id === product.id);
    assert.equal(paid.order.status, 'paid');
    assert.equal(again.duplicate, true);
    assert.equal(after.available, product.available - 1);

    const shipped = shipOrder(ctx2.db, { orderNo: order.orderNo, carrier: '顺丰', trackingNo: 'SF1234567890' });
    assert.equal(shipped.status, 'shipped');
    assert.equal(shipped.trackingNo, 'SF1234567890');
    assert.throws(() => shipOrder(ctx2.db, { orderNo: order.orderNo, carrier: '顺丰', trackingNo: 'SF1234567890' }), (err) => err.status === 409);
  } finally {
    ctx2.close();
  }
});

test('off-sale product cannot be ordered and stock cannot drop below reservation', () => {
  const ctx = setup();
  try {
    const product = listPublicProducts(ctx.db)[0];
    updateProduct(ctx.db, product.id, { onSale: false });
    assert.throws(() => createOrder(ctx.db, {
      customerId: ctx.customerId,
      ...receiver(),
      items: [{ productId: product.id, qty: 1 }],
    }), (err) => err.status === 409);

    const other = listPublicProducts(ctx.db)[0];
    createOrder(ctx.db, {
      customerId: ctx.customerId,
      ...receiver(),
      items: [{ productId: other.id, qty: 1 }],
      timeoutMs: 60_000,
    });
    assert.throws(() => updateProduct(ctx.db, other.id, { stockOnHand: 0 }), (err) => err.status === 400);
  } finally {
    ctx.close();
  }
});

test('late payment after close takes remaining stock or records an anomaly', async () => {
  const ctx = setup();
  try {
    const product = listPublicProducts(ctx.db)[0];
    const order = createOrder(ctx.db, {
      customerId: ctx.customerId,
      ...receiver(),
      items: [{ productId: product.id, qty: 1 }],
      timeoutMs: 0,
    });
    await expireDueOrders(ctx.db, null, Date.now() + 1);
    const recovered = confirmPaid(ctx.db, {
      orderNo: order.orderNo,
      transactionId: 'wx-late-1',
      totalCents: order.totalCents,
      appid: expected.expectedAppId,
      mchid: expected.expectedMchId,
      openid: 'openid-a',
      ...expected,
    });
    assert.equal(recovered.order.status, 'paid');

    const soldOut = listPublicProducts(ctx.db).find((item) => item.name === '酸梅汤');
    const big = createOrder(ctx.db, {
      customerId: ctx.customerId,
      ...receiver(),
      items: [{ productId: soldOut.id, qty: soldOut.available }],
      timeoutMs: 0,
    });
    await expireDueOrders(ctx.db, null, Date.now() + 1);
    updateProduct(ctx.db, soldOut.id, { stockOnHand: 0 });
    const anomaly = confirmPaid(ctx.db, {
      orderNo: big.orderNo,
      transactionId: 'wx-late-2',
      totalCents: big.totalCents,
      appid: expected.expectedAppId,
      mchid: expected.expectedMchId,
      openid: 'openid-a',
      ...expected,
    });
    assert.equal(anomaly.anomaly, true);
    assert.equal(anomaly.order.status, 'closed');
    assert.equal(anomaly.order.payAnomaly, 'paid_after_close_no_stock');
  } finally {
    ctx.close();
  }
});
