import { reactive, watch } from 'vue';
import { showToast } from './toast';

const saved = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('vx-cart') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

export const cart = reactive({ items: saved });

watch(cart.items, (items) => {
  localStorage.setItem('vx-cart', JSON.stringify(items));
}, { deep: true });

export function cartCount() {
  return cart.items.reduce((sum, item) => sum + item.qty, 0);
}

export function cartTotal() {
  return cart.items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
}

export function addToCart(product, qty = 1) {
  const found = cart.items.find((item) => item.productId === product.id);
  const next = (found?.qty || 0) + qty;
  if (next > product.available) {
    showToast(`${product.name}库存不足`);
    return false;
  }
  if (next > 99) {
    showToast('单次最多 99 份');
    return false;
  }
  if (found) found.qty = next;
  else {
    cart.items.push({
      productId: product.id,
      name: product.name,
      priceCents: product.priceCents,
      qty,
    });
  }
  return true;
}

export function setQty(productId, qty) {
  const index = cart.items.findIndex((item) => item.productId === productId);
  if (index === -1) return;
  if (qty <= 0) cart.items.splice(index, 1);
  else cart.items[index].qty = qty;
}

export function clearCart() {
  cart.items.splice(0, cart.items.length);
}
