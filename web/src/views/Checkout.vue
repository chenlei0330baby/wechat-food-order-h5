<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { cart, cartTotal, clearCart } from '../cart';
import { yuan } from '../format';
import { inWechat } from '../pay';
import { showToast } from '../toast';

const router = useRouter();
const payReady = ref(false);
const customer = ref(false);
const submitting = ref(false);
const form = reactive({
  receiverName: '',
  receiverPhone: '',
  receiverRegion: '',
  receiverDetail: '',
});

onMounted(async () => {
  const draft = sessionStorage.getItem('checkout-draft');
    if (draft) {
      try {
        Object.assign(form, JSON.parse(draft));
      } catch {
        sessionStorage.removeItem('checkout-draft');
      }
    }
  try {
    const [config, me] = await Promise.all([api('/api/config'), api('/api/me')]);
    payReady.value = config.payReady;
    customer.value = Boolean(me.customer);
    document.title = '结算';
  } catch (err) {
    showToast(err.message);
  }
});

function persist() {
  sessionStorage.setItem('checkout-draft', JSON.stringify(form));
}

async function submit() {
  persist();
  if (cart.items.length === 0) return showToast('请先选择商品');
  if (!payReady.value) return showToast('店家还没开通微信支付');
  if (!inWechat()) return showToast('请在微信中打开此链接后再支付');
  if (!customer.value) {
    window.location.href = `/api/auth/wechat?next=${encodeURIComponent('/checkout')}`;
    return;
  }
  submitting.value = true;
  try {
    const { order } = await api('/api/orders', {
      method: 'POST',
      body: {
        ...form,
        items: cart.items.map((item) => ({ productId: item.productId, qty: item.qty })),
      },
    });
    clearCart();
    sessionStorage.removeItem('checkout-draft');
    router.replace(`/orders/${order.orderNo}?pay=1`);
  } catch (err) {
    showToast(err.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <header class="page-head">
    <button class="ghost" type="button" @click="router.push('/cart')">返回</button>
    <h1>收货</h1>
  </header>
  <p v-if="cart.items.length === 0" class="empty">清单是空的</p>
  <form v-else class="stack" @submit.prevent="submit">
    <div class="card form">
      <label>收货人<input v-model="form.receiverName" required maxlength="30" autocomplete="name" @change="persist" /></label>
      <label>手机号<input v-model="form.receiverPhone" required inputmode="numeric" maxlength="11" autocomplete="tel" @change="persist" /></label>
      <label>省市区<input v-model="form.receiverRegion" required maxlength="40" placeholder="例如 上海市浦东新区" @change="persist" /></label>
      <label>详细地址<textarea v-model="form.receiverDetail" required maxlength="120" @change="persist"></textarea></label>
    </div>
    <section class="card">
      <div v-for="item in cart.items" :key="item.productId" class="line">
        <span>{{ item.name }} × {{ item.qty }}</span>
        <span>¥{{ yuan(item.priceCents * item.qty) }}</span>
      </div>
      <p class="line total"><span>应付</span><span>¥{{ yuan(cartTotal()) }}</span></p>
    </section>
    <p class="note">支付成功后由店家快递发出。未支付的订单大约 15 分钟后关闭，库存会释放。线上退款还没开放，需要退款请联系店家。</p>
    <p v-if="!payReady" class="note">店家还没完成微信支付配置，现在不能收款。</p>
    <p v-else-if="!inWechat()" class="note">请用微信打开这个点单链接，才能拉起微信支付。</p>
    <button class="primary" type="submit" :disabled="submitting || !payReady">
      {{ customer ? '提交并支付' : '微信授权并支付' }}
    </button>
  </form>
</template>
