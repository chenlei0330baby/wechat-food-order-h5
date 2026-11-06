<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { yuan, yuanToCents, formatTime, statusLabel } from '../../format';
import { showToast } from '../../toast';

const router = useRouter();
const shopName = ref('本店');
const tab = ref('orders');
const ready = ref(null);
const products = ref([]);
const orders = ref([]);
const orderTab = ref('paid');
const ordersLoading = ref(false);
const carriers = ['顺丰', '京东', '邮政', '中通', '圆通', '申通', '韵达', '极兔', '其他'];
const ship = reactive({});
const form = reactive({
  name: '',
  subtitle: '',
  description: '',
  price: '',
  stock: '0',
  lowStockThreshold: '5',
  onSale: true,
});

const doneCount = computed(() => ready.value?.checks.filter((item) => item.ok).length || 0);

onMounted(async () => {
  try {
    await refresh();
    if (ready.value && !ready.value.payReady) tab.value = 'setup';
  } catch (err) {
    showToast(err.message);
  }
});

async function refresh() {
  const [config, readiness, productData, orderData] = await Promise.all([
    api('/api/config'),
    api('/api/admin/readiness'),
    api('/api/admin/products'),
    api(`/api/admin/orders?status=${orderTab.value}`),
  ]);
  shopName.value = config.shopName;
  document.title = `${config.shopName}商家后台`;
  ready.value = readiness;
  products.value = productData.products.map(withDraft);
  rememberOrders(orderData.orders);
}

function withDraft(product) {
  return {
    ...product,
    priceDraft: (product.priceCents / 100).toFixed(2).replace(/\.00$/, ''),
    stockDraft: String(product.stockOnHand),
    lowDraft: String(product.lowStockThreshold),
  };
}

function rememberOrders(list) {
  orders.value = list;
  for (const order of list) {
    if (!ship[order.orderNo]) {
      ship[order.orderNo] = { carrier: order.carrier || '顺丰', trackingNo: order.trackingNo || '' };
    }
  }
}

async function switchOrders(status) {
  orderTab.value = status;
  ordersLoading.value = true;
  try {
    const data = await api(`/api/admin/orders?status=${status}`);
    rememberOrders(data.orders);
  } catch (err) {
    showToast(err.message);
  } finally {
    ordersLoading.value = false;
  }
}

async function createDish() {
  try {
    await api('/api/admin/products', {
      method: 'POST',
      body: {
        name: form.name,
        subtitle: form.subtitle,
        description: form.description,
        priceCents: yuanToCents(form.price),
        stockOnHand: Number(form.stock),
        lowStockThreshold: Number(form.lowStockThreshold),
        onSale: form.onSale,
      },
    });
    form.name = '';
    form.subtitle = '';
    form.description = '';
    form.price = '';
    form.stock = '0';
    showToast('已上架');
    await refresh();
  } catch (err) {
    showToast(err.message);
  }
}

async function saveProduct(product) {
  try {
    await api(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      body: {
        name: product.name,
        subtitle: product.subtitle,
        description: product.description,
        priceCents: yuanToCents(product.priceDraft),
        stockOnHand: Number(product.stockDraft),
        lowStockThreshold: Number(product.lowDraft),
        onSale: product.onSale,
      },
    });
    showToast('已保存');
    await refresh();
  } catch (err) {
    showToast(err.message);
  }
}

async function send(order) {
  const draft = ship[order.orderNo] || {};
  try {
    await api(`/api/admin/orders/${order.orderNo}/ship`, {
      method: 'POST',
      body: { carrier: draft.carrier || '顺丰', trackingNo: draft.trackingNo || '' },
    });
    showToast('已发货');
    await switchOrders(orderTab.value);
  } catch (err) {
    showToast(err.message);
  }
}

async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch {
    showToast('请手动复制');
  }
}

async function logout() {
  await api('/api/admin/logout', { method: 'POST' });
  router.replace('/admin/login');
}

</script>

<template>
  <header class="admin-head">
    <div>
      <p class="kicker">商家后台</p>
      <h1>{{ shopName }}</h1>
    </div>
    <div class="spacer"></div>
    <RouterLink class="nav-link" to="/">看点单页</RouterLink>
    <button class="ghost" type="button" @click="logout">退出</button>
  </header>

  <nav class="tabs">
    <button class="tab" :class="{ active: tab === 'orders' }" type="button" @click="tab = 'orders'">订单</button>
    <button class="tab" :class="{ active: tab === 'products' }" type="button" @click="tab = 'products'">商品</button>
    <button class="tab" :class="{ active: tab === 'setup' }" type="button" @click="tab = 'setup'">收款开通 {{ doneCount }}/{{ ready?.checks.length || 0 }}</button>
  </nav>

  <section v-if="tab === 'setup' && ready" class="stack">
    <p class="note">服务号要你自己在微信公众平台注册并认证。这里只检查服务器有没有拿到接入所需的配置，不会保存你的证书内容到页面上。</p>
    <article v-for="check in ready.checks" :key="check.id" class="panel check">
      <span class="pill" :class="check.ok ? 'ok' : 'bad'">{{ check.ok ? '就绪' : '待完成' }}</span>
      <strong>{{ check.label }}</strong>
      <span></span>
      <p v-if="!check.ok">{{ check.hint }}</p>
    </article>
    <article class="panel stack">
      <h2>填到微信后台的地址</h2>
      <label class="copy">网页授权域名<input :value="ready.oauthDomain || '配置 HTTPS 域名后显示'" readonly /><button class="ghost" type="button" @click="copy(ready.oauthDomain)">复制</button></label>
      <label class="copy">JSAPI 支付授权目录<input :value="ready.jsapiDir || '配置 HTTPS 域名后显示'" readonly /><button class="ghost" type="button" @click="copy(ready.jsapiDir)">复制</button></label>
      <label class="copy">支付通知地址<input :value="ready.notifyUrl || '配置 HTTPS 域名后显示'" readonly /><button class="ghost" type="button" @click="copy(ready.notifyUrl)">复制</button></label>
      <label class="copy">点单链接<input :value="ready.orderUrl || '配置 HTTPS 域名后显示'" readonly /><button class="ghost" type="button" @click="copy(ready.orderUrl)">复制</button></label>
      <p v-if="ready.appId" class="hint">服务号 AppID：{{ ready.appId }}</p>
      <p v-if="ready.mchId" class="hint">商户号：{{ ready.mchId }}。请在商户平台确认它已经绑定这个 AppID。</p>
    </article>
  </section>

  <section v-else-if="tab === 'products'" class="admin-grid two">
    <form class="panel form" @submit.prevent="createDish">
      <h2>上架</h2>
      <label>名称<input v-model="form.name" required maxlength="40" /></label>
      <label>简介<input v-model="form.subtitle" maxlength="40" /></label>
      <label>描述<textarea v-model="form.description" maxlength="500"></textarea></label>
      <label>价格（元）<input v-model="form.price" inputmode="decimal" required placeholder="38 或 38.50" /></label>
      <label>库存<input v-model="form.stock" inputmode="numeric" required /></label>
      <label>低库存提醒<input v-model="form.lowStockThreshold" inputmode="numeric" /></label>
      <label class="checkline"><input v-model="form.onSale" type="checkbox" /> 立即上架</label>
      <button class="primary" type="submit">保存商品</button>
    </form>
    <div class="stack">
      <article v-for="product in products" :key="product.id" class="panel form">
        <h2>{{ product.name }}</h2>
        <p class="hint">待支付占用 {{ product.stockReserved }} · 可售 {{ product.available }}</p>
        <label>名称<input v-model="product.name" /></label>
        <label>简介<input v-model="product.subtitle" /></label>
        <label>价格（元）<input v-model="product.priceDraft" /></label>
        <label>实物库存<input v-model="product.stockDraft" /></label>
        <label>低库存提醒<input v-model="product.lowDraft" /></label>
        <label class="checkline"><input v-model="product.onSale" type="checkbox" /> 上架</label>
        <button class="primary" type="button" @click="saveProduct(product)">保存</button>
      </article>
    </div>
  </section>

  <section v-else class="stack">
    <nav class="tabs">
      <button class="tab" :class="{ active: orderTab === 'paid' }" type="button" @click="switchOrders('paid')">待发货</button>
      <button class="tab" :class="{ active: orderTab === 'shipped' }" type="button" @click="switchOrders('shipped')">已发货</button>
    </nav>
    <p v-if="ordersLoading" class="hint">正在读取订单…</p>
    <p v-else-if="orders.length === 0" class="empty">没有{{ orderTab === 'paid' ? '待发货' : '已发货' }}订单</p>
    <article v-for="order in orders" :key="order.orderNo" class="order-card stack">
      <div class="line">
        <strong>{{ order.payAnomaly ? '收款异常' : statusLabel(order.status) }}</strong>
        <span>¥{{ yuan(order.totalCents) }}</span>
      </div>
      <p>{{ order.receiverName }} {{ order.receiverPhone }}</p>
      <p class="hint">{{ order.receiverRegion }} {{ order.receiverDetail }}</p>
      <p class="hint">{{ order.items.map((item) => `${item.name}×${item.qty}`).join('、') }}</p>
      <p class="meta">{{ formatTime(order.createdAt) }} · {{ order.orderNo }}</p>
      <p v-if="order.payAnomaly" class="pill bad">顾客已付款，但关闭订单后库存不够，不能自动发货。</p>
      <p v-if="order.trackingNo" class="hint">{{ order.carrier }} {{ order.trackingNo }}</p>
      <form v-if="order.status === 'paid'" class="form" @submit.prevent="send(order)">
        <label>快递公司
          <select v-model="ship[order.orderNo].carrier">
            <option v-for="carrier in carriers" :key="carrier">{{ carrier }}</option>
          </select>
        </label>
        <label>快递单号<input v-model="ship[order.orderNo].trackingNo" required placeholder="至少 6 位字母或数字" /></label>
        <button class="primary" type="submit">确认发货</button>
      </form>
    </article>
  </section>
</template>
