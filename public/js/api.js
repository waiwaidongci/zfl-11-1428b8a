async function api(path, options) {
  const res = await fetch(path, options && options.body ? {
    ...options,
    headers: { "Content-Type": "application/json" }
  } : options);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "请求失败");
    if (data.code) err.code = data.code;
    if (data.equipment) err.equipment = data.equipment;
    if (data.item) err.item = data.item;
    if (data.details) err.details = data.details;
    throw err;
  }
  return data;
}

export const CONFLICT_TYPE_ICONS = {
  repair: "🔧",
  rented: "📦",
  missing: "❌",
  conflict: "📅",
  quote_lock: "🔒",
  condition_missing: "⚠️"
};

export function formatConflictDetails(details) {
  if (!details) return "";
  const parts = [];

  if (details.repair && details.repair.length) {
    const items = details.repair.map((r) => `${r.id} ${r.name}`).join("、");
    parts.push(`🔧 维修中：${items}`);
  }

  if (details.conditionMissing && details.conditionMissing.length) {
    const items = details.conditionMissing.map((r) => `${r.id} ${r.name}`).join("、");
    parts.push(`⚠️ 设备缺失：${items}`);
  }

  if (details.rented && details.rented.length) {
    const items = details.rented.map((r) =>
      `${r.id} ${r.name}${r.orderCustomer ? `（客户：${r.orderCustomer}）` : r.orderId ? `（订单：${r.orderId}）` : ""}`
    ).join("、");
    parts.push(`📦 租赁中：${items}`);
  }

  if (details.conflicts && details.conflicts.length) {
    const items = details.conflicts.map((c) => {
      const extra = c.conflictOrderCustomer || c.conflictOrderId || "";
      const range = c.conflictRange || "";
      return `${c.id} ${c.name}${extra ? ` → ${extra}` : ""}${range ? `（${range}）` : ""}`;
    }).join("；");
    parts.push(`📅 租期冲突：${items}`);
  }

  if (details.quoteLocks && details.quoteLocks.length) {
    const items = details.quoteLocks.map((c) => {
      const quote = c.conflictQuoteId || "";
      const customer = c.conflictQuoteCustomer || "";
      const lockEnd = c.conflictQuoteLockEndAt
        ? `，锁定至 ${new Date(c.conflictQuoteLockEndAt).toLocaleString('zh-CN').slice(0, 16)}`
        : "";
      const range = c.conflictRange || "";
      return `${c.id} ${c.name} → 报价 ${quote} ${customer}${lockEnd}（租期 ${range}）`;
    }).join("；");
    parts.push(`🔒 报价锁定冲突：${items}`);
  }

  if (details.missing && details.missing.length) {
    const conditionMissingIds = new Set((details.conditionMissing || []).map((item) => item.id));
    const notFoundIds = details.missing.filter((id) => !conditionMissingIds.has(id));
    const ids = notFoundIds.join("、");
    if (!ids) return parts;
    parts.push(`❌ 设备不存在：${ids}`);
  }

  return parts;
}

export function renderConflictDetailsHtml(details, title = "设备不可用") {
  if (!details) return "";
  const parts = formatConflictDetails(details);
  if (!parts.length) return "";
  return `
    <div style="padding:12px 14px;background:#fff4f2;border:1px solid #f0c0b8;border-radius:8px;">
      <div style="font-weight:700;color:var(--red);margin-bottom:6px">❌ ${escapeHtml(title)}</div>
      <ul style="margin:4px 0 0;padding-left:18px;list-style:none">
        ${parts.map((p) => `<li style="margin-bottom:3px">${escapeHtml(p)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

export const Equipment = {
  list: () => api("/api/equipment"),
  create: (data) => api("/api/equipment", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/equipment/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  setCondition: (id, condition) => api(`/api/equipment/${id}/condition`, { method: "PATCH", body: JSON.stringify({ condition }) }),
  remove: (id) => api(`/api/equipment/${id}`, { method: "DELETE" }),
  listRepairs: (id) => api(`/api/equipment/${id}/repairs`),
  checkAvailability: (data) => api("/api/equipment/availability/check", { method: "POST", body: JSON.stringify(data) }),
  listAvailable: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/equipment/availability${qs}`);
  },
  getConflictTypes: () => api("/api/equipment/availability/conflict-types"),
  previewImport: (formData) => fetch("/api/equipment/import/preview", { method: "POST", body: formData }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "预览失败");
    return data;
  }),
  confirmImport: (formData) => fetch("/api/equipment/import", { method: "POST", body: formData }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "导入失败");
    return data;
  }),
  exportUrl: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return `/api/equipment/export${qs}`;
  }
};

export const Orders = {
  list: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/orders${qs}`);
  },
  get: (id) => api(`/api/orders/${id}`),
  create: (data) => api("/api/orders", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  listHandovers: (orderId) => api(`/api/orders/${orderId}/handovers`),
  createHandover: (orderId, data) => api(`/api/orders/${orderId}/handovers`, { method: "POST", body: JSON.stringify(data) }),
  getHandoverDraft: (orderId, type) => api(`/api/orders/${orderId}/handovers/draft/${type}`),
  saveHandoverDraft: (orderId, type, data) => api(`/api/orders/${orderId}/handovers/draft/${type}`, { method: "POST", body: JSON.stringify(data) }),
  deleteHandoverDraft: (orderId, type) => api(`/api/orders/${orderId}/handovers/draft/${type}`, { method: "DELETE" })
};

export const Customers = {
  list: () => api("/api/customers"),
  get: (id) => api(`/api/customers/${id}`),
  create: (data) => api("/api/customers", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id) => api(`/api/customers/${id}`, { method: "DELETE" })
};

export const Quotations = {
  list: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/quotations${qs}`);
  },
  get: (id) => api(`/api/quotations/${id}`),
  create: (data) => api("/api/quotations", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/quotations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id) => api(`/api/quotations/${id}`, { method: "DELETE" }),
  preview: (data) => api("/api/quotations/preview", { method: "POST", body: JSON.stringify(data) }),
  convert: (id) => api(`/api/quotations/${id}/convert`, { method: "POST" }),
  checkConvert: (id) => api(`/api/quotations/${id}/check`),
  listVersions: (quoteId) => api(`/api/quotations/${quoteId}/versions`),
  getVersion: (quoteId, versionId) => api(`/api/quotations/${quoteId}/versions/${versionId}`),
  createVersion: (quoteId, data) => api(`/api/quotations/${quoteId}/versions`, { method: "POST", body: JSON.stringify(data || {}) }),
  approveVersion: (quoteId, versionId, data) => api(`/api/quotations/${quoteId}/versions/${versionId}/approve`, { method: "POST", body: JSON.stringify(data || {}) }),
  rejectVersion: (quoteId, versionId, data) => api(`/api/quotations/${quoteId}/versions/${versionId}/reject`, { method: "POST", body: JSON.stringify(data || {}) }),
  restoreVersion: (quoteId, versionId) => api(`/api/quotations/${quoteId}/versions/${versionId}/restore`, { method: "POST" }),
  compareVersions: (quoteId, v1, v2) => api(`/api/quotations/${quoteId}/versions/compare?v1=${encodeURIComponent(v1)}&v2=${encodeURIComponent(v2)}`)
};

export function overlap(a, b, c, d) {
  return new Date(a) <= new Date(d) && new Date(c) <= new Date(b);
}

export const REPAIR_STATUS_LABELS = {
  pending: "待送修",
  repairing: "维修中",
  completed: "维修完成",
  cancelled: "已取消"
};

export const REPAIR_SOURCE_LABELS = {
  manual: "手动创建",
  handover: "归还交接",
  stocktake: "库存盘点"
};

export const REPAIR_LIABILITY_LABELS = {
  company: "公司承担",
  customer: "客户承担"
};

export const Repairs = {
  list: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/repairs${qs}`);
  },
  get: (id) => api(`/api/repairs/${id}`),
  create: (data) => api("/api/repairs", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/repairs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  advance: (id) => api(`/api/repairs/${id}/advance`, { method: "POST" }),
  remove: (id) => api(`/api/repairs/${id}`, { method: "DELETE" })
};

export const Schedule = {
  get: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/schedule${qs}`);
  }
};

export const Settlements = {
  list: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/settlements${qs}`);
  },
  get: (orderId) => api(`/api/orders/${orderId}/settlement`),
  update: (orderId, data) =>
    api(`/api/orders/${orderId}/settlement`, {
      method: "PATCH",
      body: JSON.stringify(data)
    }),
  addFee: (orderId, data) =>
    api(`/api/orders/${orderId}/settlement/fees`, {
      method: "POST",
      body: JSON.stringify(data)
    }),
  updateFee: (orderId, feeId, data) =>
    api(`/api/orders/${orderId}/settlement/fees/${feeId}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    }),
  deleteFee: (orderId, feeId) =>
    api(`/api/orders/${orderId}/settlement/fees/${feeId}`, {
      method: "DELETE"
    }),
  syncQuote: (orderId) =>
    api(`/api/orders/${orderId}/settlement/sync-quote`, {
      method: "POST"
    }),
  syncHandover: (orderId) =>
    api(`/api/orders/${orderId}/settlement/sync-handover`, {
      method: "POST"
    }),
  syncRepair: (orderId) =>
    api(`/api/orders/${orderId}/settlement/sync-repair`, {
      method: "POST"
    }),
  addPayment: (orderId, data) =>
    api(`/api/orders/${orderId}/settlement/payments`, {
      method: "POST",
      body: JSON.stringify(data)
    }),
  updatePayment: (orderId, paymentId, data) =>
    api(`/api/orders/${orderId}/settlement/payments/${paymentId}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    }),
  deletePayment: (orderId, paymentId) =>
    api(`/api/orders/${orderId}/settlement/payments/${paymentId}`, {
      method: "DELETE"
    }),
  listPlans: (orderId) => api(`/api/orders/${orderId}/settlement/plans`),
  addPlan: (orderId, data) =>
    api(`/api/orders/${orderId}/settlement/plans`, {
      method: "POST",
      body: JSON.stringify(data)
    }),
  updatePlan: (orderId, planId, data) =>
    api(`/api/orders/${orderId}/settlement/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    }),
  deletePlan: (orderId, planId) =>
    api(`/api/orders/${orderId}/settlement/plans/${planId}`, {
      method: "DELETE"
    })
};

export const SETTLEMENT_STATUS_LABELS = {
  draft: "待结算",
  partial: "部分结算",
  settled: "已结算",
  cancelled: "已取消"
};

export const FEE_TYPE_LABELS = {
  rental: "租金",
  deposit: "押金",
  transport: "运输费",
  labor: "人工费",
  setup: "搭建费",
  compensation: "维修赔偿",
  discount: "优惠减免"
};

export const PAYMENT_METHOD_LABELS = {
  cash: "现金",
  bank: "银行转账",
  wechat: "微信支付",
  alipay: "支付宝",
  other: "其他"
};

export const PAYMENT_TYPE_LABELS = {
  payment: "收款",
  deposit_deduction: "押金抵扣",
  deposit_return: "押金退还"
};

export const PAYMENT_PLAN_NODE_TYPE_LABELS = {
  deposit: "定金",
  balance: "尾款",
  deposit_return: "押金退还",
  custom: "自定义"
};

export const PAYMENT_PLAN_NODE_STATUS_LABELS = {
  pending: "待收款",
  partial: "部分完成",
  completed: "已完成",
  overdue: "已逾期"
};

export const PAYMENT_PLAN_OVERALL_STATUS_LABELS = {
  pending: "计划待执行",
  partial: "部分计划完成",
  completed: "计划全部完成",
  overdue: "有计划逾期"
};

export const STOCKTAKE_STATUS_LABELS = {
  draft: "草稿",
  processing: "盘点中",
  completed: "已完成",
  cancelled: "已取消"
};

export const STOCKTAKE_RESULT_LABELS = {
  normal: "正常",
  missing: "丢失",
  damaged: "损坏",
  mismatch: "位置不符"
};

export const Stocktakes = {
  list: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/stocktakes${qs}`);
  },
  get: (id) => api(`/api/stocktakes/${id}`),
  create: (data) => api("/api/stocktakes", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/stocktakes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  scan: (id, data) => api(`/api/stocktakes/${id}/scan`, { method: "POST", body: JSON.stringify(data) }),
  markProcessed: (id, equipmentId) => api(`/api/stocktakes/${id}/mark-processed/${equipmentId}`, { method: "POST" }),
  submit: (id) => api(`/api/stocktakes/${id}/submit`, { method: "POST" }),
  cancel: (id) => api(`/api/stocktakes/${id}/cancel`, { method: "POST" }),
  remove: (id) => api(`/api/stocktakes/${id}`, { method: "DELETE" }),
  processDamaged: (id, equipmentId, data) =>
    api(`/api/stocktakes/${id}/damaged/${equipmentId}`, {
      method: "POST",
      body: JSON.stringify(data || {})
    }),
  processMissing: (id, equipmentId) =>
    api(`/api/stocktakes/${id}/missing/${equipmentId}`, { method: "POST" }),
  processMismatch: (id, equipmentId) =>
    api(`/api/stocktakes/${id}/mismatch/${equipmentId}`, { method: "POST" })
};

export const BLOCK_TYPE_LABELS = {
  pending_out: "待出库",
  occupied: "占用中",
  pending_return: "待归还",
  repairing: "维修中",
  quote_locked: "报价锁定",
  quote_lock_expired: "锁定已过期",
  quotation: "报价草稿"
};

export const Packages = {
  list: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/packages${qs}`);
  },
  get: (id) => api(`/api/packages/${id}`),
  create: (data) => api("/api/packages", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/packages/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id) => api(`/api/packages/${id}`, { method: "DELETE" }),
  checkAvailability: (id, params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return api(`/api/packages/${id}/availability${qs}`);
  },
  previewQuote: (data) => api("/api/packages/preview-quote", { method: "POST", body: JSON.stringify(data) })
};
