async function api(path, options) {
  const res = await fetch(path, options && options.body ? {
    ...options,
    headers: { "Content-Type": "application/json" }
  } : options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
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
  listRepairs: (id) => api(`/api/equipment/${id}/repairs`)
};

export const Orders = {
  list: () => api("/api/orders"),
  get: (id) => api(`/api/orders/${id}`),
  create: (data) => api("/api/orders", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  listHandovers: (orderId) => api(`/api/orders/${orderId}/handovers`),
  createHandover: (orderId, data) => api(`/api/orders/${orderId}/handovers`, { method: "POST", body: JSON.stringify(data) })
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

export const BLOCK_TYPE_LABELS = {
  pending_out: "待出库",
  occupied: "占用中",
  pending_return: "待归还",
  repairing: "维修中",
  quote_locked: "报价锁定"
};
