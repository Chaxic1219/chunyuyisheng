import { ORDER_PAID_SUBSCRIBE_TMPL_ID } from "../api/config";

/** 须在用户点击触发的 async 函数里、第一个 await 之前调用 */
export function requestOrderPaidSubscribe(): Promise<void> {
  // #ifdef MP-WEIXIN
  if (!ORDER_PAID_SUBSCRIBE_TMPL_ID) return Promise.resolve();
  return uni
    .requestSubscribeMessage({ tmplIds: [ORDER_PAID_SUBSCRIBE_TMPL_ID] })
    .then(() => {})
    .catch(() => {});
  // #endif
  // #ifndef MP-WEIXIN
  return Promise.resolve();
  // #endif
}
