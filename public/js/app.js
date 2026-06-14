import { Equipment, Orders, Customers, showToast, overlap } from "./api.js";

const orderForm = document.querySelector("#orderForm");
const itemsEl = document.querySelector("#items");
const ordersEl = document.querySelector("#orders");
const statsEl = document.querySelector("#stats");
const selectionEl = document.querySelector("#selection");
const statusFilter = document.querySelector("#statusFilter");
const categoryFilter = document.querySelector("#categoryFilter");
const itemCategoryFilter = document.querySelector("#itemCategoryFilter");
const customerSelect = document.querySelector("#customerSelect");
const customerNameInput = document.querySelector("#customerNameInput");
const customerInfo = document.querySelector("#customerInfo");
const infoContact = document.querySelector("#infoContact");
const infoPhone = document.querySelector("#infoPhone");
const infoActivity = document.querySelector("#infoActivity");
const newCustomerBtn = document.querySelector("#newCustomerBtn");

const selected = new Set();
let equipment = [];
let orders = [];
let customers = [];

function occupied(id, start, end) {
  if (!start || !end) return false;
  return orders.some(
    (o) =>
      !["已取消", "已归还"].includes(o.status) &&
      o.itemIds.includes(id) &&
      overlap(start, end, o.startDate, o.endDate)
  );
}

function renderItems() {
  const start = orderForm.startDate.value;
  const end = orderForm.endDate.value;
  const category = itemCategoryFilter.value;
  const visible = category ? equipment.filter((e) => e.category === category) : equipment;

  if (!visible.length) {
    itemsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);grid-column:1/-1">暂无可用设备，请到 <a href="/equipment" style="color:var(--green)">设备管理</a> 入库</div>`;
  } else {
    itemsEl.innerHTML = visible
      .map((item) => {
        const isRepair = item.condition === "repair";
        const isOccupied = occupied(item.id, start, end);
        const unavailable = isRepair || isOccupied;
        const cls =
          "item " + (selected.has(item.id) ? "selected " : "") + (unavailable ? "disabled" : "");
        let statusText = item.location;
        if (isRepair) statusText = "维修中";
        else if (isOccupied) statusText = "该租期已占用";

        return `<div class="${cls}" data-id="${item.id}" title="${unavailable ? "不可选择" : "点击选择"}">
          <b>${escapeHtml(item.name)}</b>
          <div class="meta">${escapeHtml(item.id)} · ${escapeHtml(item.category)} · ${escapeHtml(item.spec || "—")}</div>
          <div class="${isRepair ? "repair" : "meta"}">
            ${
              item.condition === "repair"
                ? '<span class="badge repair">维修中</span> '
                : isOccupied
                ? '<span class="badge" style="background:#f7eadd;color:#8a5a2e">占用</span> '
                : '<span class="badge available">在库</span> '
            }
            ${escapeHtml(statusText)}
          </div>
        </div>`;
      })
      .join("");
  }

  document.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => {
      if (el.classList.contains("disabled")) return;
      selected.has(el.dataset.id) ? selected.delete(el.dataset.id) : selected.add(el.dataset.id);
      renderSelection();
      renderItems();
    };
  });

  renderSelection();
}

function renderSelection() {
  selectionEl.textContent = selected.size
    ? `已选择 ${selected.size} 台：${[...selected].join("、")}`
    : "还没有选择设备（点击卡片勾选）";
}

function renderOrders() {
  const status = statusFilter.value;
  const cat = categoryFilter.value;
  let visible = status ? orders.filter((o) => o.status === status) : [...orders];

  if (cat) {
    visible = visible.filter((o) =>
      o.itemIds.some((id) => {
        const eq = equipment.find((e) => e.id === id);
        return eq && eq.category === cat;
      })
    );
  }

  if (!visible.length) {
    ordersEl.innerHTML = `<div style="padding:30px;text-align:center;color:var(--muted);grid-column:1/-1">暂无匹配订单</div>`;
    return;
  }

  const eqMap = new Map(equipment.map((e) => [e.id, e]));

  ordersEl.innerHTML = visible
    .map((o) => {
      const tags = o.itemIds
        .map((id) => {
          const e = eqMap.get(id);
          return `<span class="item-tag">${escapeHtml(e ? `${e.id} ${e.name}` : id)}</span>`;
        })
        .join("");
      return `<article class="order" data-order-id="${escapeHtml(o.id)}" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <h3>${escapeHtml(o.customer)}</h3>
          <span class="order-id">${escapeHtml(o.id)}</span>
        </div>
        <div class="meta">${escapeHtml(o.startDate)} 至 ${escapeHtml(o.endDate)}${o.note ? ` · ${escapeHtml(o.note)}` : ""}</div>
        <div class="items-list">${tags}</div>
        <div class="status-row">
          <span class="badge">${escapeHtml(o.status)}</span>
          <select data-id="${o.id}" class="mini">
            <option>待出库</option><option>已出库</option><option>待归还</option><option>已归还</option><option>已取消</option>
          </select>
        </div>
        <div style="display:flex;gap:8px">
          <button class="print-btn ghost small" data-order-id="${escapeHtml(o.id)}" style="flex:1">🖨 打印出库单</button>
          <button class="view-detail-btn ghost small" data-order-id="${escapeHtml(o.id)}" style="flex:1">📋 查看详情</button>
        </div>
      </article>`;
    })
    .join("");

  document.querySelectorAll(".order select").forEach((select) => {
    const order = orders.find((o) => o.id === select.dataset.id);
    if (order) select.value = order.status;
    select.onclick = (e) => e.stopPropagation();
    select.onchange = async (e) => {
      e.stopPropagation();
      try {
        await Orders.update(select.dataset.id, { status: select.value });
        showToast(`订单状态已更新为「${select.value}」`);
        await load();
      } catch (err) {
        showToast(err.message, "error");
        await load();
      }
    };
  });

  document.querySelectorAll(".print-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      window.open(`/print?id=${encodeURIComponent(btn.dataset.orderId)}`, "_blank");
    };
  });

  document.querySelectorAll(".view-detail-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openOrderDetail(btn.dataset.orderId);
    };
  });

  document.querySelectorAll(".order").forEach((order) => {
    order.onclick = () => {
      openOrderDetail(order.dataset.orderId);
    };
  });
}

let currentDetailOrderId = null;

async function openOrderDetail(id) {
  currentDetailOrderId = id;
  const modal = document.getElementById("orderDetailModal");
  const body = document.getElementById("orderDetailBody");

  modal.classList.remove("hidden");
  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中…</div>';

  try {
    const order = await Orders.get(id);
    renderOrderDetail(order);
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function closeOrderDetail() {
  document.getElementById("orderDetailModal").classList.add("hidden");
  currentDetailOrderId = null;
}

function renderOrderDetail(o) {
  const body = document.getElementById("orderDetailBody");

  const itemsHtml = o.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.spec || "—")}</td>
    </tr>
  `).join("");

  body.innerHTML = `
    <div class="detail-section">
      <div class="detail-id" style="text-align:right;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;margin-bottom:12px">${escapeHtml(o.id)}</div>
      <h3 style="margin:0 0 16px 0;font-size:18px">${escapeHtml(o.customer)}</h3>
      <span class="badge" style="margin-bottom:16px;display:inline-block">${escapeHtml(o.status)}</span>
    </div>

    <table class="info-table" style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
      <tr>
        <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:80px">联系人</th>
        <td style="border:1px solid var(--line);padding:6px 10px">${escapeHtml(o.customerContact || "—")}</td>
        <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:80px">电话</th>
        <td style="border:1px solid var(--line);padding:6px 10px">${escapeHtml(o.customerPhone || "—")}</td>
      </tr>
      <tr>
        <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">租期开始</th>
        <td style="border:1px solid var(--line);padding:6px 10px">${escapeHtml(o.startDate)}</td>
        <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">租期结束</th>
        <td style="border:1px solid var(--line);padding:6px 10px">${escapeHtml(o.endDate)}</td>
      </tr>
      <tr>
        <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">备注</th>
        <td colspan="3" style="border:1px solid var(--line);padding:6px 10px">${escapeHtml(o.note || "—")}</td>
      </tr>
    </table>

    <h4 style="margin:16px 0 8px 0;font-size:14px">租赁设备清单</h4>
    <table class="equip-table" style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr>
          <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:40px">序号</th>
          <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">设备编号</th>
          <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">设备名称</th>
          <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">规格</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>
  `;

  const printBtn = document.getElementById("detailPrintBtn");
  printBtn.onclick = () => {
    window.open(`/print?id=${encodeURIComponent(currentDetailOrderId)}`, "_blank");
  };
}

window.closeOrderDetail = closeOrderDetail;

function renderStats() {
  const counts = {
    待出库: orders.filter((o) => o.status === "待出库").length,
    待归还: orders.filter((o) => ["已出库", "待归还"].includes(o.status)).length,
    需维修: equipment.filter((e) => e.condition === "repair").length,
    设备总数: equipment.length
  };
  statsEl.innerHTML = Object.entries(counts)
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");
}

function renderCategoryFilters() {
  const categories = [...new Set(equipment.map((e) => e.category))];
  const opts = '<option value="">全部类别</option>' + categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  categoryFilter.innerHTML = '<option value="">全部设备</option>' + categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  itemCategoryFilter.innerHTML = opts;
}

function renderCustomerOptions() {
  customerSelect.innerHTML =
    '<option value="">— 选择已有客户 —</option>' +
    customers
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
      .join("");
}

function handleCustomerChange() {
  const custId = customerSelect.value;
  if (!custId) {
    customerInfo.classList.add("hidden");
    return;
  }
  const cust = customers.find((c) => c.id === custId);
  if (cust) {
    customerNameInput.value = cust.name;
    infoContact.textContent = cust.contact || "—";
    infoPhone.textContent = cust.phone || "—";
    infoActivity.textContent = cust.activityType || "—";
    customerInfo.classList.remove("hidden");
    if (cust.activityType && !orderForm.note.value) {
      orderForm.note.value = cust.activityType;
    }
  }
}

function startNewCustomer() {
  customerSelect.value = "";
  customerNameInput.value = "";
  customerNameInput.focus();
  customerInfo.classList.add("hidden");
}

function render() {
  renderStats();
  renderItems();
  renderOrders();
}

async function load() {
  try {
    [equipment, orders, customers] = await Promise.all([
      Equipment.list(),
      Orders.list(),
      Customers.list()
    ]);
    renderCategoryFilters();
    renderCustomerOptions();
    render();

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("id");
    if (orderId) {
      setTimeout(() => openOrderDetail(orderId), 100);
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

orderForm.addEventListener("input", renderItems);
statusFilter.addEventListener("change", renderOrders);
categoryFilter.addEventListener("change", renderOrders);
itemCategoryFilter.addEventListener("change", renderItems);
customerSelect.addEventListener("change", handleCustomerChange);
newCustomerBtn.addEventListener("click", startNewCustomer);
document.querySelector("#reload").onclick = load;

orderForm.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(orderForm).entries());
  data.itemIds = [...selected];
  try {
    const created = await Orders.create(data);
    showToast(`订单 ${created.id} 创建成功`);
    selected.clear();
    orderForm.reset();
    customerSelect.value = "";
    customerInfo.classList.add("hidden");
    itemCategoryFilter.value = "";
    await load();
  } catch (error) {
    showToast(error.message, "error");
  }
};

load();
