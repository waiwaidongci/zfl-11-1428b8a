import { Orders } from "./api.js";

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
  const id = params.get("id");
  if (!id) {
    showError("缺少订单编号参数");
    return;
  }

  try {
    const order = await Orders.get(id);
    renderSheet(order);
  } catch (err) {
    showError(err.message);
  }
}

function showError(msg) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("error").textContent = msg;
  document.getElementById("error").classList.remove("hidden");
}

function renderSheet(o) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("sheet").classList.remove("hidden");
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
      document.querySelector(".sheet-footer").textContent = footerText;
    }
  }
}

init();
