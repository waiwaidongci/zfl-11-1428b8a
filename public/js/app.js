import { Equipment, Orders, showToast, overlap } from "./api.js";

const orderForm = document.querySelector("#orderForm");
const itemsEl = document.querySelector("#items");
const ordersEl = document.querySelector("#orders");
const statsEl = document.querySelector("#stats");
const selectionEl = document.querySelector("#selection");
const statusFilter = document.querySelector("#statusFilter");
const categoryFilter = document.querySelector("#categoryFilter");
const itemCategoryFilter = document.querySelector("#itemCategoryFilter");

const selected = new Set();
let equipment = [];
let orders = [];

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
      return `<article class="order">
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
      </article>`;
    })
    .join("");

  document.querySelectorAll(".order select").forEach((select) => {
    const order = orders.find((o) => o.id === select.dataset.id);
    if (order) select.value = order.status;
    select.onchange = async () => {
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
}

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

function render() {
  renderStats();
  renderItems();
  renderOrders();
}

async function load() {
  try {
    [equipment, orders] = await Promise.all([Equipment.list(), Orders.list()]);
    renderCategoryFilters();
    render();
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
    itemCategoryFilter.value = "";
    await load();
  } catch (error) {
    showToast(error.message, "error");
  }
};

load();
