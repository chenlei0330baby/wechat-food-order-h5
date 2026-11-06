import crypto from 'node:crypto';
import fs from 'node:fs';

const keyCache = new Map();

export function readPrivateKey(file) {
  return readKey(file, crypto.createPrivateKey);
}

export function readPublicKey(file) {
  return readKey(file, crypto.createPublicKey);
}

function readKey(file, factory) {
  if (!keyCache.has(file)) {
    keyCache.set(file, factory(fs.readFileSync(file)));
  }
  return keyCache.get(file);
}

export function clearKeyCache() {
  keyCache.clear();
}

export function signMerchantRequest({ method, urlPath, payload = '', mchid, serial, privateKey }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${payload}\n`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
  const authorization =
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",` +
    `signature="${signature}",timestamp="${timestamp}",serial_no="${serial}"`;
  return { authorization, timestamp, nonce, message };
}

export function signJsapiPay({ appId, prepayId, privateKey, now = Date.now() }) {
  const timeStamp = Math.floor(now / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pack = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pack}\n`;
  const paySign = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
  return {
    appId,
    timeStamp,
    nonceStr,
    package: pack,
    signType: 'RSA',
    paySign,
  };
}

export function verifyWechatSignature({ timestamp, nonce, body, signature, publicKey }) {
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(message),
    publicKey,
    Buffer.from(signature, 'base64'),
  );
}

export function decryptResource({ apiV3Key, nonce, associatedData, ciphertext }) {
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== 32) {
    throw new Error('APIv3 密钥长度不正确');
  }
  const buffer = Buffer.from(ciphertext, 'base64');
  const data = buffer.subarray(0, buffer.length - 16);
  const tag = buffer.subarray(buffer.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(associatedData || '', 'utf8'));
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function encryptResource({ apiV3Key, nonce, associatedData, plaintext }) {
  const key = Buffer.from(apiV3Key, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData || '', 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
}
