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
  remove: (id) => api(`/api/equipment/${id}`, { method: "DELETE" })
};

export const Orders = {
  list: () => api("/api/orders"),
  create: (data) => api("/api/orders", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) })
};

export const Customers = {
  list: () => api("/api/customers"),
  get: (id) => api(`/api/customers/${id}`),
  create: (data) => api("/api/customers", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => api(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id) => api(`/api/customers/${id}`, { method: "DELETE" })
};

export function overlap(a, b, c, d) {
  return new Date(a) <= new Date(d) && new Date(c) <= new Date(b);
}
