import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function repoRoot() {
  return root;
}

export function loadEnvFile(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function resolvePath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function timeoutMs(env) {
  const minutes = Number(env.PAY_TIMEOUT_MINUTES || 15);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 120) return 15 * 60 * 1000;
  return Math.round(minutes) * 60 * 1000;
}

export function loadConfig(env = process.env) {
  const publicBaseUrl = (env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  return {
    port: Number(env.PORT || 3000),
    shopName: (env.SHOP_NAME || '本店').trim() || '本店',
    publicBaseUrl,
    dataDir: resolvePath(env.DATA_DIR || 'data'),
    sessionSecret: (env.SESSION_SECRET || '').trim(),
    merchantUsername: (env.MERCHANT_USERNAME || '').trim(),
    merchantPassword: env.MERCHANT_PASSWORD || '',
    payTimeoutMs: timeoutMs(env),
    wechat: {
      appId: (env.WECHAT_APP_ID || '').trim(),
      appSecret: (env.WECHAT_APP_SECRET || '').trim(),
      mchId: (env.WECHAT_MCH_ID || '').trim(),
      mchSerial: (env.WECHAT_MCH_CERT_SERIAL || '').trim(),
      privateKeyPath: resolvePath((env.WECHAT_MCH_PRIVATE_KEY_PATH || '').trim()),
      apiV3Key: (env.WECHAT_API_V3_KEY || '').trim(),
      payPublicKeyPath: resolvePath((env.WECHAT_PAY_PUBLIC_KEY_PATH || '').trim()),
      payPublicKeyId: (env.WECHAT_PAY_PUBLIC_KEY_ID || '').trim(),
    },
  };
}

function httpsOrigin(publicBaseUrl) {
  try {
    const url = new URL(publicBaseUrl);
    const portOk = url.port === '' || url.port === '443';
    const hostOk = url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';
    const pathOk = url.pathname === '/' && !url.search && !url.hash;
    return {
      ok: url.protocol === 'https:' && portOk && hostOk && pathOk,
      hostname: url.hostname,
    };
  } catch {
    return { ok: false, hostname: '' };
  }
}

function fileOk(file) {
  return Boolean(file) && fs.existsSync(file) && fs.statSync(file).isFile();
}

export function readiness(config) {
  const wechat = config.wechat;
  const origin = httpsOrigin(config.publicBaseUrl);
  const checks = [
    {
      id: 'appId',
      label: '服务号 AppID',
      ok: /^wx[a-zA-Z0-9]{10,30}$/.test(wechat.appId),
      hint: '注册并认证服务号后，从公众平台「基本配置」复制 AppID。',
    },
    {
      id: 'appSecret',
      label: '服务号 AppSecret',
      ok: wechat.appSecret.length >= 16,
      hint: '在公众平台生成 AppSecret，写入 WECHAT_APP_SECRET。不要发到聊天里。',
    },
    {
      id: 'httpsOrigin',
      label: '已备案的 HTTPS 域名',
      ok: origin.ok,
      hint: 'PUBLIC_BASE_URL 填 https://你的域名，不要带端口、路径或本地地址。',
    },
    {
      id: 'mchId',
      label: '微信支付商户号',
      ok: /^\d{8,12}$/.test(wechat.mchId),
      hint: '商户平台 → 账户中心 → 商户信息。并确认已绑定上面的服务号 AppID。',
    },
    {
      id: 'mchSerial',
      label: '商户 API 证书序列号',
      ok: /^[A-Fa-f0-9]{16,64}$/.test(wechat.mchSerial),
      hint: '商户平台 → 账户中心 → API 安全 → 商户 API 证书，查看证书序列号。',
    },
    {
      id: 'privateKey',
      label: '商户 API 私钥文件',
      ok: fileOk(wechat.privateKeyPath),
      hint: '把 apiclient_key.pem 放到 secrets/，路径写在 WECHAT_MCH_PRIVATE_KEY_PATH。',
    },
    {
      id: 'apiV3Key',
      label: 'APIv3 密钥',
      ok: wechat.apiV3Key.length === 32,
      hint: '在商户平台设置 32 位 APIv3 密钥。设置后无法再查看。',
    },
    {
      id: 'payPublicKey',
      label: '微信支付公钥文件',
      ok: fileOk(wechat.payPublicKeyPath),
      hint: '申请微信支付公钥，把 pem 放到 secrets/wxp_pub.pem。',
    },
    {
      id: 'payPublicKeyId',
      label: '微信支付公钥 ID',
      ok: wechat.payPublicKeyId.startsWith('PUB_KEY_ID_'),
      hint: '与公钥一起出现的 ID，写入 WECHAT_PAY_PUBLIC_KEY_ID。',
    },
    {
      id: 'sessionSecret',
      label: '登录签名密钥',
      ok: config.sessionSecret.length >= 16,
      hint: 'SESSION_SECRET 至少 16 位随机字符。',
    },
    {
      id: 'merchantPassword',
      label: '商家后台密码',
      ok: config.merchantUsername.length >= 1 && config.merchantPassword.length >= 8,
      hint: '设置 MERCHANT_USERNAME 和至少 8 位的 MERCHANT_PASSWORD。',
    },
  ];

  const ok = (id) => checks.find((item) => item.id === id)?.ok;
  const oauthReady = Boolean(ok('appId') && ok('appSecret') && ok('httpsOrigin') && ok('sessionSecret'));
  const payReady = oauthReady && ['mchId', 'mchSerial', 'privateKey', 'apiV3Key', 'payPublicKey', 'payPublicKeyId'].every((id) => ok(id));
  const base = origin.ok ? config.publicBaseUrl : '';

  return {
    checks,
    oauthReady,
    payReady,
    adminReady: Boolean(ok('merchantPassword') && ok('sessionSecret')),
    hostname: origin.hostname,
    oauthDomain: origin.ok ? origin.hostname : '',
    jsapiDir: base ? `${base}/` : '',
    notifyUrl: base ? `${base}/api/pay/notify` : '',
    orderUrl: base ? `${base}/` : '',
    appId: ok('appId') ? wechat.appId : '',
    mchId: ok('mchId') ? wechat.mchId : '',
  };
}
