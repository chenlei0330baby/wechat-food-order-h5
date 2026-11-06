<script setup>
import { useRouter } from 'vue-router';
import { cart, cartTotal, setQty } from '../cart';
import { yuan } from '../format';

const router = useRouter();
</script>

<template>
  <header class="page-head">
    <button class="ghost" type="button" @click="router.push('/')">菜单</button>
    <h1>清单</h1>
  </header>
  <p v-if="cart.items.length === 0" class="empty">还没选菜</p>
  <section v-else class="card">
    <div v-for="item in cart.items" :key="item.productId" class="line">
      <div>
        <strong>{{ item.name }}</strong>
        <p class="hint">¥{{ yuan(item.priceCents) }}</p>
      </div>
      <div class="row-actions">
        <button class="icon-btn" type="button" :aria-label="`减少${item.name}`" @click="setQty(item.productId, item.qty - 1)">−</button>
        <span>{{ item.qty }}</span>
        <button class="icon-btn" type="button" :aria-label="`增加${item.name}`" @click="setQty(item.productId, item.qty + 1)">+</button>
      </div>
    </div>
    <p class="line total"><span>合计</span><span>¥{{ yuan(cartTotal()) }}</span></p>
    <button class="primary" type="button" @click="router.push('/checkout')">填写地址并支付</button>
  </section>
</template>
