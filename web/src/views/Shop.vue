<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { addToCart, cartCount, cartTotal } from '../cart';
import { yuan } from '../format';
import { showToast } from '../toast';

const route = useRoute();
const shopName = ref('本店');
const products = ref([]);
const loading = ref(true);
const failed = ref(false);

onMounted(async () => {
  if (route.query.auth === 'fail') showToast('微信授权没有完成，请重试');
  if (route.query.auth === 'unready') showToast('服务号还没配置完成');
  try {
    const [config, list] = await Promise.all([api('/api/config'), api('/api/products')]);
    shopName.value = config.shopName;
    document.title = `${config.shopName}点单`;
    products.value = list.products;
  } catch (err) {
    failed.value = true;
    showToast(err.message);
  } finally {
    loading.value = false;
  }
});

function add(product) {
  addToCart(product, 1);
}
</script>

<template>
  <header class="mast">
    <div class="seal" aria-hidden="true">点</div>
    <div>
      <p class="kicker">今日供应</p>
      <h1>{{ shopName }}</h1>
    </div>
    <div class="spacer"></div>
    <RouterLink class="nav-link" to="/orders">订单</RouterLink>
  </header>

  <p v-if="loading" class="hint">正在摆上菜单…</p>
  <p v-else-if="failed" class="empty">菜单没有加载出来</p>
  <p v-else-if="products.length === 0" class="empty">今天还没有上架的菜</p>
  <section v-else class="menu">
    <article v-for="product in products" :key="product.id" class="dish">
      <div>
        <h2><RouterLink :to="`/p/${product.id}`">{{ product.name }}</RouterLink></h2>
        <p class="hint">{{ product.subtitle }}</p>
        <p v-if="product.lowStock" class="pill">仅剩 {{ product.available }} 份</p>
      </div>
      <div class="dish-side">
        <span class="price">¥{{ yuan(product.priceCents) }}</span>
        <button
          v-if="product.available > 0"
          class="add"
          type="button"
          :aria-label="`把${product.name}加入清单`"
          @click="add(product)"
        >+</button>
        <span v-else class="soldout">售罄</span>
      </div>
    </article>
  </section>

  <RouterLink v-if="cartCount() > 0" class="cart-bar" to="/cart">
    <span>{{ cartCount() }} 件</span>
    <strong>去结算 ¥{{ yuan(cartTotal()) }}</strong>
  </RouterLink>
</template>
