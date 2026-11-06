import path from 'node:path';
import { loadConfig, loadEnvFile, readiness } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './http.js';
import { expireDueOrders } from './orders.js';
import { createWechatClient } from './wechat/client.js';

loadEnvFile();
const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, 'shop.sqlite'));
const ready = readiness(config);
const wechat = ready.payReady ? createWechatClient(config) : null;
const app = createApp({ config, db, wechat });

async function tick() {
  try {
    await expireDueOrders(db, wechat);
  } catch (err) {
    console.error('expire orders', err);
  }
}

tick();
setInterval(tick, 30_000);

app.listen(config.port, () => {
  console.log(`${config.shopName} 已启动，端口 ${config.port}`);
  if (!ready.payReady) console.log('微信支付还没配齐。打开商家后台的「收款开通」查看缺哪一项。');
});
