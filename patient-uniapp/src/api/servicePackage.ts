import { getMpToken } from "./auth";
import { API_BASE } from "./config";

export type ComponentSummary = {
  type: "BENEFIT_SKU" | "OPS_SERVICE_TEMPLATE" | "GOODS_SKU";
  sourceId: number;
  sourceVersionId?: number | null;
  name: string;
  quantity: number;
  providerName?: string;
};

export type SaleSku = {
  skuId: number;
  spuId: number;
  code: string;
  name: string;
  cycleDays: number;
  salePriceCents: number;
  listPriceCents: number;
  minimumPriceCents?: number;
  componentSummary: ComponentSummary[];
  components?: ComponentSummary[];
};

export type ServiceProduct = {
  id: string;
  key: string;
  spuId?: number;
  productId?: number;
  versionId?: number;
  doctorId: number | null;
  doctorName?: string;
  doctorHospital?: string;
  title: string;
  subtitle?: string;
  desc?: string;
  serviceDays?: number;
  eligible?: string[];
  ineligible?: string[];
  contents?: string[];
  assessments?: string[];
  goods?: string[];
  consultationNote?: string;
  refundPolicy?: string;
  serviceAmount?: number;
  goodsAmount?: number;
  shippingAmount?: number;
  totalAmount?: number;
  icon?: string;
  category?: string;
  cover?: string;
  tone?: "green" | "amber";
  action?: string;
  reviewBeforeActivate?: boolean;
  skus?: SaleSku[];
};

export type OrderLine = {
  id: number | null;
  orderId?: number;
  productId?: number | null;
  versionId?: number;
  spuId?: number | null;
  skuId?: number | null;
  qty: number;
  title: string;
  snapshot?: Record<string, unknown>;
  componentSnapshot?: ComponentSummary[];
  serviceAmount?: number;
  goodsAmount?: number;
  shippingAmount?: number;
  totalAmount?: number;
  serviceAmountCents?: number;
  goodsAmountCents?: number;
  shippingAmountCents?: number;
  totalAmountCents?: number;
  instanceId?: number | null;
  createdAt?: string;
};


export type ServiceOrder = {
  id: number;
  orderNo: string;
  status: string;
  doctorId?: number;
  totalAmount: number;
  totalAmountCents: number;
  couponId?: number | null;
  discountAmountCents?: number;
  payableAmountCents?: number;
  snapshot?: Record<string, unknown>;
  lines?: OrderLine[];
  paidAt?: string | null;
  profileSubmittedAt?: string | null;
  serviceStartDate?: string | null;
  instanceId?: number | null;
  createdAt?: string;
  reviewNote?: string | null;
};

export type CouponTemplate = {
  id: number;
  doctorId: number;
  title: string;
  type: string;
  thresholdCents: number;
  discountCents: number;
  percentOff: number;
  maxDiscountCents: number;
  category?: string | null;
  status: string;
  totalQuota: number;
  claimedCount: number;
  perUserLimit: number;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Coupon = {
  id: number;
  templateId: number;
  personId: number;
  doctorId: number;
  status: string;
  discountSnapshotCents?: number | null;
  orderId?: number | null;
  claimedAt?: string;
  lockedAt?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  template?: CouponTemplate | null;
};

export type CouponQuote = {
  discountCents: number;
  payableCents: number;
  coupon: Coupon | null;
  usable: boolean;
};

export type CartItem = {
  id: number;
  skuId: number;
  spuId: number;
  versionId?: number;
  productId?: number | null;
  title: string;
  specName: string;
  cover?: string;
  components?: ComponentSummary[];
  qty: number;
  unitTotalCents: number;
  lineTotalCents: number;
  unavailable?: boolean;
};

export type Cart = {
  doctorId: number;
  items: CartItem[];
  totalAmountCents: number;
};

export type CreateServiceOrderBody = {
  items: { skuId: number | string; qty?: number }[];
  serviceFor?: string;
  contactPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  agreementAccepted?: boolean;
  privacyAccepted?: boolean;
  idempotencyKey?: string;
  sourceDoctorId?: number | string;
  sourceGroupId?: number | string;
  sourceChannel?: string;
  couponId?: number | string;
};

export type OrderListQuery = {
  status?: string;
  limit?: number;
  offset?: number;
};

export type ServiceInstance = {
  id: number;
  orderId: number;
  title: string;
  status: string;
  serviceStartDate: string;
  serviceEndDate: string;
  planId?: number | null;
  summary?: { nextTask?: string };
};
export type PackageInstance = {
  id: number;
  status: string;
  components: Array<{
    id: number;
    type: "BENEFIT_SKU" | "OPS_SERVICE_TEMPLATE" | "GOODS_SKU";
    status: string;
    tasks?: Array<{ id: number; title: string; scheduledAt?: string | null; status: string }>;
    fulfillment?: { status: string; carrier?: string | null; trackingNo?: string | null } | null;
  }>;
};

/** 微信小程序无 URLSearchParams，手动拼查询串 */
function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value == null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

async function requestMp<T>(
  path: string,
  opts?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    data?: Record<string, unknown>;
    auth?: boolean;
  }
): Promise<T> {
  const method = opts?.method || "GET";
  const header: Record<string, string> = {};
  if (opts?.auth !== false) {
    const token = getMpToken();
    if (token) header.Authorization = `Bearer ${token}`;
  }
  if (method === "POST" || method === "PATCH") header["Content-Type"] = "application/json";

  const res = await uni.request({
    url: `${API_BASE}/api/mp${path}`,
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    header,
    data: opts?.data,
    timeout: 15000,
  });
  const data = (res.data || {}) as { data?: T; error?: string };
  if ((res.statusCode || 0) >= 400 || data.error) {
    throw new Error(data.error || `request failed: ${res.statusCode}`);
  }
  return (data.data != null ? data.data : (data as unknown as T)) as T;
}

export function getServiceProduct(id: string) {
  return requestMp<ServiceProduct>(`/service-products/${encodeURIComponent(id)}`, { auth: false });
}

/** 某医生已上架服务包列表（可匿名浏览） */
export function listServiceProducts(
  params?: string | number | { doctorId?: string | number; category?: string; page?: number; pageSize?: number }
) {
  let doctorId: string | number | undefined;
  let page: number | undefined;
  let pageSize: number | undefined;
  if (typeof params === "object" && params != null) {
    doctorId = params.doctorId;
    page = params.page;
    pageSize = params.pageSize;
  } else if (params != null && params !== "") {
    doctorId = params;
  }
  return requestMp<{ products: ServiceProduct[]; page: number; pageSize: number; total: number }>(
    `/service-products${buildQuery({ doctorId, page, pageSize })}`,
    { auth: false }
  );
}

export function getCart(doctorId: number | string) {
  return requestMp<Cart>(`/cart?doctorId=${encodeURIComponent(String(doctorId))}`);
}

export function addCartItem(body: { skuId: number | string; doctorId: number | string; qty?: number }) {
  return requestMp<Cart>("/cart/items", { method: "POST", data: body });
}

export function updateCartItem(id: number, qty: number) {
  return requestMp<Cart>(`/cart/items/${id}`, { method: "PATCH", data: { qty } });
}

export function removeCartItem(id: number) {
  return requestMp<Cart>(`/cart/items/${id}`, { method: "DELETE" });
}

export function clearCart(doctorId: number | string) {
  return requestMp<Cart>(`/cart?doctorId=${encodeURIComponent(String(doctorId))}`, { method: "DELETE" });
}

export function createServiceOrder(body: CreateServiceOrderBody) {
  return requestMp<{ order: ServiceOrder }>("/orders", { method: "POST", data: body });
}

export function listMyOrders(params?: OrderListQuery) {
  return requestMp<{ orders: ServiceOrder[] }>(
    `/orders${buildQuery({
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset,
    })}`,
    { auth: true }
  );
}

export function getServiceOrder(orderId: number) {
  return requestMp<{ order: ServiceOrder; profile?: Record<string, unknown> }>(`/orders/${orderId}`);
}

export function cancelServiceOrder(orderId: number, reason?: string) {
  return requestMp<{ order: ServiceOrder }>(`/orders/${orderId}/cancel-request`, {
    method: "POST",
    data: { reason: reason || "用户取消" },
    auth: true,
  });
}

/** 微信小程序 JSAPI 调起参数（uni.requestPayment / wx.requestPayment） */
export type WechatPrepay = {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
  appId?: string;
};

export function payServiceOrder(orderId: number) {
  return requestMp<{
    payment: {
      provider: string;
      status: string;
      prepay?: WechatPrepay | Record<string, unknown>;
    };
    order: ServiceOrder;
    provider: string;
  }>(`/orders/${orderId}/pay`, { method: "POST", data: {} });
}

export function getPaymentStatus(orderId: number) {
  return requestMp<{
    orderStatus: string;
    payment: { status: string; provider: string } | null;
    paid: boolean;
  }>(`/orders/${orderId}/payment-status`);
}

export function submitPostoperativeProfile(orderId: number, body: Record<string, unknown>) {
  return requestMp<{ order: ServiceOrder }>(`/orders/${orderId}/postoperative-profile`, {
    method: "POST",
    data: body,
  });
}

export function listMyServices() {
  return requestMp<{ instances: ServiceInstance[]; orders: ServiceOrder[] }>("/service-instances");
}

export function getServiceInstance(id: number) {
  return requestMp<{ instance: ServiceInstance; order: ServiceOrder | null; packageInstance?: PackageInstance | null }>(
    `/service-instances/${id}`
  );
}

export function listClaimableTemplates(doctorId: number | string) {
  return requestMp<{ templates: CouponTemplate[] }>(
    `/coupons/templates?doctorId=${encodeURIComponent(String(doctorId))}`
  );
}

export function claimCoupon(templateId: number | string) {
  return requestMp<{ coupon: Coupon }>("/coupons/claim", {
    method: "POST",
    data: { templateId },
  });
}

export function redeemCouponCode(code: string) {
  return requestMp<{ coupon: Coupon }>("/coupons/redeem", {
    method: "POST",
    data: { code },
  });
}

export function listMyCoupons(params?: { status?: string }) {
  return requestMp<{ coupons: Coupon[] }>(
    `/coupons/mine${buildQuery({ status: params?.status })}`
  );
}

export function quoteCoupon(params: {
  doctorId: number | string;
  subtotalCents: number | string;
  couponId?: number | string | null;
}) {
  return requestMp<CouponQuote>(
    `/coupons/quote${buildQuery({
      doctorId: params.doctorId,
      subtotalCents: params.subtotalCents,
      couponId: params.couponId,
    })}`
  );
}

export type AfterSaleTicket = {
  id: number;
  orderId: number;
  personId: number;
  doctorId: number;
  type: string;
  status: string;
  reason: string;
  adminNote: string;
  refundAmountCents: number | null;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  /** 关联订单商品摘要（后端 enrich） */
  productTitle?: string;
  productCover?: string;
  orderNo?: string;
  qty?: number;
  amountCents?: number | null;
};

export type ServiceAssets = {
  instances: ServiceInstance[];
  openTickets: AfterSaleTicket[];
  couponAvailableCount: number;
};

export function createAfterSale(
  orderId: number,
  body: { reason: string; type?: string }
) {
  return requestMp<{ ticket: AfterSaleTicket }>(`/orders/${orderId}/after-sales`, {
    method: "POST",
    data: body,
  });
}

export function listAfterSales(params?: { status?: string; limit?: number }) {
  return requestMp<{ tickets: AfterSaleTicket[] }>(
    `/after-sales${buildQuery({ status: params?.status, limit: params?.limit })}`
  );
}

export function getAfterSale(id: number) {
  return requestMp<{ ticket: AfterSaleTicket }>(`/after-sales/${id}`);
}

export function updateAfterSale(id: number, body: { reason: string }) {
  return requestMp<{ ticket: AfterSaleTicket }>(`/after-sales/${id}`, {
    method: "PATCH",
    data: body,
  });
}

export function cancelAfterSale(id: number) {
  return requestMp<{ ticket: AfterSaleTicket }>(`/after-sales/${id}/cancel`, {
    method: "POST",
    data: {},
  });
}

export function getServiceAssets() {
  return requestMp<ServiceAssets>("/service-assets");
}

// ── 权益 (entitlement) ──

export type EntitlementUsage = {
  id: number;
  entitlementId: number;
  status: string;
  requestedQty: number;
  consumedQty: number;
  requestedAt: string;
  completedAt?: string | null;
};

export type ServiceEntitlement = {
  id: number;
  instanceId: number;
  componentCode: string;
  name: string;
  type: string;
  unit: string;
  totalQuota: number | null;
  usedQuota: number;
  reservedQuota: number;
  remainingQuota: number | null;
  validFrom: string;
  validTo: string;
  status: string;
  actionKey?: string;
  actionLabel?: string;
  latestUsage?: EntitlementUsage | null;
};

export function listInstanceEntitlements(instanceId: number) {
  return requestMp<{ entitlements: ServiceEntitlement[] }>(
    `/service-instances/${instanceId}/entitlements`
  );
}

export function getEntitlement(id: number) {
  return requestMp<{ entitlement: ServiceEntitlement }>(`/entitlements/${id}`);
}

export function requestEntitlementUsage(
  id: number,
  body: { qty: number; idempotencyKey: string; bizType?: string; note?: string }
) {
  return requestMp<{ usage: EntitlementUsage }>(`/entitlements/${id}/usages`, {
    method: "POST",
    data: body,
  });
}

export function cancelEntitlementUsage(id: number) {
  return requestMp<{ usage: EntitlementUsage }>(`/entitlement-usages/${id}/cancel`, {
    method: "POST",
    data: {},
  });
}

/** 服务包权益领取（PRD §8.14）：POST /api/mp/orders/:id/benefit-claim */
export function claimServiceOrderBenefit(orderId: number) {
  return requestMp<{
    ok: boolean;
    status: string;
    claim?: {
      claimNo?: string;
      benefitCode?: string;
      redemptionUrl?: string;
      benefitSubscriptionNo?: string | null;
      status?: string;
      bindingExpiresAt?: string | null;
    };
    idempotent?: boolean;
  }>(`/orders/${Number(orderId)}/benefit-claim`, {
    method: "POST",
    data: {},
  });
}

/** 服务包权益领取状态：GET /api/mp/orders/:id/benefit-claim */
export function getServiceOrderBenefitClaimStatus(orderId: number) {
  return requestMp<{
    status: string;
    eventType?: string;
    claim?: {
      claimNo?: string;
      benefitCode?: string;
      redemptionUrl?: string;
      benefitSubscriptionNo?: string | null;
      status?: string;
      bindingExpiresAt?: string | null;
    };
    error?: string | null;
    attempts?: number;
    createdAt?: string;
    updatedAt?: string;
  }>(`/orders/${Number(orderId)}/benefit-claim`, { auth: true });
}
