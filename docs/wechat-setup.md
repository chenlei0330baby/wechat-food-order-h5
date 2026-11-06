# 开通微信内点单收款

这个系统是手机网页，不是小程序。用户在微信里打开链接，用服务号的 JSAPI 付款。没有已认证服务号、已备案的 HTTPS 域名、以及和商户号的绑定，页面可以打开，但付不了款。

不要把 AppSecret、APIv3 密钥、API 证书私钥、登录密码发到聊天或放进仓库。它们只写在服务器的 `.env` 和 `secrets/` 里。

## 1. 注册并认证服务号

个人不能注册服务号。主体用个体工商户或企业，并尽量和微信支付商户号是同一个主体。

1. 打开 [微信公众平台](https://mp.weixin.qq.com)，立即注册。
2. 账号类型选 **服务号**。不要选订阅号，也不要选小程序。
3. 准备一个没用过的邮箱、已实名的管理员微信、营业执照、法人身份证。
4. 企业用对公账户验证，个体工商户按页面提示用法人银行卡验证。微信会打一笔小额，你再把金额填回去。
5. 注册完成后立刻做 **微信认证**（目前一般 300 元/年）。不认证就不能做网页授权，也不能 JSAPI 收款。
6. 认证通过后，在「设置与开发 → 基本配置」复制 **AppID**，并生成 **AppSecret**。AppSecret 只显示一次，写入 `.env` 的 `WECHAT_APP_SECRET`。

## 2. 把已有商户号绑到这个服务号

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com)。
2. 产品中心 → AppID 账号管理 → 关联 AppID，填服务号 AppID。
3. 公众平台侧按提示确认绑定。

商户号写到 `WECHAT_MCH_ID`。绑定没完成时，下单会报服务号和商户号不匹配。

## 3. 准备备案域名

1. 准备一个域名，做 ICP 备案。备案主体尽量和商户号主体一致，否则微信审核网页授权域名时容易被拒。
2. 域名解析到这台服务器，配置 HTTPS 证书。微信不接受裸 IP，也不接受自签证书。
3. 把根地址写到 `PUBLIC_BASE_URL`，例如 `https://order.example.com`。不要加路径，不要加末尾斜杠以外的目录。

然后在两个后台填写本系统商家后台「收款开通」页给出的值：

- 公众平台 → 设置与开发 → 账号设置 → 功能设置 → **网页授权域名**：只填主机名，例如 `order.example.com`。按页面要求上传校验文件。
- 商户平台 → 产品中心 → 开发配置 → JSAPI 支付 → **支付授权目录**：填 `https://order.example.com/`，末尾必须有 `/`。目录必须覆盖调起支付的页面。用网站根目录可以盖住全部页面。

支付结果通知地址由系统固定为：

`https://order.example.com/api/pay/notify`

这个地址要能从公网访问到本服务，不需要在商户平台单独填一份白名单，但下单时会把它传给微信。

上线可用的反代示例（证书由你现有的 Nginx 或 Caddy 终止）：

```nginx
server {
  listen 443 ssl;
  server_name order.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

生产环境在仓库根目录执行 `npm run build && npm start`，由 Node 同时提供网页和接口。

## 4. 放上 APIv3 证书和公钥

在商户平台 → 账户中心 → API 安全：

1. 申请商户 API 证书。下载后，把 `apiclient_key.pem` 放到 `secrets/apiclient_key.pem`。证书序列号写入 `WECHAT_MCH_CERT_SERIAL`。
2. 设置 32 位 APIv3 密钥，写入 `WECHAT_API_V3_KEY`。平台之后不再显示它。
3. 申请微信支付公钥，把 pem 放到 `secrets/wxp_pub.pem`，公钥 ID 写入 `WECHAT_PAY_PUBLIC_KEY_ID`。

不需要 APIv2 密钥。本系统不接微信外浏览器的 H5（MWEB）支付。

改完 `.env` 或替换 pem 后重启进程。商家后台的「收款开通」每一项变成就绪后，顾客才能在微信里付款。

## 5. 食品资质

卖餐饮食品，微信商户号的经营类目可能要求食品经营许可。系统不上传、不代审这些证件。类目和资质在商户平台按你的实际经营准备。
