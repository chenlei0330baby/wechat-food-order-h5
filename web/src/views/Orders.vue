<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { formatTime, statusLabel, yuan } from '../format';
import { showToast } from '../toast';

const router = useRouter();
const orders = ref([]);
const loading = ref(true);
const loggedOut = ref(false);

onMounted(async () => {
  try {
    const data = await api('/api/orders');
    orders.value = data.orders;
    document.title = '我的订单';
  } catch (err) {
    loggedOut.value = true;
    if (!err.message.includes('微信')) showToast(err.message);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <header class="page-head">
    <button class="ghost" type="button" @click="router.push('/')">菜单</button>
    <h1>订单</h1>
  </header>
  <p v-if="loading" class="hint">正在读取订单…</p>
  <p v-else-if="loggedOut" class="empty">在微信里打开并完成授权后，才能看到自己的订单。</p>
  <p v-else-if="orders.length === 0" class="empty">还没有订单</p>
  <section v-else class="stack">
    <RouterLink v-for="order in orders" :key="order.orderNo" class="order-card" :to="`/orders/${order.orderNo}`">
      <div class="line">
        <strong>{{ statusLabel(order.status) }}</strong>
        <span>¥{{ yuan(order.totalCents) }}</span>
      </div>
      <p class="hint">{{ order.items.map((item) => `${item.name}×${item.qty}`).join('、') }}</p>
      <p class="meta">{{ formatTime(order.createdAt) }} · {{ order.orderNo }}</p>
    </RouterLink>
  </section>
</template>
