import { Orders, Settlements } from "./api.js";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function calculateRentalDays(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffTime = Math.abs(endDate - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

async function init() {
  const params = new URLSearchParams(location.search);
  const type = params.get("type") || "handover";
  const id = params.get("id");

  if (!id) {
    showError("缺少订单编号参数");
    return;
  }

  try {
    if (type === "settlement") {
      const settlement = await Settlements.get(id);
      renderSettlementSheet(settlement);
    } else {
      const order = await Orders.get(id);
      renderHandoverSheet(order);
    }
  } catch (err) {
    showError(err.message);
  }
}

function showError(msg) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("error").textContent = msg;
  document.getElementById("error").classList.remove("hidden");
}

function renderHandoverSheet(o) {
  document.getElementById("loading").classList.add("hidden");
  const sheet = document.getElementById("handoverSheet");
  sheet.classList.remove("hidden");
  document.title = `交接单 ${o.id} - ${o.customer}`;

  document.getElementById("orderId").textContent = o.id;
  document.getElementById("customer").textContent = o.customer;
  document.getElementById("contact").textContent = o.customerContact || "—";
  document.getElementById("phone").textContent = o.customerPhone || "—";
  document.getElementById("status").textContent = o.status;
  document.getElementById("rentalPeriod").textContent = `${o.startDate} 至 ${o.endDate}`;
  document.getElementById("rentalDays").textContent = calculateRentalDays(o.startDate, o.endDate);
  document.getElementById("note").textContent = o.note || "无";

  const tbody = document.getElementById("equipBody");
  tbody.innerHTML = o.items.map((item, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td>${escapeHtml(item.id)}</td>
    <td>${escapeHtml(item.name)}</td>
    <td>${escapeHtml(item.spec || "—")}</td>
    <td></td>
  </tr>`).join("");

  if (o.handovers && o.handovers.length) {
    const checkoutHandover = o.handovers.find((h) => h.type === "checkout");
    const returnHandover = o.handovers.find((h) => h.type === "return");

    if (checkoutHandover) {
      const section = document.getElementById("checkoutSection");
      section.classList.remove("hidden");
      document.getElementById("checkoutHandler").textContent = checkoutHandover.handler || "—";
      document.getElementById("checkoutTime").textContent = checkoutHandover.actualTime || "—";
      document.getElementById("checkoutRemarks").textContent = checkoutHandover.remarks || "无";

      const checkoutTbody = document.getElementById("checkoutEquipBody");
      checkoutTbody.innerHTML = (checkoutHandover.itemConfirmations || []).map((c, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(c.itemId)}</td>
        <td>${escapeHtml(c.itemName || "")}</td>
        <td>${c.confirmed ? "✅ 已确认" : "❌ 未确认"}</td>
        <td>${escapeHtml(c.remark || "—")}</td>
      </tr>`).join("");
    }

    if (returnHandover) {
      const section = document.getElementById("returnSection");
      section.classList.remove("hidden");
      document.getElementById("returnHandler").textContent = returnHandover.handler || "—";
      document.getElementById("returnTime").textContent = returnHandover.actualTime || "—";
      document.getElementById("returnCompensation").textContent = returnHandover.compensationNote || "无";
      document.getElementById("returnExtraCharges").textContent = returnHandover.extraCharges ? `¥${Number(returnHandover.extraCharges).toFixed(2)}` : "无";
      document.getElementById("returnRemarks").textContent = returnHandover.remarks || "无";

      const returnTbody = document.getElementById("returnEquipBody");
      returnTbody.innerHTML = (returnHandover.itemStatuses || []).map((s, i) => {
        const statusLabel = { intact: "完好", damaged: "损坏", missing: "缺失" }[s.status] || s.status;
        const statusClass = { intact: "status-intact", damaged: "status-damaged", missing: "status-missing" }[s.status] || "";
        return `<tr>
          <td class="center">${i + 1}</td>
          <td>${escapeHtml(s.itemId)}</td>
          <td>${escapeHtml(s.itemName || "")}</td>
          <td class="${statusClass}">${statusLabel}</td>
          <td>${escapeHtml(s.remark || "—")}</td>
        </tr>`;
      }).join("");

      document.getElementById("returnSignArea").classList.remove("hidden");
    }

    if (checkoutHandover || returnHandover) {
      let footerText = "本单一式两份，出库方与签收方各执一份。";
      if (returnHandover) {
        footerText = "本交接单含出库与归还记录，一式两份，双方各执一份。";
      }
      document.querySelector("#handoverSheet .sheet-footer").textContent = footerText;
    }
  }
}

function renderSettlementSheet(s) {
  document.getElementById("loading").classList.add("hidden");
  const sheet = document.getElementById("settlementSheet");
  sheet.classList.remove("hidden");
  document.title = `结算单 ${s.order.id} - ${s.order.customer}`;

  const o = s.order;
  const sum = s.summary;

  document.getElementById("settlementId").textContent = s.id || "未生成";
  document.getElementById("settlementStatus").textContent = s.statusLabel;

  document.getElementById("settlementCustomer").textContent = o.customer;
  document.getElementById("settlementContact").textContent = o.customerContact || "—";
  document.getElementById("settlementPhone").textContent = o.customerPhone || "—";
  document.getElementById("settlementOrderId").textContent = o.id;
  document.getElementById("settlementStartDate").textContent = o.startDate;
  document.getElementById("settlementEndDate").textContent = o.endDate;

  const feeTableBody = document.getElementById("feeTableBody");
  const displayFees = (s.fees || []).filter((f) => f.type !== "deposit");
  if (displayFees.length === 0) {
    feeTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">暂无费用项</td></tr>`;
  } else {
    feeTableBody.innerHTML = displayFees.map((f, i) => {
      const isDiscount = f.type === "discount";
      return `<tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(f.typeLabel)}</td>
        <td>${escapeHtml(f.description || "无")}</td>
        <td class="${isDiscount ? "status-discount" : ""}">${isDiscount ? "-" : ""}¥${Number(f.amount).toFixed(2)}</td>
      </tr>`;
    }).join("");
  }

  document.getElementById("receivableTotal").textContent = `¥${sum.receivableTotal.toFixed(2)}`;

  document.getElementById("depositFee").textContent = `¥${sum.depositFee.toFixed(2)}`;
  document.getElementById("depositDeducted").textContent = `¥${sum.depositDeducted.toFixed(2)}`;
  document.getElementById("depositReturned").textContent = `¥${sum.depositReturned.toFixed(2)}`;
  document.getElementById("remainingDeposit").textContent = `¥${sum.remainingDeposit.toFixed(2)}`;

  const paymentTableBody = document.getElementById("paymentTableBody");
  const payments = s.payments || [];
  if (payments.length === 0) {
    paymentTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">暂无收款记录</td></tr>`;
  } else {
    paymentTableBody.innerHTML = payments.map((p, i) => `<tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(p.paymentDate || "")}</td>
      <td>${escapeHtml(p.typeLabel || p.type)}</td>
      <td>${escapeHtml(p.methodLabel || p.method)}</td>
      <td class="${p.type === "deposit_return" ? "status-discount" : ""}">${p.type === "deposit_return" ? "-" : "+"}¥${Number(p.amount).toFixed(2)}</td>
      <td>${escapeHtml(p.remark || "—")}</td>
    </tr>`).join("");
  }

  document.getElementById("totalPaid").textContent = `¥${sum.totalPaid.toFixed(2)}`;

  document.getElementById("sumReceivable").textContent = `¥${sum.receivableTotal.toFixed(2)}`;
  document.getElementById("sumPaid").textContent = `¥${sum.totalPaid.toFixed(2)}`;
  document.getElementById("sumBalance").textContent = `¥${sum.balanceDue.toFixed(2)}`;

  document.getElementById("settlementNote").textContent = s.note || "无";
}

init();
