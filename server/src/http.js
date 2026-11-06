import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createProduct, getPublicProduct, listAdminProducts, listPublicProducts, updateProduct } from './catalog.js';
import { readiness } from './config.js';
import { HttpError } from './errors.js';
import {
  confirmPaid,
  createOrder,
  expireDueOrders,
  getOrderByNo,
  listCustomerOrders,
  listMerchantOrders,
  presentOrder,
  savePrepayId,
  settleFromQuery,
  shipOrder,
} from './orders.js';
import { createWechatClient, payDescription } from './wechat/client.js';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export function createApp({ config, db, wechat, fetchImpl = fetch } = {}) {
  const ready = readiness(config);
  const client = wechat !== undefined ? wechat : (ready.payReady ? createWechatClient(config, { fetchImpl }) : null);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));

  app.use((req, _res, next) => {
    const cookies = readCookies(req);
    const now = Date.now();
    req.customer = loadCustomer(db, cookies.sid, now);
    req.merchant = Boolean(loadSession(db, cookies.admin_sid, 'merchant', now));
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      shopName: config.shopName,
      payReady: ready.payReady,
      oauthReady: ready.oauthReady,
    });
  });

  app.get('/api/products', (_req, res) => {
    res.json({ products: listPublicProducts(db) });
  });

  app.get('/api/products/:id', (req, res, next) => {
    try {
      res.json({ product: getPublicProduct(db, Number(req.params.id)) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/me', (req, res) => {
    res.json({ customer: req.customer ? { id: req.customer.id } : null });
  });

  app.get('/api/auth/wechat', (req, res) => {
    if (!ready.oauthReady) return res.redirect('/?auth=unready');
    const state = crypto.randomBytes(16).toString('hex');
    const nextPath = safeNext(req.query.next);
    writeCookie(res, 'wx_oauth', seal({ state, next: nextPath, exp: Date.now() + 10 * 60 * 1000 }, config.sessionSecret), {
      maxAge: 10 * 60 * 1000,
      secure: secureCookie(config),
    });
    const redirectUri = `${config.publicBaseUrl}/api/auth/wechat/callback`;
    const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    url.searchParams.set('appid', config.wechat.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_base');
    url.searchParams.set('state', state);
    res.redirect(`${url.toString()}#wechat_redirect`);
  });

  app.get('/api/auth/wechat/callback', async (req, res) => {
    const fallback = '/?auth=fail';
    try {
      const saved = openSeal(readCookies(req).wx_oauth, config.sessionSecret);
      clearCookie(res, 'wx_oauth', secureCookie(config));
      if (!saved || saved.exp < Date.now() || saved.state !== req.query.state || !req.query.code) {
        return res.redirect(fallback);
      }
      const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
      tokenUrl.searchParams.set('appid', config.wechat.appId);
      tokenUrl.searchParams.set('secret', config.wechat.appSecret);
      tokenUrl.searchParams.set('code', String(req.query.code));
      tokenUrl.searchParams.set('grant_type', 'authorization_code');
      const tokenRes = await fetchImpl(tokenUrl);
      const token = await tokenRes.json();
      if (!token.openid) return res.redirect(fallback);
      const customer = upsertCustomer(db, token.openid);
      const sid = createSession(db, 'customer', customer.id, 30 * 24 * 3600 * 1000);
      writeCookie(res, 'sid', sid, { maxAge: 30 * 24 * 3600 * 1000, secure: secureCookie(config) });
      res.redirect(safeNext(saved.next));
    } catch (err) {
      console.error('wechat oauth', err.message);
      res.redirect(fallback);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const sid = readCookies(req).sid;
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ? AND kind = ?').run(sid, 'customer');
    clearCookie(res, 'sid', secureCookie(config));
    res.json({ ok: true });
  });

  app.post('/api/orders', (req, res, next) => {
    try {
      if (!req.customer) throw new HttpError(401, '请先在微信内打开并授权');
      const order = createOrder(db, {
        customerId: req.customer.id,
        receiverName: req.body?.receiverName,
        receiverPhone: req.body?.receiverPhone,
        receiverRegion: req.body?.receiverRegion,
        receiverDetail: req.body?.receiverDetail,
        items: req.body?.items,
        timeoutMs: config.payTimeoutMs,
      });
      res.status(201).json({ order: presentOrder(order) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/orders', (req, res, next) => {
    try {
      if (!req.customer) throw new HttpError(401, '请先在微信内打开并授权');
      res.json({ orders: listCustomerOrders(db, req.customer.id).map(presentOrder) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/orders/:orderNo', (req, res, next) => {
    try {
      res.json({ order: presentOrder(requireCustomerOrder(db, req)) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/orders/:orderNo/pay', async (req, res, next) => {
    try {
      if (!client) throw new HttpError(503, '店家尚未开通微信支付');
      const order = requireCustomerOrder(db, req);
      if (order.status !== 'pending') throw new HttpError(409, '订单不需要支付');
      if (order.payExpireAt <= Date.now()) throw new HttpError(409, '订单已超时，请重新下单');
      let prepayId = order.prepayId;
      if (!prepayId) {
        const customer = db.prepare('SELECT openid FROM customers WHERE id = ?').get(order.customerId);
        const result = await client.jsapiOrder({
          description: payDescription(config.shopName, order.items),
          outTradeNo: order.orderNo,
          total: order.totalCents,
          openid: customer.openid,
        });
        prepayId = result.prepay_id;
        savePrepayId(db, order.orderNo, prepayId);
      }
      res.json({ orderNo: order.orderNo, payment: client.signPay(prepayId) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/orders/:orderNo/sync', async (req, res, next) => {
    try {
      const order = requireCustomerOrder(db, req);
      if (order.status !== 'pending' || !order.prepayId || !client) {
        return res.json({ order: presentOrder(order) });
      }
      const settled = await settleFromQuery(db, client, order.orderNo);
      res.json({ order: presentOrder(settled) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/pay/notify', (req, res) => {
    if (!client) return res.status(503).json({ code: 'FAIL', message: '支付未配置' });
    try {
      const parsed = client.parseNotify(req.headers, req.rawBody?.toString('utf8') || '');
      if (!parsed.ignored && parsed.payment.tradeState === 'SUCCESS') {
        const result = confirmPaid(db, {
          ...parsed.payment,
          expectedAppId: config.wechat.appId,
          expectedMchId: config.wechat.mchId,
        });
        if (!result.duplicate) console.log('paid', result.order.orderNo, result.anomaly ? 'anomaly' : 'ok');
      }
      res.json({ code: 'SUCCESS', message: '成功' });
    } catch (err) {
      const status = err.status && err.status < 500 ? err.status : 500;
      if (status >= 500) console.error('pay notify', err);
      res.status(status).json({ code: 'FAIL', message: status >= 500 ? '失败' : err.message });
    }
  });

  app.post('/api/admin/login', (req, res, next) => {
    try {
      if (!ready.adminReady) throw new HttpError(503, '商家账号未配置');
      const username = req.body?.username;
      const password = req.body?.password;
      const userOk = sameHash(username, config.merchantUsername);
      const passOk = passwordOk(password, config.merchantPassword);
      if (!userOk || !passOk) throw new HttpError(401, '账号或密码错误');
      const sid = createSession(db, 'merchant', null, 12 * 3600 * 1000);
      writeCookie(res, 'admin_sid', sid, { maxAge: 12 * 3600 * 1000, secure: secureCookie(config) });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/logout', (req, res) => {
    const sid = readCookies(req).admin_sid;
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ? AND kind = ?').run(sid, 'merchant');
    clearCookie(res, 'admin_sid', secureCookie(config));
    res.json({ ok: true });
  });

  app.get('/api/admin/me', (req, res) => {
    res.json({ merchant: req.merchant });
  });

  app.get('/api/admin/readiness', requireMerchant, (_req, res) => {
    res.json(readiness(config));
  });

  app.get('/api/admin/products', requireMerchant, (_req, res) => {
    res.json({ products: listAdminProducts(db) });
  });

  app.post('/api/admin/products', requireMerchant, (req, res, next) => {
    try {
      res.status(201).json({ product: createProduct(db, req.body || {}) });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/products/:id', requireMerchant, (req, res, next) => {
    try {
      res.json({ product: updateProduct(db, Number(req.params.id), req.body || {}) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/orders', requireMerchant, (req, res) => {
    const status = ['paid', 'shipped'].includes(req.query.status) ? req.query.status : 'open';
    res.json({ orders: listMerchantOrders(db, status).map(presentOrder) });
  });

  app.post('/api/admin/orders/:orderNo/ship', requireMerchant, (req, res, next) => {
    try {
      const order = shipOrder(db, {
        orderNo: req.params.orderNo,
        carrier: req.body?.carrier,
        trackingNo: req.body?.trackingNo,
      });
      res.json({ order: presentOrder(order) });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || path.extname(req.path)) return next();
      res.sendFile(indexHtml);
    });
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: '请求格式不正确' });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? '服务器错误' : err.message });
  });

  app.expireDueOrders = (now) => expireDueOrders(db, client, now);
  return app;
}

function requireMerchant(req, _res, next) {
  if (!req.merchant) return next(new HttpError(401, '请先登录商家后台'));
  next();
}

function requireCustomerOrder(db, req) {
  if (!req.customer) throw new HttpError(401, '请先在微信内打开并授权');
  const order = getOrderByNo(db, req.params.orderNo);
  if (!order || order.customerId !== req.customer.id) throw new HttpError(404, '订单不存在');
  return order;
}

function loadCustomer(db, sid, now) {
  const session = loadSession(db, sid, 'customer', now);
  if (!session?.customer_id) return null;
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(session.customer_id);
}

function loadSession(db, sid, kind, now) {
  if (!sid) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND kind = ?').get(sid, kind);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    return null;
  }
  return row;
}

function createSession(db, kind, customerId, ttl) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id, kind, customer_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, kind, customerId, now + ttl, now);
  return id;
}

function upsertCustomer(db, openid) {
  db.prepare('INSERT INTO customers (openid, created_at) VALUES (?, ?) ON CONFLICT(openid) DO NOTHING').run(openid, Date.now());
  return db.prepare('SELECT * FROM customers WHERE openid = ?').get(openid);
}

function secureCookie(config) {
  return config.publicBaseUrl.startsWith('https://');
}

function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/api') || value.startsWith('/admin')) {
    return '/';
  }
  return value;
}

function sameHash(left, right) {
  const a = crypto.createHash('sha256').update(String(left ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(right ?? '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function passwordOk(input, expected) {
  if (typeof input !== 'string' || input.length < 1 || input.length > 200) return false;
  const a = crypto.scryptSync(input, 'vx-order-admin', 32);
  const b = crypto.scryptSync(expected, 'vx-order-admin', 32);
  return crypto.timingSafeEqual(a, b);
}

function seal(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function openSeal(token, secret) {
  if (!secret) return null;
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const text = part.trim();
    if (!text) continue;
    const eq = text.indexOf('=');
    if (eq === -1) continue;
    out[text.slice(0, eq)] = decodeURIComponent(text.slice(eq + 1));
  }
  return out;
}

function writeCookie(res, name, value, { maxAge, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name, secure) {
  writeCookie(res, name, '', { maxAge: 0, secure });
}
