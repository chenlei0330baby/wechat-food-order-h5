# 单店点单

微信里打开的点单网页：选商品、填收货地址、用服务号 JSAPI 收款、商家填快递单号。不是小程序。

第一期只做这些：商品和数量库存、下单预占、支付成功才真正扣库存、超时未支付关单、已支付订单发货。没有退款、多规格、优惠券和微信外浏览器支付。

## 本地运行

需要 Node.js 22.13 或更新版本。

```bash
cp .env.example .env
```

至少填上 `MERCHANT_PASSWORD`（至少 8 位）和 `SESSION_SECRET`（至少 16 位）。微信支付相关项可以先空着，页面能浏览，但不能收款。

```bash
npm install
npm test
npm run dev
```

点单页是 http://127.0.0.1:5173 ，商家后台是 http://127.0.0.1:5173/admin 。首次启动会放入几道示例菜，可在后台改掉或下架。

## 开通真实收款

注册认证服务号、备案域名、绑定商户号、放置证书，按 [docs/wechat-setup.md](docs/wechat-setup.md) 做。做完后执行：

```bash
npm run check
npm run build
npm start
```

`npm run check` 退出码为 0 时，商家后台「收款开通」里的项目才算齐。没齐之前，结算按钮不会向微信下单。

密钥、AppSecret 和 pem 私钥只放在服务器的 `.env` 与 `secrets/`，不要发到聊天里，也不要提交到仓库。
