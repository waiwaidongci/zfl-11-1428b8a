import { Orders, Settlements, showToast, SETTLEMENT_STATUS_LABELS, FEE_TYPE_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, PAYMENT_PLAN_NODE_TYPE_LABELS, PAYMENT_PLAN_NODE_STATUS_LABELS, PAYMENT_PLAN_OVERALL_STATUS_LABELS } from "./api.js";

let orders = [];
let settlements = [];
let currentOrderId = null;
let currentSettlement = null;
let editingFeeId = null;
let editingPaymentId = null;
let editingPlanId = null;
let customerFilterFromUrl = "";

const orderListEl = document.getElementById("orderList");
const noSelectionEl = document.getElementById("noSelection");
const settlementDetailEl = document.getElementById("settlementDetail");
const statusFilterEl = document.getElementById("statusFilter");
const settlementStatusFilterEl = document.getElementById("settlementStatusFilter");

async function loadOrders() {
  try {
    const params = new URLSearchParams(window.location.search);
    customerFilterFromUrl = params.get("customer") || "";

    const orderParams = customerFilterFromUrl ? { customer: customerFilterFromUrl } : null;
    orders = await Orders.list(orderParams);
    try {
      const settlementParams = customerFilterFromUrl ? { customer: customerFilterFromUrl } : null;
      settlements = await Settlements.list(settlementParams);
    } catch {
      settlements = [];
    }
    renderOrderList();
  } catch (err) {
    orderListEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--red)">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderOrderList() {
  const statusFilter = statusFilterEl.value;
  const settlementFilter = settlementStatusFilterEl.value;

  let visible = [...orders];

  if (customerFilterFromUrl) {
    visible = visible.filter((o) => (o.customer || "") === customerFilterFromUrl);
  }

  if (statusFilter) {
    visible = visible.filter((o) => o.status === statusFilter);
  }

  if (settlementFilter) {
    const settlementMap = new Map(settlements.map((s) => [s.orderId, s]));
    visible = visible.filter((o) => {
      const s = settlementMap.get(o.id);
      if (!s) return settlementFilter === "draft";
      return s.status === settlementFilter;
    });
  }

  if (!visible.length) {
    const emptyTip = customerFilterFromUrl
      ? `<div style="text-align:center;padding:30px;color:var(--muted)">客户「${escapeHtml(customerFilterFromUrl)}」暂无结算订单 · <a href="/settlement" style="color:var(--blue)">显示全部</a></div>`
      : `<div style="text-align:center;padding:30px;color:var(--muted)">暂无匹配订单</div>`;
    orderListEl.innerHTML = emptyTip;
    return;
  }

  const settlementMap = new Map(settlements.map((s) => [s.orderId, s]));

  orderListEl.innerHTML = visible
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
    .map((o) => {
      const s = settlementMap.get(o.id);
      const settlementStatus = s ? s.status : "draft";
      const settlementStatusLabel = s ? s.statusLabel : "待结算";
      const balanceDue = s ? s.balanceDue : 0;
      const planStatus = s ? s.planStatus : null;
      const planStatusLabel = s ? s.planStatusLabel : null;
      const hasOverduePlan = s ? s.hasOverduePlan : false;

      let statusClass = "status-draft";
      if (settlementStatus === "partial") statusClass = "status-partial";
      else if (settlementStatus === "settled") statusClass = "status-settled";
      else if (settlementStatus === "cancelled") statusClass = "status-cancelled";

      let planBadge = "";
      if (planStatus) {
        let planClass = "plan-status-pending";
        if (planStatus === "overdue") planClass = "plan-status-overdue";
        else if (planStatus === "partial") planClass = "plan-status-partial";
        else if (planStatus === "completed") planClass = "plan-status-completed";
        planBadge = `<span class="badge plan-status-badge ${planClass}">${escapeHtml(planStatusLabel)}</span>`;
      }

      const isActive = currentOrderId === o.id;

      return `
        <div class="order-item ${isActive ? "active" : ""}" data-order-id="${escapeHtml(o.id)}">
          <div class="order-item-header">
            <span class="order-item-customer">${escapeHtml(o.customer)}</span>
            <span class="order-item-id">${escapeHtml(o.id)}</span>
          </div>
          <div class="order-item-meta">
            <span>${escapeHtml(o.startDate)} ~ ${escapeHtml(o.endDate)}</span>
          </div>
          <div class="order-item-badges">
            <span class="badge ${statusClass}">${escapeHtml(settlementStatusLabel)}</span>
            ${planBadge}
          </div>
          <div class="order-item-footer">
            <span class="order-item-amount">
              ${balanceDue > 0 ? `待收 ¥${balanceDue.toFixed(2)}` : "已结清"}
            </span>
            ${hasOverduePlan ? `<span class="overdue-indicator">⚠️ 逾期</span>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".order-item").forEach((item) => {
    item.onclick = () => selectOrder(item.dataset.orderId);
  });
}

async function selectOrder(orderId) {
  currentOrderId = orderId;
  renderOrderList();
  noSelectionEl.classList.add("hidden");
  settlementDetailEl.classList.remove("hidden");
  await loadSettlement();
}

async function loadSettlement() {
  if (!currentOrderId) return;
  try {
    currentSettlement = await Settlements.get(currentOrderId);
    renderSettlementDetail();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderSettlementDetail() {
  if (!currentSettlement) return;

  const s = currentSettlement;
  const o = s.order;
  const sum = s.summary;

  document.getElementById("customerName").textContent = o.customer;
  document.getElementById("orderId").textContent = o.id;
  document.getElementById("orderDateRange").textContent = `${o.startDate} 至 ${o.endDate}`;

  const statusEl = document.getElementById("settlementStatus");
  statusEl.textContent = s.statusLabel;
  statusEl.className = `status-badge status-${s.status}`;

  document.getElementById("receivableTotal").textContent = `¥${sum.receivableTotal.toFixed(2)}`;
  document.getElementById("totalPaid").textContent = `¥${sum.totalPaid.toFixed(2)}`;
  document.getElementById("balanceDue").textContent = `¥${sum.balanceDue.toFixed(2)}`;
  document.getElementById("remainingDeposit").textContent = `¥${sum.remainingDeposit.toFixed(2)}`;

  document.getElementById("orderCustomer").textContent = o.customer || "—";
  document.getElementById("orderContact").textContent = o.customerContact || "—";
  document.getElementById("orderPhone").textContent = o.customerPhone || "—";
  document.getElementById("orderStatus").textContent = o.status || "—";
  document.getElementById("orderStartDate").textContent = o.startDate || "—";
  document.getElementById("orderEndDate").textContent = o.endDate || "—";
  document.getElementById("orderNote").textContent = o.note || "—";

  renderPlanList();
  renderFeeList();
  renderPaymentList();

  const syncQuoteBtn = document.getElementById("syncQuoteBtn");
  if (s.quotationId) {
    syncQuoteBtn.disabled = false;
    syncQuoteBtn.textContent = `📋 同步报价单 (${s.quotationId})`;
  } else {
    syncQuoteBtn.disabled = true;
    syncQuoteBtn.textContent = "📋 同步报价单";
  }
}

function renderPlanList() {
  const plans = currentSettlement.paymentPlans || [];
  const planStatus = currentSettlement.planStatus || null;

  document.getElementById("planCount").textContent = `共 ${plans.length} 项`;

  const planStatusBadge = document.getElementById("planStatusBadge");
  if (planStatus && plans.length > 0) {
    planStatusBadge.style.display = "";
    planStatusBadge.textContent = planStatus.statusLabel || "";
    planStatusBadge.className = `badge plan-status-badge plan-status-${planStatus.status}`;
  } else {
    planStatusBadge.style.display = "none";
  }

  if (!plans.length) {
    document.getElementById("planList").innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted)">暂无收款计划，点击「➕ 添加节点」创建定金、尾款等收款计划</div>`;
    return;
  }

  const typeIcons = {
    deposit: "💰",
    balance: "💵",
    deposit_return: "↩️",
    custom: "📌"
  };

  document.getElementById("planList").innerHTML = plans
    .map((p) => {
      let statusClass = "plan-node-pending";
      if (p.status === "overdue") statusClass = "plan-node-overdue";
      else if (p.status === "partial") statusClass = "plan-node-partial";
      else if (p.status === "completed") statusClass = "plan-node-completed";

      return `
        <div class="plan-item" data-plan-id="${escapeHtml(p.id)}">
          <div class="plan-icon">${typeIcons[p.type] || "📌"}</div>
          <div class="plan-info">
            <div class="plan-name">
              ${escapeHtml(p.name)}
              <span class="badge source-badge">${escapeHtml(p.typeLabel)}</span>
              <span class="badge plan-node-status ${statusClass}">${escapeHtml(p.statusLabel)}</span>
            </div>
            <div class="plan-desc">
              应收日期：${escapeHtml(p.dueDate)}
              ${p.remark ? ` · ${escapeHtml(p.remark)}` : ""}
            </div>
            <div class="plan-progress-bar">
              <div class="plan-progress-fill" style="width:${p.progress}%"></div>
            </div>
            <div class="plan-progress-meta">
              已收 ¥${Number(p.paidAmount).toFixed(2)} / ¥${Number(p.amount).toFixed(2)}
              ${p.remainingAmount > 0 ? `（待收 ¥${Number(p.remainingAmount).toFixed(2)}）` : ""}
            </div>
          </div>
          <div class="plan-amount ${p.status === "completed" ? "completed" : p.status === "overdue" ? "overdue" : ""}">
            ¥${Number(p.amount).toFixed(2)}
          </div>
          <div class="plan-actions">
            <button class="ghost small" data-action="edit-plan" data-plan-id="${escapeHtml(p.id)}">编辑</button>
            <button class="ghost small danger" data-action="delete-plan" data-plan-id="${escapeHtml(p.id)}">删除</button>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".plan-item button[data-action='edit-plan']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openPlanModal(btn.dataset.planId);
    };
  });

  document.querySelectorAll(".plan-item button[data-action='delete-plan']").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定要删除此收款计划节点吗？关联的收款记录将解除关联。")) return;
      try {
        await Settlements.deletePlan(currentOrderId, btn.dataset.planId);
        currentSettlement = await Settlements.get(currentOrderId);
        renderSettlementDetail();
        await loadSettlementsList();
        showToast("收款计划节点已删除");
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  });
}

function renderFeeList() {
  const fees = currentSettlement.fees || [];
  document.getElementById("feeCount").textContent = `共 ${fees.length} 项`;

  if (!fees.length) {
    document.getElementById("feeList").innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted)">暂无费用项</div>`;
    return;
  }

  const typeIcons = {
    rental: "💵",
    deposit: "🔒",
    transport: "🚚",
    labor: "👷",
    setup: "🏗️",
    compensation: "🔧",
    discount: "🏷️"
  };

  const sortedFees = [...fees].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  document.getElementById("feeList").innerHTML = sortedFees
    .map((f) => {
      const isSystem = f.source !== "manual";
      const isDiscount = f.type === "discount";
      const sourceLabel = {
        system: "系统",
        manual: "手动",
        handover: "交接",
        quotation: "报价单"
      }[f.source] || f.source;

      return `
        <div class="fee-item" data-fee-id="${escapeHtml(f.id)}">
          <div class="fee-icon">${typeIcons[f.type] || "💰"}</div>
          <div class="fee-info">
            <div class="fee-name">
              ${escapeHtml(f.typeLabel)}
              ${isSystem ? `<span class="badge source-badge">${sourceLabel}</span>` : ""}
            </div>
            <div class="fee-desc">${escapeHtml(f.description || "无描述")}</div>
          </div>
          <div class="fee-amount ${isDiscount ? "discount" : ""}">
            ${isDiscount ? "-" : ""}¥${Number(f.amount).toFixed(2)}
          </div>
          <div class="fee-actions">
            ${!isSystem ? `
              <button class="ghost small" data-action="edit" data-fee-id="${escapeHtml(f.id)}">编辑</button>
              <button class="ghost small danger" data-action="delete" data-fee-id="${escapeHtml(f.id)}">删除</button>
            ` : `<span class="meta">自动同步</span>`}
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".fee-item button[data-action='edit']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openFeeModal(btn.dataset.feeId);
    };
  });

  document.querySelectorAll(".fee-item button[data-action='delete']").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定要删除此费用项吗？")) return;
      try {
        currentSettlement = await Settlements.deleteFee(currentOrderId, btn.dataset.feeId);
        renderSettlementDetail();
        await loadSettlementsList();
        showToast("费用项已删除");
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  });
}

function renderPaymentList() {
  const payments = currentSettlement.payments || [];
  document.getElementById("paymentCount").textContent = `共 ${payments.length} 笔`;

  if (!payments.length) {
    document.getElementById("paymentList").innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted)">暂无收款记录</div>`;
    return;
  }

  const typeIcons = {
    payment: "💰",
    deposit_deduction: "🔄",
    deposit_return: "↩️"
  };

  document.getElementById("paymentList").innerHTML = payments
    .map((p) => {
      const isReturn = p.type === "deposit_return";

      return `
        <div class="payment-item" data-payment-id="${escapeHtml(p.id)}">
          <div class="payment-icon">${typeIcons[p.type] || "💰"}</div>
          <div class="payment-info">
            <div class="payment-name">
              ${escapeHtml(p.typeLabel)}
              <span class="badge source-badge">${escapeHtml(p.methodLabel)}</span>
              ${p.planName ? `<span class="badge plan-link-badge">📅 ${escapeHtml(p.planName)}</span>` : ""}
            </div>
            <div class="payment-desc">
              ${escapeHtml(p.paymentDate || "")}
              ${p.remark ? ` · ${escapeHtml(p.remark)}` : ""}
            </div>
          </div>
          <div class="payment-amount ${isReturn ? "return" : ""}">
            ${isReturn ? "-" : "+"}¥${Number(p.amount).toFixed(2)}
          </div>
          <div class="payment-actions">
            <button class="ghost small" data-action="edit" data-payment-id="${escapeHtml(p.id)}">编辑</button>
            <button class="ghost small danger" data-action="delete" data-payment-id="${escapeHtml(p.id)}">删除</button>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".payment-item button[data-action='edit']").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openPaymentModal(btn.dataset.paymentId);
    };
  });

  document.querySelectorAll(".payment-item button[data-action='delete']").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定要删除此收款记录吗？")) return;
      try {
        currentSettlement = await Settlements.deletePayment(currentOrderId, btn.dataset.paymentId);
        renderSettlementDetail();
        await loadSettlementsList();
        showToast("收款记录已删除");
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  });
}

async function loadSettlementsList() {
  try {
    settlements = await Settlements.list();
    renderOrderList();
  } catch {
    settlements = [];
  }
}

function openFeeModal(feeId = null) {
  editingFeeId = feeId;
  const modal = document.getElementById("feeModal");
  const title = document.getElementById("feeModalTitle");

  if (feeId) {
    const fee = (currentSettlement.fees || []).find((f) => f.id === feeId);
    if (!fee) return;
    title.textContent = "编辑费用";
    document.getElementById("feeType").value = fee.type;
    document.getElementById("feeAmount").value = fee.amount;
    document.getElementById("feeDescription").value = fee.description || "";
  } else {
    title.textContent = "添加费用";
    document.getElementById("feeType").value = "transport";
    document.getElementById("feeAmount").value = "";
    document.getElementById("feeDescription").value = "";
  }

  modal.classList.remove("hidden");
  setTimeout(() => document.getElementById("feeAmount").focus(), 100);
}

function closeFeeModal() {
  document.getElementById("feeModal").classList.add("hidden");
  editingFeeId = null;
}

async function submitFee() {
  const type = document.getElementById("feeType").value;
  const amount = parseFloat(document.getElementById("feeAmount").value);
  const description = document.getElementById("feeDescription").value.trim();

  if (!type) return showToast("请选择费用类型", "error");
  if (Number.isNaN(amount) || amount < 0) return showToast("请输入有效的金额", "error");

  try {
    if (editingFeeId) {
      currentSettlement = await Settlements.updateFee(currentOrderId, editingFeeId, {
        type,
        amount,
        description
      });
      showToast("费用项已更新");
    } else {
      currentSettlement = await Settlements.addFee(currentOrderId, {
        type,
        amount,
        description,
        source: "manual"
      });
      showToast("费用项已添加");
    }
    closeFeeModal();
    renderSettlementDetail();
    await loadSettlementsList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openPaymentModal(paymentId = null) {
  editingPaymentId = paymentId;
  const modal = document.getElementById("paymentModal");
  const title = document.getElementById("paymentModalTitle");

  const today = new Date().toISOString().split("T")[0];
  const availablePlans = currentSettlement.availablePlans || [];
  const planSelect = document.getElementById("paymentPlanId");

  planSelect.innerHTML = `<option value="">不关联</option>` +
    availablePlans.map((p) => {
      const disabled = p.remainingAmount <= 0.01 ? " disabled" : "";
      return `<option value="${escapeHtml(p.id)}"${disabled}>${escapeHtml(p.name)} (待收 ¥${Number(p.remainingAmount).toFixed(2)})</option>`;
    }).join("");

  if (paymentId) {
    const payment = (currentSettlement.payments || []).find((p) => p.id === paymentId);
    if (!payment) return;
    title.textContent = "编辑收款记录";
    document.getElementById("paymentType").value = payment.type;
    document.getElementById("paymentAmount").value = payment.amount;
    document.getElementById("paymentMethod").value = payment.method;
    document.getElementById("paymentDate").value = payment.paymentDate || today;
    document.getElementById("paymentRemark").value = payment.remark || "";
    if (payment.planId) {
      if (!planSelect.querySelector(`option[value="${payment.planId}"]`)) {
        const linkedPlan = (currentSettlement.paymentPlans || []).find((p) => p.id === payment.planId);
        if (linkedPlan) {
          planSelect.innerHTML += `<option value="${escapeHtml(payment.planId)}" selected>${escapeHtml(linkedPlan.name)}</option>`;
        }
      } else {
        planSelect.value = payment.planId;
      }
    }
  } else {
    title.textContent = "登记收款";
    document.getElementById("paymentType").value = "payment";
    document.getElementById("paymentAmount").value = "";
    document.getElementById("paymentMethod").value = "cash";
    document.getElementById("paymentDate").value = today;
    document.getElementById("paymentRemark").value = "";
    planSelect.value = "";
  }

  modal.classList.remove("hidden");
  setTimeout(() => document.getElementById("paymentAmount").focus(), 100);
}

function closePaymentModal() {
  document.getElementById("paymentModal").classList.add("hidden");
  editingPaymentId = null;
}

function openPlanModal(planId = null) {
  editingPlanId = planId;
  const modal = document.getElementById("planModal");
  const title = document.getElementById("planModalTitle");

  const today = new Date().toISOString().split("T")[0];

  if (planId) {
    const plan = (currentSettlement.paymentPlans || []).find((p) => p.id === planId);
    if (!plan) return;
    title.textContent = "编辑收款计划节点";
    document.getElementById("planType").value = plan.type;
    document.getElementById("planName").value = plan.name || "";
    document.getElementById("planAmount").value = plan.amount;
    document.getElementById("planDueDate").value = plan.dueDate;
    document.getElementById("planRemark").value = plan.remark || "";
  } else {
    title.textContent = "添加收款计划节点";
    document.getElementById("planType").value = "deposit";
    document.getElementById("planName").value = "";
    document.getElementById("planAmount").value = "";
    document.getElementById("planDueDate").value = today;
    document.getElementById("planRemark").value = "";
  }

  modal.classList.remove("hidden");
  setTimeout(() => document.getElementById("planAmount").focus(), 100);
}

function closePlanModal() {
  document.getElementById("planModal").classList.add("hidden");
  editingPlanId = null;
}

async function submitPlan() {
  const type = document.getElementById("planType").value;
  const name = document.getElementById("planName").value.trim();
  const amount = parseFloat(document.getElementById("planAmount").value);
  const dueDate = document.getElementById("planDueDate").value;
  const remark = document.getElementById("planRemark").value.trim();

  if (!type) return showToast("请选择节点类型", "error");
  if (Number.isNaN(amount) || amount <= 0) return showToast("请输入有效的应收金额", "error");
  if (!dueDate) return showToast("请选择应收日期", "error");

  try {
    if (editingPlanId) {
      await Settlements.updatePlan(currentOrderId, editingPlanId, {
        type,
        name,
        amount,
        dueDate,
        remark
      });
      showToast("收款计划节点已更新");
    } else {
      await Settlements.addPlan(currentOrderId, {
        type,
        name,
        amount,
        dueDate,
        remark
      });
      showToast("收款计划节点已添加");
    }
    closePlanModal();
    currentSettlement = await Settlements.get(currentOrderId);
    renderSettlementDetail();
    await loadSettlementsList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function submitPayment() {
  const type = document.getElementById("paymentType").value;
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const method = document.getElementById("paymentMethod").value;
  const paymentDate = document.getElementById("paymentDate").value;
  const remark = document.getElementById("paymentRemark").value.trim();
  const planId = document.getElementById("paymentPlanId").value || null;

  if (!type) return showToast("请选择收款类型", "error");
  if (Number.isNaN(amount) || amount <= 0) return showToast("请输入有效的金额", "error");
  if (!method) return showToast("请选择支付方式", "error");

  try {
    if (editingPaymentId) {
      currentSettlement = await Settlements.updatePayment(currentOrderId, editingPaymentId, {
        type,
        amount,
        method,
        paymentDate,
        remark,
        planId
      });
      showToast("收款记录已更新");
    } else {
      currentSettlement = await Settlements.addPayment(currentOrderId, {
        type,
        amount,
        method,
        paymentDate,
        remark,
        planId
      });
      showToast("收款记录已添加");
    }
    closePaymentModal();
    renderSettlementDetail();
    await loadSettlementsList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function syncQuoteFees() {
  if (!currentSettlement?.quotationId) {
    showToast("该订单没有关联的报价单", "error");
    return;
  }
  if (!confirm("确定要从报价单同步租金、押金和优惠吗？这将覆盖或添加报价单来源的费用项。")) return;
  try {
    currentSettlement = await Settlements.syncQuote(currentOrderId);
    renderSettlementDetail();
    await loadSettlementsList();
    showToast("已同步报价单费用");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function syncHandoverFees() {
  if (!confirm("确定要同步交接赔偿费用吗？这将从归还交接记录中同步赔偿费用。")) return;
  try {
    currentSettlement = await Settlements.syncHandover(currentOrderId);
    renderSettlementDetail();
    await loadSettlementsList();
    showToast("已同步交接赔偿费用");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function printSettlement() {
  if (!currentOrderId) return;
  window.open(`/print?type=settlement&id=${encodeURIComponent(currentOrderId)}`, "_blank");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.closeFeeModal = closeFeeModal;
window.closePaymentModal = closePaymentModal;
window.closePlanModal = closePlanModal;

document.getElementById("syncQuoteBtn").onclick = syncQuoteFees;
document.getElementById("syncHandoverBtn").onclick = syncHandoverFees;
document.getElementById("addFeeBtn").onclick = () => openFeeModal();
document.getElementById("addPlanBtn").onclick = () => openPlanModal();
document.getElementById("addPlanBtnInline").onclick = () => openPlanModal();
document.getElementById("addPaymentBtn").onclick = () => openPaymentModal();
document.getElementById("printBtn").onclick = printSettlement;
document.getElementById("submitFeeBtn").onclick = submitFee;
document.getElementById("submitPaymentBtn").onclick = submitPayment;
document.getElementById("submitPlanBtn").onclick = submitPlan;
document.getElementById("reload").onclick = () => {
  loadOrders();
  if (currentOrderId) loadSettlement();
};

statusFilterEl.addEventListener("change", renderOrderList);
settlementStatusFilterEl.addEventListener("change", renderOrderList);

async function init() {
  await loadOrders();

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("id");
  if (orderId) {
    const orderExists = orders.some((o) => o.id === orderId);
    if (orderExists) {
      selectOrder(orderId);
    }
  }
}

init();
