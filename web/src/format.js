export function yuan(cents) {
  const value = Number(cents) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function yuanToCents(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('价格格式不正确');
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function formatTime(ms) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export function statusLabel(status) {
  return {
    pending: '待支付',
    paid: '待发货',
    shipped: '已发货',
    closed: '已关闭',
  }[status] || status;
}
