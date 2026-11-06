import { HttpError } from '../errors.js';
import {
  decryptResource,
  readPrivateKey,
  readPublicKey,
  signJsapiPay,
  signMerchantRequest,
  verifyWechatSignature,
} from './crypto.js';

const API_HOST = 'https://api.mch.weixin.qq.com';

export function createWechatClient(config, { fetchImpl = fetch } = {}) {
  const wechat = config.wechat;

  async function request(method, urlPath, json) {
    const payload = json === undefined ? '' : JSON.stringify(json);
    const privateKey = readPrivateKey(wechat.privateKeyPath);
    const { authorization } = signMerchantRequest({
      method,
      urlPath,
      payload,
      mchid: wechat.mchId,
      serial: wechat.mchSerial,
      privateKey,
    });
    let response;
    try {
      response = await fetchImpl(`${API_HOST}${urlPath}`, {
        method,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'vx-order',
          'Wechatpay-Serial': wechat.payPublicKeyId,
        },
        body: payload || undefined,
      });
    } catch (err) {
      console.error('wechat pay network', err.message);
      throw new HttpError(502, '微信支付暂不可用，请稍后再试');
    }

    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      console.error('wechat pay error', response.status, body.code, body.message);
      throw mapWechatError(body.code);
    }
    return body;
  }

  return {
    appId: wechat.appId,
    mchId: wechat.mchId,

    async jsapiOrder({ description, outTradeNo, total, openid }) {
      const result = await request('POST', '/v3/pay/transactions/jsapi', {
        appid: wechat.appId,
        mchid: wechat.mchId,
        description,
        out_trade_no: outTradeNo,
        notify_url: `${config.publicBaseUrl}/api/pay/notify`,
        amount: { total, currency: 'CNY' },
        payer: { openid },
      });
      if (!result.prepay_id) throw new HttpError(502, '微信支付暂不可用，请稍后再试');
      return result;
    },

    query(outTradeNo) {
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${wechat.mchId}`;
      return request('GET', path);
    },

    close(outTradeNo) {
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`;
      return request('POST', path, { mchid: wechat.mchId });
    },

    signPay(prepayId) {
      return signJsapiPay({
        appId: wechat.appId,
        prepayId,
        privateKey: readPrivateKey(wechat.privateKeyPath),
      });
    },

    parseNotify(headers, rawBody) {
      const timestamp = header(headers, 'wechatpay-timestamp');
      const nonce = header(headers, 'wechatpay-nonce');
      const signature = header(headers, 'wechatpay-signature');
      const serial = header(headers, 'wechatpay-serial');
      if (!timestamp || !nonce || !signature || !serial) {
        throw new HttpError(401, '支付通知缺少签名');
      }
      if (serial !== wechat.payPublicKeyId) {
        throw new HttpError(401, '支付通知公钥不匹配');
      }
      const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (!Number.isFinite(skew) || skew > 300) {
        throw new HttpError(401, '支付通知已过期');
      }
      const verified = verifyWechatSignature({
        timestamp,
        nonce,
        body: rawBody,
        signature,
        publicKey: readPublicKey(wechat.payPublicKeyPath),
      });
      if (!verified) throw new HttpError(401, '支付通知签名错误');

      const notice = JSON.parse(rawBody);
      if (notice.event_type !== 'TRANSACTION.SUCCESS') return { ignored: true };
      const resource = notice.resource || {};
      if (resource.algorithm !== 'AEAD_AES_256_GCM') {
        throw new HttpError(400, '不支持的支付通知加密方式');
      }
      let plain;
      try {
        plain = decryptResource({
          apiV3Key: wechat.apiV3Key,
          nonce: resource.nonce,
          associatedData: resource.associated_data,
          ciphertext: resource.ciphertext,
        });
      } catch {
        throw new HttpError(400, '支付通知无法解密');
      }
      const payment = JSON.parse(plain);
      return {
        ignored: false,
        payment: {
          orderNo: payment.out_trade_no,
          transactionId: payment.transaction_id,
          totalCents: payment.amount?.total,
          payerCents: payment.amount?.payer_total,
          appid: payment.appid,
          mchid: payment.mchid,
          openid: payment.payer?.openid,
          tradeState: payment.trade_state,
        },
      };
    },
  };
}

function header(headers, name) {
  if (!headers) return '';
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || '';
}

function mapWechatError(code) {
  if (code === 'NO_AUTH') return new HttpError(502, '店家尚未完成微信支付开通', code);
  if (code === 'APPID_MCHID_NOT_MATCH') return new HttpError(502, '服务号与商户号未绑定', code);
  if (code === 'ORDERPAID' || code === 'ORDER_PAID') return new HttpError(409, '订单已支付', code);
  if (code === 'ORDERCLOSED' || code === 'ORDER_CLOSED') return new HttpError(409, '订单已关闭', code);
  return new HttpError(502, '微信支付暂不可用，请稍后再试', code);
}

export function payDescription(shopName, items) {
  const names = items.map((item) => item.name).join('、');
  const text = `${shopName}-${names}`;
  const chars = Array.from(text);
  return chars.length > 127 ? chars.slice(0, 127).join('') : text;
}
