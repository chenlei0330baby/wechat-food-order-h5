import { reactive } from 'vue';

export const toast = reactive({ text: '' });
let timer = 0;

export function showToast(text) {
  toast.text = text;
  clearTimeout(timer);
  timer = setTimeout(() => {
    toast.text = '';
  }, 2600);
}
