import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/http.js';
import { createOrder } from '../src/orders.js';
import { encryptResource, signJsapiPay } from '../src/wechat/crypto.js';

function shopConfig(dir, keys) {
  return {
    port: 0,
    shopName: '灶边',
    publicBaseUrl: 'https://order.example.com',
    dataDir: dir,
    sessionSecret: '1234567890abcdef',
    merchantUsername: 'admin',
    merchantPassword: 'local-admin-pass',
    payTimeoutMs: 15 * 60 * 1000,
    wechat: {
      appId: 'wx1234567890abcd',
      appSecret: 'app-secret-value-32chars!!',
      mchId: '1234567890',
      mchSerial: 'AABBCCDDEEFF0011AABBCCDDEEFF0011AABBCCDD',
      privateKeyPath: keys.privateKeyPath,
      apiV3Key: '12345678901234567890123456789012',
      payPublicKeyPath: keys.publicKeyPath,
      payPublicKeyId: 'PUB_KEY_ID_00000000000000000000000000000000',
    },
  };
}

function writeKeys(dir) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(dir, 'apiclient_key.pem');
  const publicKeyPath = path.join(dir, 'wxp_pub.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return { privateKey, publicKey, privateKeyPath, publicKeyPath };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function cookie(res, name) {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const found = all.find((item) => item.startsWith(`${name}=`));
  assert.ok(found, `missing cookie ${name}`);
  return found.split(';')[0].split('=').slice(1).join('=');
}

test('catalog, merchant login, pay params, and payment notify', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-http-'));
  const db = openDatabase(path.join(dir, 'shop.sqlite'));
  const keys = writeKeys(dir);
  const config = shopConfig(dir, keys);
  let calls = 0;
  const app = createApp({
    config,
    db,
    wechat: {
      appId: config.wechat.appId,
      mchId: config.wechat.mchId,
      async jsapiOrder() {
        calls += 1;
        return { prepay_id: 'prepay_test_1' };
      },
      signPay(prepayId) {
        return signJsapiPay({ appId: config.wechat.appId, prepayId, privateKey: keys.privateKey });
      },
      async query() {
        throw new Error('not used');
      },
      async close() {},
      parseNotify() {
        throw new Error('not used');
      },
    },
  });
  const real = createApp({ config, db });
  const server = await listen(real);
  const payServer = await listen(app);
  try {
    const listed = await fetch(`${server.base}/api/products`).then((res) => res.json());
    assert.ok(listed.products.every((item) => !Object.hasOwn(item, 'stockOnHand') && !Object.hasOwn(item, 'stockReserved')));
    assert.ok(listed.products[0].available > 0);

    const denied = await fetch(`${server.base}/api/orders`);
    assert.equal(denied.status, 401);

    const badLogin = await fetch(`${server.base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });
    assert.equal(badLogin.status, 401);

    const login = await fetch(`${server.base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'local-admin-pass' }),
    });
    assert.equal(login.status, 200);
    const adminCookie = `admin_sid=${decodeURIComponent(cookie(login, 'admin_sid'))}`;
    const created = await fetch(`${server.base}/api/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: '桂花糕',
        subtitle: '当日',
        description: '小块装盒',
        priceCents: 1200,
        stockOnHand: 8,
        onSale: true,
        lowStockThreshold: 2,
      }),
    });
    assert.equal(created.status, 201);
    const after = await fetch(`${server.base}/api/products`).then((res) => res.json());
    assert.ok(after.products.some((item) => item.name === '桂花糕'));

    const readinessRes = await fetch(`${server.base}/api/admin/readiness`, { headers: { cookie: adminCookie } });
    const readinessJson = await readinessRes.json();
    assert.equal(readinessJson.jsapiDir, 'https://order.example.com/');
    assert.equal(readinessJson.notifyUrl, 'https://order.example.com/api/pay/notify');

    const customer = db.prepare('INSERT INTO customers (openid, created_at) VALUES (?, ?)').run('openid-a', Date.now());
    const customerId = Number(customer.lastInsertRowid);
    const sid = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO sessions (id, kind, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
      sid,
      'customer',
      customerId,
      now + 60_000,
      now,
    );
    const order = createOrder(db, {
      customerId,
      receiverName: '陈磊',
      receiverPhone: '13800138000',
      receiverRegion: '上海市浦东新区',
      receiverDetail: '世纪大道 100 号',
      items: [{ productId: after.products.find((item) => item.name === '桂花糕').id, qty: 2 }],
    });
    const customerCookie = `sid=${sid}`;
    const pay = await fetch(`${payServer.base}/api/orders/${order.orderNo}/pay`, {
      method: 'POST',
      headers: { cookie: customerCookie },
    });
    const payJson = await pay.json();
    assert.equal(pay.status, 200);
    assert.equal(payJson.payment.package, 'prepay_id=prepay_test_1');
    assert.equal(calls, 1);
    const again = await fetch(`${payServer.base}/api/orders/${order.orderNo}/pay`, {
      method: 'POST',
      headers: { cookie: customerCookie },
    });
    assert.equal(again.status, 200);
    assert.equal(calls, 1);

    const plain = JSON.stringify({
      out_trade_no: order.orderNo,
      transaction_id: '4200000001',
      trade_state: 'SUCCESS',
      amount: { total: order.totalCents, payer_total: order.totalCents },
      appid: config.wechat.appId,
      mchid: config.wechat.mchId,
      payer: { openid: 'openid-a' },
    });
    const notice = JSON.stringify({
      id: 'notice-1',
      event_type: 'TRANSACTION.SUCCESS',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encryptResource({
          apiV3Key: config.wechat.apiV3Key,
          nonce: 'nonce12bytes',
          associatedData: 'transaction',
          plaintext: plain,
        }),
        associated_data: 'transaction',
        nonce: 'nonce12bytes',
      },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 'notify-nonce';
    const signature = crypto.sign(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\n${nonce}\n${notice}\n`),
      keys.privateKey,
    ).toString('base64');
    const headers = {
      'Content-Type': 'application/json',
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': config.wechat.payPublicKeyId,
    };
    const notified = await fetch(`${server.base}/api/pay/notify`, { method: 'POST', headers, body: notice });
    assert.equal(notified.status, 200);
    const paid = await fetch(`${server.base}/api/orders/${order.orderNo}`, { headers: { cookie: customerCookie } }).then((res) => res.json());
    assert.equal(paid.order.status, 'paid');
    assert.equal(Object.hasOwn(paid.order, 'prepayId'), false);

    const repeat = await fetch(`${server.base}/api/pay/notify`, { method: 'POST', headers, body: notice });
    assert.equal(repeat.status, 200);
    const stock = await fetch(`${server.base}/api/products`).then((res) => res.json());
    assert.equal(stock.products.find((item) => item.name === '桂花糕').available, 6);

    const merchantOrders = await fetch(`${server.base}/api/admin/orders?status=paid`, { headers: { cookie: adminCookie } }).then((res) => res.json());
    assert.ok(merchantOrders.orders.some((item) => item.orderNo === order.orderNo));
    const shipped = await fetch(`${server.base}/api/admin/orders/${order.orderNo}/ship`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ carrier: '圆通', trackingNo: 'YT123456789CN' }),
    });
    const shippedJson = await shipped.json();
    assert.equal(shipped.status, 200);
    assert.equal(shippedJson.order.status, 'shipped');
    assert.equal(shippedJson.order.trackingNo, 'YT123456789CN');
  } finally {
    await server.close();
    await payServer.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
