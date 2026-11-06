export function inWechat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

export function invokeWechatPay(payment) {
  return new Promise((resolve, reject) => {
    const run = () => {
      window.WeixinJSBridge.invoke('getBrandWCPayRequest', {
        appId: payment.appId,
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType,
        paySign: payment.paySign,
      }, (res) => {
        const message = res?.err_msg || res?.errMsg || '';
        if (message.endsWith(':ok')) resolve(res);
        else if (message.endsWith(':cancel')) reject(new Error('cancel'));
        else reject(new Error('支付未完成'));
      });
    };

    if (typeof window.WeixinJSBridge === 'undefined') {
      const timer = setTimeout(() => reject(new Error('请在微信中打开此链接后再支付')), 2500);
      document.addEventListener('WeixinJSBridgeReady', () => {
        clearTimeout(timer);
        run();
      }, { once: true });
      return;
    }
    run();
  });
}
