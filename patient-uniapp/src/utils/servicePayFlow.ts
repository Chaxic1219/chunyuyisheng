import {
  getPaymentStatus,
  payServiceOrder,
  type WechatPrepay,
} from "../api/servicePackage";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isUserCancel(err: unknown): boolean {
  const e = err as { errMsg?: string; message?: string } | null;
  const msg = `${e?.errMsg || ""} ${e?.message || ""}`;
  return /cancel/i.test(msg);
}

function readPrepay(raw: WechatPrepay | Record<string, unknown> | undefined | null): WechatPrepay {
  if (!raw || typeof raw !== "object") {
    throw new Error("缺少微信支付参数");
  }
  const timeStamp = String((raw as WechatPrepay).timeStamp ?? "");
  const nonceStr = String((raw as WechatPrepay).nonceStr ?? "");
  const pkg = String((raw as WechatPrepay).package ?? "");
  const signType = String((raw as WechatPrepay).signType ?? "RSA");
  const paySign = String((raw as WechatPrepay).paySign ?? "");
  if (!timeStamp || !nonceStr || !pkg || !paySign) {
    throw new Error("微信支付参数不完整");
  }
  return { timeStamp, nonceStr, package: pkg, signType, paySign };
}

async function pollUntilPaid(orderId: number, initialOrderStatus?: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const st = await getPaymentStatus(orderId);
    if (st.paid) return true;
    if (
      st.orderStatus &&
      st.orderStatus !== "pending_payment" &&
      (!initialOrderStatus || st.orderStatus !== initialOrderStatus)
    ) {
      return !!st.paid;
    }
  }
  const final = await getPaymentStatus(orderId);
  return !!final.paid;
}

/**
 * 服务订单支付：mock 自动完成；wechat 调起 requestPayment 后轮询入账状态。
 * 不以 requestPayment success 为最终成功依据。
 */
export async function runServiceOrderPay(
  orderId: number
): Promise<{ paid: boolean; provider: string }> {
  const pay = await payServiceOrder(orderId);
  const provider = String(pay.provider || pay.payment?.provider || "");

  if (provider === "mock") {
    throw new Error("当前环境未配置真实微信支付");
  }

  if (provider === "wechat") {
    const prepay = readPrepay(pay.payment?.prepay);
    try {
      await uni.requestPayment({
        provider: "wxpay",
        timeStamp: prepay.timeStamp,
        nonceStr: prepay.nonceStr,
        package: prepay.package,
        signType: prepay.signType,
        paySign: prepay.paySign,
      });
    } catch (err) {
      if (isUserCancel(err)) {
        throw new Error("已取消支付");
      }
      const e = err as { errMsg?: string; message?: string } | null;
      throw new Error(e?.errMsg || e?.message || "支付失败");
    }

    const paid = await pollUntilPaid(orderId, pay.order?.status);
    return { paid, provider };
  }

  return { paid: pay.payment?.status === "paid", provider };
}
