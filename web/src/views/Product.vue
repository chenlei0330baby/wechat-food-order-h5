<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { addToCart, cartCount, cartTotal } from '../cart';
import { yuan } from '../format';
import { showToast } from '../toast';

const route = useRoute();
const router = useRouter();
const product = ref(null);
const missing = ref(false);

onMounted(async () => {
  try {
    const data = await api(`/api/products/${route.params.id}`);
    product.value = data.product;
    document.title = data.product.name;
  } catch (err) {
    missing.value = true;
    showToast(err.message);
  }
});

function add() {
  if (addToCart(product.value, 1)) showToast('已加入清单');
}
</script>

<template>
  <header class="page-head">
    <button class="ghost" type="button" @click="router.push('/')">返回</button>
  </header>
  <p v-if="missing" class="empty">没有这道菜</p>
  <article v-else-if="product" class="card stack">
    <div>
      <p class="kicker">{{ product.subtitle }}</p>
      <h2>{{ product.name }}</h2>
      <p>{{ product.description }}</p>
    </div>
    <div class="line">
      <span class="price">¥{{ yuan(product.priceCents) }}</span>
      <span v-if="product.available === 0" class="soldout">售罄</span>
      <span v-else-if="product.lowStock" class="pill">仅剩 {{ product.available }} 份</span>
      <span v-else class="hint">还有 {{ product.available }} 份</span>
    </div>
    <button class="primary" type="button" :disabled="product.available === 0" @click="add">加入清单</button>
  </article>
  <RouterLink v-if="cartCount() > 0" class="cart-bar" to="/cart">
    <span>{{ cartCount() }} 件</span>
    <strong>去结算 ¥{{ yuan(cartTotal()) }}</strong>
  </RouterLink>
</template>
