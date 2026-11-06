import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptResource,
  encryptResource,
  signJsapiPay,
  signMerchantRequest,
  verifyWechatSignature,
} from '../src/wechat/crypto.js';
import { readiness } from '../src/config.js';

test('merchant request signature and jsapi paySign verify with the same key', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signed = signMerchantRequest({
    method: 'POST',
    urlPath: '/v3/pay/transactions/jsapi',
    payload: '{"amount":{"total":1}}',
    mchid: '1234567890',
    serial: 'AABBCCDDEEFF0011',
    privateKey,
  });
  assert.match(signed.authorization, /^WECHATPAY2-SHA256-RSA2048 /);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(signed.message), publicKey, Buffer.from(/signature="([^"]+)"/.exec(signed.authorization)[1], 'base64')), true);

  const pay = signJsapiPay({ appId: 'wx1234567890abcd', prepayId: 'prepay123', privateKey, now: 1_700_000_000_000 });
  const message = `${pay.appId}\n${pay.timeStamp}\n${pay.nonceStr}\n${pay.package}\n`;
  assert.equal(pay.package, 'prepay_id=prepay123');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(message), publicKey, Buffer.from(pay.paySign, 'base64')), true);
});

test('payment notification decrypts and its signature verifies', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const apiV3Key = '12345678901234567890123456789012';
  const plain = JSON.stringify({ out_trade_no: 'D2026100300000001', amount: { total: 300 } });
  const ciphertext = encryptResource({
    apiV3Key,
    nonce: 'nonce12bytes',
    associatedData: 'transaction',
    plaintext: plain,
  });
  assert.equal(decryptResource({
    apiV3Key,
    nonce: 'nonce12bytes',
    associatedData: 'transaction',
    ciphertext,
  }), plain);

  const body = '{"id":"notice"}';
  const timestamp = '1700000000';
  const nonce = 'nonce';
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
  const forged = Buffer.from(signature, 'base64');
  forged[0] ^= 0xff;
  assert.equal(verifyWechatSignature({ timestamp, nonce, body, signature, publicKey }), true);
  assert.equal(verifyWechatSignature({
    timestamp,
    nonce,
    body,
    signature: forged.toString('base64'),
    publicKey,
  }), false);
});

test('readiness stays closed until https domain and pay material are present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-ready-'));
  try {
    const missing = readiness({
      publicBaseUrl: 'http://127.0.0.1:5173',
      sessionSecret: 'short',
      merchantUsername: 'admin',
      merchantPassword: 'short',
      wechat: {
        appId: '',
        appSecret: '',
        mchId: '',
        mchSerial: '',
        privateKeyPath: '',
        apiV3Key: '',
        payPublicKeyPath: '',
        payPublicKeyId: '',
      },
    });
    assert.equal(missing.payReady, false);
    assert.equal(missing.oauthReady, false);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPath = path.join(dir, 'apiclient_key.pem');
    const payPublicKeyPath = path.join(dir, 'wxp_pub.pem');
    fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(payPublicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
    const ready = readiness({
      publicBaseUrl: 'https://order.example.com',
      sessionSecret: '1234567890abcdef',
      merchantUsername: 'admin',
      merchantPassword: 'local-admin-pass',
      wechat: {
        appId: 'wx1234567890abcd',
        appSecret: 'app-secret-value-32chars!!',
        mchId: '1234567890',
        mchSerial: 'AABBCCDDEEFF0011AABBCCDDEEFF0011AABBCCDD',
        privateKeyPath,
        apiV3Key: '12345678901234567890123456789012',
        payPublicKeyPath,
        payPublicKeyId: 'PUB_KEY_ID_00000000000000000000000000000000',
      },
    });
    assert.equal(ready.payReady, true);
    assert.equal(ready.jsapiDir, 'https://order.example.com/');
    assert.equal(ready.notifyUrl, 'https://order.example.com/api/pay/notify');
    assert.equal(ready.oauthDomain, 'order.example.com');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
