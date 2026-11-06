<script setup>
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <header class="page-head">
    <h1>没有这一页</h1>
  </header>
  <button class="primary" type="button" @click="router.push('/')">回菜单</button>
</template>
