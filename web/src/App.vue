<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { toast } from './toast';

const route = useRoute();
const isAdmin = computed(() => route.path.startsWith('/admin'));
</script>

<template>
  <div class="app" :class="{ admin: isAdmin }">
    <RouterView />
  </div>
  <p v-if="toast.text" class="toast" role="status">{{ toast.text }}</p>
</template>
