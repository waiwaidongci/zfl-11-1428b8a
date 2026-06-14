import { Equipment, Orders, Customers, Settlements, showToast, overlap } from "./api.js";

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
let customerFilterFromUrl = "";

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
        const isMissing = item.condition === "missing";
        const isRented = item.condition === "rented";
        const isOccupied = occupied(item.id, start, end);
        const unavailable = isRepair || isMissing || isRented || isOccupied;
        const cls =
          "item " + (selected.has(item.id) ? "selected " : "") + (unavailable ? "disabled" : "");
        let statusText = item.location;
        let badgeClass = "available";
        let badgeText = "在库";
        let textClass = "meta";

        if (isRepair) {
          statusText = "维修中";
          badgeClass = "repair";
          badgeText = "维修中";
          textClass = "repair";
        } else if (isMissing) {
          statusText = "已缺失";
          badgeClass = "repair";
          badgeText = "缺失";
          textClass = "repair";
        } else if (isRented) {
          statusText = "已出租";
          badgeClass = "";
          badgeText = "出租中";
          textClass = "meta";
        } else if (isOccupied) {
          statusText = "该租期已占用";
          badgeClass = "";
          badgeText = "占用";
          textClass = "meta";
        }

        const badgeStyle =
          badgeClass === ""
            ? isRented
              ? 'style="background:#e6eaf4;color:var(--blue)"'
              : 'style="background:#f7eadd;color:#8a5a2e"'
            : "";

        return `<div class="${cls}" data-id="${item.id}" title="${unavailable ? "不可选择" : "点击选择"}">
          <b>${escapeHtml(item.name)}</b>
          <div class="meta">${escapeHtml(item.id)} · ${escapeHtml(item.category)} · ${escapeHtml(item.spec || "—")}</div>
          <div class="${textClass}">
            <span class="badge ${badgeClass}" ${badgeStyle}>${badgeText}</span>
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

  if (customerFilterFromUrl) {
    visible = visible.filter((o) => (o.customer || "") === customerFilterFromUrl);
  }

  if (cat) {
    visible = visible.filter((o) =>
      o.itemIds.some((id) => {
        const eq = equipment.find((e) => e.id === id);
        return eq && eq.category === cat;
      })
    );
  }

  if (!visible.length) {
    const filterTip = customerFilterFromUrl
      ? `<div style="padding:30px;text-align:center;color:var(--muted);grid-column:1/-1">客户「${escapeHtml(customerFilterFromUrl)}」暂无订单 · <a href="/" style="color:var(--blue)">显示全部</a></div>`
      : `<div style="padding:30px;text-align:center;color:var(--muted);grid-column:1/-1">暂无匹配订单</div>`;
    ordersEl.innerHTML = filterTip;
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

      let actionBtn = "";
      if (o.status === "待出库") {
        actionBtn = `<button class="handover-btn small" data-action="checkout" data-order-id="${escapeHtml(o.id)}">📦 出库交接</button>`;
      } else if (o.status === "已出库" || o.status === "待归还") {
        actionBtn = `<button class="handover-btn small secondary" data-action="return" data-order-id="${escapeHtml(o.id)}">📥 归还交接</button>`;
      } else if (o.status === "已取消") {
        actionBtn = `<span class="badge" style="background:#f0f0f0;color:var(--muted)">已取消</span>`;
      } else if (o.status === "已归还") {
        actionBtn = `<span class="badge available">已完成</span>`;
      }

      return `<article class="order" data-order-id="${escapeHtml(o.id)}" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <h3>${escapeHtml(o.customer)}</h3>
          <span class="order-id">${escapeHtml(o.id)}</span>
        </div>
        <div class="meta">${escapeHtml(o.startDate)} 至 ${escapeHtml(o.endDate)}${o.note ? ` · ${escapeHtml(o.note)}` : ""}</div>
        <div class="items-list">${tags}</div>
        <div class="status-row">
          <span class="badge">${escapeHtml(o.status)}</span>
          ${actionBtn}
        </div>
        <div style="display:flex;gap:8px">
          <button class="print-btn ghost small" data-order-id="${escapeHtml(o.id)}" style="flex:1">🖨 打印交接单</button>
          <button class="view-detail-btn ghost small" data-order-id="${escapeHtml(o.id)}" style="flex:1">📋 查看详情</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="settlement-btn ghost small" data-order-id="${escapeHtml(o.id)}" style="flex:1">💰 项目结算</button>
        </div>
      </article>`;
    })
    .join("");

  document.querySelectorAll(".handover-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      openOrderDetail(btn.dataset.orderId, btn.dataset.action);
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

  document.querySelectorAll(".settlement-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      window.location.href = `/settlement?id=${encodeURIComponent(btn.dataset.orderId)}`;
    };
  });

  document.querySelectorAll(".order").forEach((order) => {
    order.onclick = () => {
      openOrderDetail(order.dataset.orderId);
    };
  });
}

let currentDetailOrderId = null;

async function openOrderDetail(id, autoFocusAction) {
  currentDetailOrderId = id;
  const modal = document.getElementById("orderDetailModal");
  const body = document.getElementById("orderDetailBody");

  modal.classList.remove("hidden");
  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中…</div>';

  try {
    const order = await Orders.get(id);
    renderOrderDetail(order, autoFocusAction);
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function closeOrderDetail() {
  document.getElementById("orderDetailModal").classList.add("hidden");
  currentDetailOrderId = null;
}

function renderOrderDetail(o, autoFocusAction) {
  const body = document.getElementById("orderDetailBody");

  const itemsHtml = o.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.spec || "—")}</td>
    </tr>
  `).join("");

  let handoverRecordsHtml = "";
  if (o.handovers && o.handovers.length) {
    handoverRecordsHtml = o.handovers.map((h) => {
      if (h.type === "checkout") {
        const confRows = (h.itemConfirmations || []).map((c, i) => `
          <tr>
            <td class="center">${i + 1}</td>
            <td>${escapeHtml(c.itemId)}</td>
            <td>${escapeHtml(c.itemName || "")}</td>
            <td>${escapeHtml(c.confirmed ? "✅ 已确认" : "❌ 未确认")}</td>
            <td>${escapeHtml(c.remark || "—")}</td>
          </tr>
        `).join("");
        return `
          <div class="handover-record checkout-record">
            <div class="handover-record-header">
              <span class="badge" style="background:#e3f2ea;color:var(--green)">出库交接</span>
              <span class="meta">${escapeHtml(h.id)} · ${escapeHtml(new Date(h.createdAt).toLocaleString("zh-CN"))}</span>
            </div>
            <div class="handover-record-body">
              <div class="handover-field"><span class="handover-label">经手人</span><span>${escapeHtml(h.handler)}</span></div>
              <div class="handover-field"><span class="handover-label">实际出库时间</span><span>${escapeHtml(h.actualTime)}</span></div>
              ${h.remarks ? `<div class="handover-field"><span class="handover-label">备注</span><span>${escapeHtml(h.remarks)}</span></div>` : ""}
              <table class="equip-table handover-table" style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
                <thead>
                  <tr>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:40px">序号</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">设备编号</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">设备名称</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">确认结果</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">说明</th>
                  </tr>
                </thead>
                <tbody>${confRows}</tbody>
              </table>
            </div>
          </div>
        `;
      } else {
        const statusRows = (h.itemStatuses || []).map((s, i) => {
          const statusLabel = { intact: "完好", damaged: "损坏", missing: "缺失" }[s.status] || s.status;
          const statusClass = { intact: "available", damaged: "repair", missing: "repair" }[s.status] || "";
          return `
            <tr>
              <td class="center">${i + 1}</td>
              <td>${escapeHtml(s.itemId)}</td>
              <td>${escapeHtml(s.itemName || "")}</td>
              <td><span class="badge ${statusClass}">${statusLabel}</span></td>
              <td>${escapeHtml(s.remark || "—")}</td>
            </tr>
          `;
        }).join("");
        return `
          <div class="handover-record return-record">
            <div class="handover-record-header">
              <span class="badge" style="background:#dde8f5;color:var(--blue)">归还交接</span>
              <span class="meta">${escapeHtml(h.id)} · ${escapeHtml(new Date(h.createdAt).toLocaleString("zh-CN"))}</span>
            </div>
            <div class="handover-record-body">
              ${h.handler ? `<div class="handover-field"><span class="handover-label">经手人</span><span>${escapeHtml(h.handler)}</span></div>` : ""}
              <div class="handover-field"><span class="handover-label">实际归还时间</span><span>${escapeHtml(h.actualTime)}</span></div>
              ${h.compensationNote ? `<div class="handover-field"><span class="handover-label">赔偿说明</span><span>${escapeHtml(h.compensationNote)}</span></div>` : ""}
              ${h.extraCharges ? `<div class="handover-field"><span class="handover-label">额外费用</span><span style="color:var(--red);font-weight:600">¥${Number(h.extraCharges).toFixed(2)}</span></div>` : ""}
              ${h.remarks ? `<div class="handover-field"><span class="handover-label">备注</span><span>${escapeHtml(h.remarks)}</span></div>` : ""}
              <table class="equip-table handover-table" style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
                <thead>
                  <tr>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:40px">序号</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">设备编号</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">设备名称</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:80px">状态</th>
                    <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">说明</th>
                  </tr>
                </thead>
                <tbody>${statusRows}</tbody>
              </table>
            </div>
          </div>
        `;
      }
    }).join("");
  } else {
    handoverRecordsHtml = `<div style="text-align:center;padding:16px;color:var(--muted);font-size:13px">暂无交接记录</div>`;
  }

  let handoverFormHtml = "";
  if (o.status === "待出库") {
    const confirmRows = o.items.map((item) => `
      <tr>
        <td class="center"><input type="checkbox" class="checkout-confirm" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}" checked></td>
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td><input type="text" class="checkout-remark small-input" data-item-id="${escapeHtml(item.id)}" placeholder="备注"></td>
      </tr>
    `).join("");
    handoverFormHtml = `
      <div class="handover-form-section" id="checkoutFormSection">
        <h4 class="handover-form-title">📦 出库交接</h4>
        <div class="draft-banner hidden" id="checkoutDraftBanner">
          <span class="draft-icon">📝</span>
          <span class="draft-text">检测到未完成的草稿，已自动回填。<span class="draft-time" id="checkoutDraftTime"></span></span>
          <button class="draft-clear-btn" id="clearCheckoutDraft">清除草稿</button>
        </div>
        <div class="handover-form-grid">
          <div>
            <label>经手人 *</label>
            <input type="text" id="checkoutHandler" placeholder="出库经手人姓名">
          </div>
          <div>
            <label>实际出库时间 *</label>
            <input type="datetime-local" id="checkoutTime">
          </div>
        </div>
        <label>设备逐项确认</label>
        <table class="equip-table handover-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:40px">确认</th>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">设备编号</th>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">设备名称</th>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">说明</th>
            </tr>
          </thead>
          <tbody>${confirmRows}</tbody>
        </table>
        <label>备注</label>
        <textarea id="checkoutRemarks" placeholder="出库备注信息" rows="2"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="ghost" id="saveCheckoutDraft" style="flex:1">💾 保存草稿</button>
          <button class="secondary" id="submitCheckout" style="flex:2">确认出库交接</button>
        </div>
      </div>
    `;
  } else if (o.status === "已出库" || o.status === "待归还") {
    const statusRows = o.items.map((item) => `
      <tr>
        <td class="center">${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>
          <select class="return-status small-select" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}">
            <option value="intact">完好</option>
            <option value="damaged">损坏</option>
            <option value="missing">缺失</option>
          </select>
        </td>
        <td><input type="text" class="return-remark small-input" data-item-id="${escapeHtml(item.id)}" placeholder="说明"></td>
      </tr>
    `).join("");
    handoverFormHtml = `
      <div class="handover-form-section" id="returnFormSection">
        <h4 class="handover-form-title">📥 归还交接</h4>
        <div class="draft-banner hidden" id="returnDraftBanner">
          <span class="draft-icon">📝</span>
          <span class="draft-text">检测到未完成的草稿，已自动回填。<span class="draft-time" id="returnDraftTime"></span></span>
          <button class="draft-clear-btn" id="clearReturnDraft">清除草稿</button>
        </div>
        <div class="handover-form-grid">
          <div>
            <label>经手人</label>
            <input type="text" id="returnHandler" placeholder="归还经手人姓名">
          </div>
          <div>
            <label>实际归还时间 *</label>
            <input type="datetime-local" id="returnTime">
          </div>
        </div>
        <label>设备归还状态</label>
        <table class="equip-table handover-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">设备编号</th>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">设备名称</th>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted);width:100px">状态</th>
              <th style="border:1px solid var(--line);padding:6px 10px;text-align:left;background:#f6f8f6;color:var(--muted)">说明</th>
            </tr>
          </thead>
          <tbody>${statusRows}</tbody>
        </table>
        <div class="handover-form-grid">
          <div>
            <label>赔偿说明</label>
            <textarea id="returnCompensation" placeholder="如有损坏/缺失，填写赔偿说明" rows="2"></textarea>
          </div>
          <div>
            <label>额外费用（元）</label>
            <input type="number" id="returnExtraCharges" placeholder="0" min="0" step="0.01">
          </div>
        </div>
        <label>备注</label>
        <textarea id="returnRemarks" placeholder="归还备注信息" rows="2"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="ghost" id="saveReturnDraft" style="flex:1">💾 保存草稿</button>
          <button class="secondary" id="submitReturn" style="flex:2">确认归还交接</button>
        </div>
      </div>
    `;
  }

  const statusSteps = [
    { key: "待出库", label: "待出库" },
    { key: "已出库", label: "已出库" },
    { key: "待归还", label: "待归还" },
    { key: "已归还", label: "已归还" }
  ];
  const currentStepIndex = statusSteps.findIndex((s) => s.key === o.status);
  const timelineHtml = statusSteps.map((step, i) => {
    const isActive = i <= currentStepIndex && currentStepIndex >= 0;
    return `
      <div class="status-step ${isActive ? "active" : ""}">
        <div class="step-dot">${isActive ? "✓" : i + 1}</div>
        <div class="step-label">${step.label}</div>
      </div>
    `;
  }).join("");

  let pendingReturnBtnHtml = "";
  if (o.status === "已出库") {
    pendingReturnBtnHtml = `<button class="pending-return-btn small" id="markPendingReturnBtn" style="width:100%;margin-top:10px">⏰ 标记为待归还</button>`;
  }

  body.innerHTML = `
    <div class="detail-section">
      <div class="detail-id" style="text-align:right;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;margin-bottom:12px">${escapeHtml(o.id)}</div>
      <h3 style="margin:0 0 12px 0;font-size:18px">${escapeHtml(o.customer)}</h3>
      <div class="status-timeline">${timelineHtml}</div>
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

    <h4 style="margin:20px 0 8px 0;font-size:14px">交接记录</h4>
    <div class="handover-records">${handoverRecordsHtml}</div>

    ${pendingReturnBtnHtml}

    ${handoverFormHtml}
  `;

  function collectCheckoutDraftData() {
    const handler = document.getElementById("checkoutHandler")?.value.trim() || "";
    const actualTime = document.getElementById("checkoutTime")?.value || "";
    const remarks = document.getElementById("checkoutRemarks")?.value.trim() || "";
    const itemConfirmations = [];
    document.querySelectorAll(".checkout-confirm").forEach((cb) => {
      const itemId = cb.dataset.itemId;
      const itemName = cb.dataset.itemName;
      const confirmed = cb.checked;
      const remarkEl = document.querySelector(`.checkout-remark[data-item-id="${itemId}"]`);
      itemConfirmations.push({
        itemId,
        itemName,
        confirmed,
        remark: remarkEl ? remarkEl.value.trim() : ""
      });
    });
    return { handler, actualTime, itemConfirmations, remarks };
  }

  function collectReturnDraftData() {
    const handler = document.getElementById("returnHandler")?.value.trim() || "";
    const actualTime = document.getElementById("returnTime")?.value || "";
    const compensationNote = document.getElementById("returnCompensation")?.value.trim() || "";
    const extraCharges = parseFloat(document.getElementById("returnExtraCharges")?.value) || 0;
    const remarks = document.getElementById("returnRemarks")?.value.trim() || "";
    const itemStatuses = [];
    document.querySelectorAll(".return-status").forEach((sel) => {
      const itemId = sel.dataset.itemId;
      const itemName = sel.dataset.itemName;
      const status = sel.value;
      const remarkEl = document.querySelector(`.return-remark[data-item-id="${itemId}"]`);
      itemStatuses.push({
        itemId,
        itemName,
        status,
        remark: remarkEl ? remarkEl.value.trim() : ""
      });
    });
    return { handler, actualTime, itemStatuses, compensationNote, extraCharges, remarks };
  }

  function fillCheckoutFormFromDraft(draft) {
    if (!draft) return;
    if (draft.handler && document.getElementById("checkoutHandler")) {
      document.getElementById("checkoutHandler").value = draft.handler;
    }
    if (draft.actualTime && document.getElementById("checkoutTime")) {
      document.getElementById("checkoutTime").value = draft.actualTime;
    }
    if (draft.remarks && document.getElementById("checkoutRemarks")) {
      document.getElementById("checkoutRemarks").value = draft.remarks;
    }
    if (draft.itemConfirmations && draft.itemConfirmations.length) {
      const confirmMap = new Map(draft.itemConfirmations.map((c) => [c.itemId, c]));
      document.querySelectorAll(".checkout-confirm").forEach((cb) => {
        const itemId = cb.dataset.itemId;
        const saved = confirmMap.get(itemId);
        if (saved) {
          cb.checked = saved.confirmed;
          const remarkEl = document.querySelector(`.checkout-remark[data-item-id="${itemId}"]`);
          if (remarkEl && saved.remark) {
            remarkEl.value = saved.remark;
          }
        }
      });
    }
    const banner = document.getElementById("checkoutDraftBanner");
    const timeEl = document.getElementById("checkoutDraftTime");
    if (banner && draft.updatedAt) {
      banner.classList.remove("hidden");
      if (timeEl) {
        timeEl.textContent = `（保存于 ${new Date(draft.updatedAt).toLocaleString("zh-CN")}）`;
      }
    }
  }

  function fillReturnFormFromDraft(draft) {
    if (!draft) return;
    if (draft.handler && document.getElementById("returnHandler")) {
      document.getElementById("returnHandler").value = draft.handler;
    }
    if (draft.actualTime && document.getElementById("returnTime")) {
      document.getElementById("returnTime").value = draft.actualTime;
    }
    if (draft.compensationNote && document.getElementById("returnCompensation")) {
      document.getElementById("returnCompensation").value = draft.compensationNote;
    }
    if (draft.extraCharges !== undefined && draft.extraCharges !== null && document.getElementById("returnExtraCharges")) {
      document.getElementById("returnExtraCharges").value = draft.extraCharges;
    }
    if (draft.remarks && document.getElementById("returnRemarks")) {
      document.getElementById("returnRemarks").value = draft.remarks;
    }
    if (draft.itemStatuses && draft.itemStatuses.length) {
      const statusMap = new Map(draft.itemStatuses.map((s) => [s.itemId, s]));
      document.querySelectorAll(".return-status").forEach((sel) => {
        const itemId = sel.dataset.itemId;
        const saved = statusMap.get(itemId);
        if (saved) {
          sel.value = saved.status;
          const remarkEl = document.querySelector(`.return-remark[data-item-id="${itemId}"]`);
          if (remarkEl && saved.remark) {
            remarkEl.value = saved.remark;
          }
        }
      });
    }
    const banner = document.getElementById("returnDraftBanner");
    const timeEl = document.getElementById("returnDraftTime");
    if (banner && draft.updatedAt) {
      banner.classList.remove("hidden");
      if (timeEl) {
        timeEl.textContent = `（保存于 ${new Date(draft.updatedAt).toLocaleString("zh-CN")}）`;
      }
    }
  }

  async function loadAndFillDraft(orderId, type) {
    try {
      const draft = await Orders.getHandoverDraft(orderId, type);
      if (type === "checkout") {
        fillCheckoutFormFromDraft(draft);
      } else if (type === "return") {
        fillReturnFormFromDraft(draft);
      }
      return draft;
    } catch (err) {
      if (err.message !== "draft_not_found") {
        console.error("加载草稿失败:", err);
      }
      return null;
    }
  }

  if (o.status === "待出库") {
    loadAndFillDraft(o.id, "checkout");
  } else if (o.status === "已出库" || o.status === "待归还") {
    loadAndFillDraft(o.id, "return");
  }

  function getNowLocal() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  if (o.status === "待出库") {
    const timeInput = document.getElementById("checkoutTime");
    if (timeInput && !timeInput.value) {
      timeInput.value = getNowLocal();
    }

    const submitCheckoutBtn = document.getElementById("submitCheckout");
    if (submitCheckoutBtn) {
      submitCheckoutBtn.onclick = async () => {
        const handler = document.getElementById("checkoutHandler").value.trim();
        const actualTime = document.getElementById("checkoutTime").value;
        if (!handler) return showToast("请填写经手人", "error");
        if (!actualTime) return showToast("请填写实际出库时间", "error");

        const itemConfirmations = [];
        let allConfirmed = true;
        document.querySelectorAll(".checkout-confirm").forEach((cb) => {
          const itemId = cb.dataset.itemId;
          const itemName = cb.dataset.itemName;
          const confirmed = cb.checked;
          if (!confirmed) allConfirmed = false;
          const remarkEl = document.querySelector(`.checkout-remark[data-item-id="${itemId}"]`);
          itemConfirmations.push({
            itemId,
            itemName,
            confirmed,
            remark: remarkEl ? remarkEl.value.trim() : ""
          });
        });

        if (!allConfirmed) {
          showToast("所有设备必须确认后才能出库", "error");
          return;
        }

        const remarks = document.getElementById("checkoutRemarks").value.trim();

        try {
          submitCheckoutBtn.disabled = true;
          submitCheckoutBtn.textContent = "提交中…";
          await Orders.createHandover(o.id, {
            type: "checkout",
            handler,
            actualTime,
            itemConfirmations,
            remarks
          });
          try {
            await Orders.deleteHandoverDraft(o.id, "checkout");
          } catch (e) {
          }
          showToast("出库交接完成，订单状态已更新为「已出库」");
          closeOrderDetail();
          await load();
        } catch (err) {
          showToast(err.message, "error");
          submitCheckoutBtn.disabled = false;
          submitCheckoutBtn.textContent = "确认出库交接";
        }
      };
    }

    const saveCheckoutDraftBtn = document.getElementById("saveCheckoutDraft");
    if (saveCheckoutDraftBtn) {
      saveCheckoutDraftBtn.onclick = async () => {
        const data = collectCheckoutDraftData();
        try {
          saveCheckoutDraftBtn.disabled = true;
          const originalText = saveCheckoutDraftBtn.textContent;
          saveCheckoutDraftBtn.textContent = "保存中…";
          await Orders.saveHandoverDraft(o.id, "checkout", data);
          const banner = document.getElementById("checkoutDraftBanner");
          const timeEl = document.getElementById("checkoutDraftTime");
          if (banner) {
            banner.classList.remove("hidden");
            if (timeEl) {
              timeEl.textContent = `（保存于 ${new Date().toLocaleString("zh-CN")}）`;
            }
          }
          showToast("草稿已保存", "success");
          saveCheckoutDraftBtn.disabled = false;
          saveCheckoutDraftBtn.textContent = originalText;
        } catch (err) {
          showToast(err.message || "保存草稿失败", "error");
          saveCheckoutDraftBtn.disabled = false;
          saveCheckoutDraftBtn.textContent = "💾 保存草稿";
        }
      };
    }

    const clearCheckoutDraftBtn = document.getElementById("clearCheckoutDraft");
    if (clearCheckoutDraftBtn) {
      clearCheckoutDraftBtn.onclick = async () => {
        if (!confirm("确定要清除当前草稿吗？")) return;
        try {
          await Orders.deleteHandoverDraft(o.id, "checkout");
          const banner = document.getElementById("checkoutDraftBanner");
          if (banner) banner.classList.add("hidden");
          document.getElementById("checkoutHandler").value = "";
          document.getElementById("checkoutTime").value = getNowLocal();
          document.getElementById("checkoutRemarks").value = "";
          document.querySelectorAll(".checkout-confirm").forEach((cb) => {
            cb.checked = true;
            const itemId = cb.dataset.itemId;
            const remarkEl = document.querySelector(`.checkout-remark[data-item-id="${itemId}"]`);
            if (remarkEl) remarkEl.value = "";
          });
          showToast("草稿已清除", "success");
        } catch (err) {
          if (err.message !== "draft_not_found") {
            showToast(err.message || "清除草稿失败", "error");
          }
        }
      };
    }
  }

  if (o.status === "已出库" || o.status === "待归还") {
    const timeInput = document.getElementById("returnTime");
    if (timeInput && !timeInput.value) {
      timeInput.value = getNowLocal();
    }

    const submitReturnBtn = document.getElementById("submitReturn");
    if (submitReturnBtn) {
      submitReturnBtn.onclick = async () => {
        const handler = document.getElementById("returnHandler").value.trim();
        const actualTime = document.getElementById("returnTime").value;
        if (!actualTime) return showToast("请填写实际归还时间", "error");

        const itemStatuses = [];
        let hasDamaged = false;
        let hasMissing = false;
        document.querySelectorAll(".return-status").forEach((sel) => {
          const itemId = sel.dataset.itemId;
          const itemName = sel.dataset.itemName;
          const status = sel.value;
          if (status === "damaged") hasDamaged = true;
          if (status === "missing") hasMissing = true;
          const remarkEl = document.querySelector(`.return-remark[data-item-id="${itemId}"]`);
          itemStatuses.push({
            itemId,
            itemName,
            status,
            remark: remarkEl ? remarkEl.value.trim() : ""
          });
        });

        const compensationNote = document.getElementById("returnCompensation").value.trim();
        const extraCharges = parseFloat(document.getElementById("returnExtraCharges").value) || 0;
        const remarks = document.getElementById("returnRemarks").value.trim();

        if ((hasDamaged || hasMissing) && !compensationNote) {
          if (!confirm("有设备损坏或缺失，但未填写赔偿说明，确定提交吗？")) return;
        }

        try {
          submitReturnBtn.disabled = true;
          submitReturnBtn.textContent = "提交中…";
          await Orders.createHandover(o.id, {
            type: "return",
            handler,
            actualTime,
            itemStatuses,
            compensationNote,
            extraCharges,
            remarks
          });
          try {
            await Orders.deleteHandoverDraft(o.id, "return");
          } catch (e) {
          }
          let msg = "归还交接完成，订单状态已更新为「已归还」";
          if (hasDamaged) msg += "，损坏设备已自动创建维修工单";
          showToast(msg);
          closeOrderDetail();
          await load();
        } catch (err) {
          showToast(err.message, "error");
          submitReturnBtn.disabled = false;
          submitReturnBtn.textContent = "确认归还交接";
        }
      };
    }

    const saveReturnDraftBtn = document.getElementById("saveReturnDraft");
    if (saveReturnDraftBtn) {
      saveReturnDraftBtn.onclick = async () => {
        const data = collectReturnDraftData();
        try {
          saveReturnDraftBtn.disabled = true;
          const originalText = saveReturnDraftBtn.textContent;
          saveReturnDraftBtn.textContent = "保存中…";
          await Orders.saveHandoverDraft(o.id, "return", data);
          const banner = document.getElementById("returnDraftBanner");
          const timeEl = document.getElementById("returnDraftTime");
          if (banner) {
            banner.classList.remove("hidden");
            if (timeEl) {
              timeEl.textContent = `（保存于 ${new Date().toLocaleString("zh-CN")}）`;
            }
          }
          showToast("草稿已保存", "success");
          saveReturnDraftBtn.disabled = false;
          saveReturnDraftBtn.textContent = originalText;
        } catch (err) {
          showToast(err.message || "保存草稿失败", "error");
          saveReturnDraftBtn.disabled = false;
          saveReturnDraftBtn.textContent = "💾 保存草稿";
        }
      };
    }

    const clearReturnDraftBtn = document.getElementById("clearReturnDraft");
    if (clearReturnDraftBtn) {
      clearReturnDraftBtn.onclick = async () => {
        if (!confirm("确定要清除当前草稿吗？")) return;
        try {
          await Orders.deleteHandoverDraft(o.id, "return");
          const banner = document.getElementById("returnDraftBanner");
          if (banner) banner.classList.add("hidden");
          document.getElementById("returnHandler").value = "";
          document.getElementById("returnTime").value = getNowLocal();
          document.getElementById("returnCompensation").value = "";
          document.getElementById("returnExtraCharges").value = "";
          document.getElementById("returnRemarks").value = "";
          document.querySelectorAll(".return-status").forEach((sel) => {
            sel.value = "intact";
            const itemId = sel.dataset.itemId;
            const remarkEl = document.querySelector(`.return-remark[data-item-id="${itemId}"]`);
            if (remarkEl) remarkEl.value = "";
          });
          showToast("草稿已清除", "success");
        } catch (err) {
          if (err.message !== "draft_not_found") {
            showToast(err.message || "清除草稿失败", "error");
          }
        }
      };
    }
  }

  if (autoFocusAction === "checkout") {
    const section = document.getElementById("checkoutFormSection");
    if (section) {
      setTimeout(() => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        const handlerInput = document.getElementById("checkoutHandler");
        if (handlerInput) handlerInput.focus();
      }, 100);
    }
  } else if (autoFocusAction === "return") {
    const section = document.getElementById("returnFormSection");
    if (section) {
      setTimeout(() => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        const handlerInput = document.getElementById("returnHandler");
        if (handlerInput) handlerInput.focus();
      }, 100);
    }
  }

  const markPendingReturnBtn = document.getElementById("markPendingReturnBtn");
  if (markPendingReturnBtn) {
    markPendingReturnBtn.onclick = async () => {
      if (!confirm("确定要将此订单标记为「待归还」吗？")) return;
      try {
        markPendingReturnBtn.disabled = true;
        markPendingReturnBtn.textContent = "处理中…";
        await Orders.update(o.id, { status: "待归还" });
        showToast("订单已标记为「待归还」");
        closeOrderDetail();
        await load();
      } catch (err) {
        showToast(err.message, "error");
        markPendingReturnBtn.disabled = false;
        markPendingReturnBtn.textContent = "⏰ 标记为待归还";
      }
    };
  }

  const printBtn = document.getElementById("detailPrintBtn");
  printBtn.onclick = () => {
    window.open(`/print?id=${encodeURIComponent(currentDetailOrderId)}`, "_blank");
  };

  const settlementBtn = document.getElementById("detailSettlementBtn");
  if (settlementBtn) {
    settlementBtn.onclick = () => {
      closeOrderDetail();
      window.location.href = `/settlement?id=${encodeURIComponent(currentDetailOrderId)}`;
    };
  }
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
    const params = new URLSearchParams(window.location.search);
    customerFilterFromUrl = params.get("customer") || "";

    const orderParams = customerFilterFromUrl ? { customer: customerFilterFromUrl } : null;
    [equipment, orders, customers] = await Promise.all([
      Equipment.list(),
      Orders.list(orderParams),
      Customers.list()
    ]);
    renderCategoryFilters();
    renderCustomerOptions();
    render();

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
