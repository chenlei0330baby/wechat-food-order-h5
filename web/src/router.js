import { createRouter, createWebHistory } from 'vue-router';
import { api } from './api';
import Shop from './views/Shop.vue';
import Product from './views/Product.vue';
import Cart from './views/Cart.vue';
import Checkout from './views/Checkout.vue';
import Orders from './views/Orders.vue';
import OrderDetail from './views/OrderDetail.vue';
import NotFound from './views/NotFound.vue';
import AdminLogin from './views/admin/Login.vue';
import AdminHome from './views/admin/Home.vue';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior() {
    return { top: 0 };
  },
  routes: [
    { path: '/', component: Shop },
    { path: '/p/:id', component: Product },
    { path: '/cart', component: Cart },
    { path: '/checkout', component: Checkout },
    { path: '/orders', component: Orders },
    { path: '/orders/:orderNo', component: OrderDetail },
    { path: '/admin/login', component: AdminLogin },
    { path: '/admin', component: AdminHome },
    { path: '/:pathMatch(.*)*', component: NotFound },
  ],
});

router.beforeEach(async (to) => {
  if (to.path !== '/admin') return true;
  try {
    const { merchant } = await api('/api/admin/me');
    if (!merchant) return '/admin/login';
  } catch {
    return '/admin/login';
  }
  return true;
});
