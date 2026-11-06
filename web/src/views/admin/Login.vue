<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { showToast } from '../../toast';

const router = useRouter();
const shopName = ref('本店');
const username = ref('admin');
const password = ref('');
const submitting = ref(false);

onMounted(async () => {
  try {
    const config = await api('/api/config');
    shopName.value = config.shopName;
    document.title = `${config.shopName}商家后台`;
    const me = await api('/api/admin/me');
    if (me.merchant) router.replace('/admin');
  } catch {
    /* stay on the login form */
  }
});

async function submit() {
  submitting.value = true;
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    });
    router.replace('/admin');
  } catch (err) {
    showToast(err.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <header class="page-head">
    <div class="seal" aria-hidden="true">店</div>
    <div>
      <p class="kicker">商家后台</p>
      <h1>{{ shopName }}</h1>
    </div>
  </header>
  <form class="card form" @submit.prevent="submit">
    <label>账号<input v-model="username" autocomplete="username" required /></label>
    <label>密码<input v-model="password" type="password" autocomplete="current-password" required /></label>
    <button class="primary" type="submit" :disabled="submitting">登录</button>
  </form>
</template>
