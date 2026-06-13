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
  document.title = `出库单 ${o.id} - ${o.customer}`;

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
}

init();
