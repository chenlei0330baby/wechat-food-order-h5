import { loadConfig, loadEnvFile, readiness } from './config.js';

loadEnvFile();
const ready = readiness(loadConfig());
for (const check of ready.checks) {
  console.log(`${check.ok ? 'OK   ' : '待完成'}  ${check.label}`);
  if (!check.ok) console.log(`       ${check.hint}`);
}
if (ready.oauthDomain) {
  console.log(`网页授权域名  ${ready.oauthDomain}`);
  console.log(`JSAPI 支付目录  ${ready.jsapiDir}`);
  console.log(`支付通知地址  ${ready.notifyUrl}`);
  console.log(`点单链接  ${ready.orderUrl}`);
}
process.exit(ready.payReady && ready.adminReady ? 0 : 1);
