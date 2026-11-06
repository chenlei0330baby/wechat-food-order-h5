<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { formatTime, statusLabel, yuan } from '../format';
import { inWechat, invokeWechatPay } from '../pay';
import { showToast } from '../toast';

const route = useRoute();
const router = useRouter();
const order = ref(null);
const missing = ref(false);
const paying = ref(false);
const now = ref(Date.now());
let clock = 0;

const remaining = computed(() => {
  if (!order.value || order.value.status !== 'pending') return 0;
  return Math.max(0, order.value.payExpireAt - now.value);
});

onMounted(async () => {
  clock = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  await load();
  if (route.query.pay === '1' && order.value?.status === 'pending') startPay();
});

onUnmounted(() => clearInterval(clock));

async function load() {
  try {
    const data = await api(`/api/orders/${route.params.orderNo}`);
    order.value = data.order;
    document.title = `订单 ${data.order.orderNo}`;
  } catch (err) {
    missing.value = true;
    showToast(err.message);
  }
}

async function startPay() {
  if (!inWechat()) {
    showToast('请在微信中打开此链接后再支付');
    return;
  }
  paying.value = true;
  try {
    const { payment } = await api(`/api/orders/${route.params.orderNo}/pay`, { method: 'POST' });
    await invokeWechatPay(payment);
    const synced = await api(`/api/orders/${route.params.orderNo}/sync`, { method: 'POST' });
    order.value = synced.order;
    if (order.value.status === 'paid') showToast('支付成功');
  } catch (err) {
    showToast(err.message === 'cancel' ? '已取消支付' : err.message);
    await load();
  } finally {
    paying.value = false;
  }
}

function minutesLeft() {
  const total = Math.ceil(remaining.value / 1000);
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${min}:${sec}`;
}
</script>

<template>
  <header class="page-head">
    <button class="ghost" type="button" @click="router.push('/orders')">订单</button>
    <h1>详情</h1>
  </header>
  <p v-if="missing" class="empty">找不到这张订单</p>
  <article v-else-if="order" class="stack">
    <section class="card">
      <p class="kicker">{{ order.orderNo }}</p>
      <h2>{{ statusLabel(order.status) }}</h2>
      <p v-if="order.payAnomaly" class="pill bad">已收到付款，但库存不足，请联系店家处理。</p>
      <p v-else-if="order.status === 'pending'" class="hint">请在 {{ minutesLeft() }} 内完成支付，超时将关闭并释放库存。</p>
      <p v-else-if="order.status === 'closed'" class="hint">订单已关闭。如果已经扣款但没有发货，请联系店家。</p>
      <p v-else-if="order.status === 'shipped'" class="hint">{{ order.carrier }} {{ order.trackingNo }}</p>
    </section>
    <section class="card">
      <div v-for="item in order.items" :key="item.productId" class="line">
        <span>{{ item.name }} × {{ item.qty }}</span>
        <span>¥{{ yuan(item.priceCents * item.qty) }}</span>
      </div>
      <p class="line total"><span>合计</span><span>¥{{ yuan(order.totalCents) }}</span></p>
    </section>
    <section class="card">
      <p>{{ order.receiverName }} {{ order.receiverPhone }}</p>
      <p class="hint">{{ order.receiverRegion }} {{ order.receiverDetail }}</p>
      <p class="meta">下单 {{ formatTime(order.createdAt) }}</p>
      <p v-if="order.shippedAt" class="meta">发货 {{ formatTime(order.shippedAt) }}</p>
    </section>
    <button v-if="order.status === 'pending'" class="primary" type="button" :disabled="paying" @click="startPay">
      {{ paying ? '正在拉起支付…' : '微信支付' }}
    </button>
  </article>
</template>
