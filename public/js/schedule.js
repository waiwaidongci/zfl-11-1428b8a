import { Schedule, Equipment, BLOCK_TYPE_LABELS } from "./api.js";

const gridEl = document.getElementById("scheduleGrid");
const statsEl = document.getElementById("stats");
const startDateInput = document.getElementById("startDateInput");
const endDateInput = document.getElementById("endDateInput");
const categoryFilter = document.getElementById("categoryFilter");
const equipmentFilter = document.getElementById("equipmentFilter");
const customerFilter = document.getElementById("customerFilter");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const resetFilterBtn = document.getElementById("resetFilterBtn");
const reloadBtn = document.getElementById("reloadBtn");
const detailTitle = document.getElementById("detailTitle");
const detailBody = document.getElementById("detailBody");
const detailGotoBtn = document.getElementById("detailGotoBtn");
const blockDetailModal = document.getElementById("blockDetailModal");
const closeDetailModal = document.getElementById("closeDetailModal");
const detailCloseBtn = document.getElementById("detailCloseBtn");

const quickRangeBtns = document.querySelectorAll("[data-range]");

let allEquipment = [];

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function initDateRange() {
  startDateInput.value = addDays(today(), -7);
  endDateInput.value = addDays(today(), 30);
}

async function loadEquipmentOptions() {
  try {
    allEquipment = await Equipment.list();
    const categories = [...new Set(allEquipment.map((e) => e.category))];
    categoryFilter.innerHTML =
      '<option value="">全部类别</option>' +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    equipmentFilter.innerHTML =
      '<option value="">全部设备</option>' +
      allEquipment
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.id)} ${escapeHtml(e.name)}</option>`)
        .join("");
  } catch (err) {
    console.error("Failed to load equipment options:", err);
  }
}

function getFilterParams() {
  const params = {};
  if (startDateInput.value) params.startDate = startDateInput.value;
  if (endDateInput.value) params.endDate = endDateInput.value;
  if (categoryFilter.value) params.category = categoryFilter.value;
  if (equipmentFilter.value) params.equipmentId = equipmentFilter.value;
  if (customerFilter.value) params.customer = customerFilter.value;
  return params;
}

function dayOfWeek(dateStr) {
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  return days[new Date(dateStr).getDay()];
}

function isToday(dateStr) {
  return dateStr === today();
}

function isWeekend(dateStr) {
  const d = new Date(dateStr).getDay();
  return d === 0 || d === 6;
}

function renderStats(data) {
  const total = data.equipment.length;
  const available = data.equipment.filter((eq) => {
    const allDaysAvailable = data.dates.every((d) => eq.dailyStatus[d]?.available);
    return allDaysAvailable;
  }).length;
  const conflictDays = data.equipment.reduce((sum, eq) => {
    let count = 0;
    for (const d of data.dates) {
      const ds = eq.dailyStatus[d];
      if (ds && ds.statuses && ds.statuses.length > 1) {
        count++;
      }
    }
    return sum + count;
  }, 0);

  const totalBlocks = data.equipment.reduce((sum, eq) => sum + eq.blocks.length, 0);

  statsEl.innerHTML = `
    <div class="stat"><span>设备总数</span><strong>${total}</strong></div>
    <div class="stat"><span>全期可租</span><strong>${available}</strong></div>
    <div class="stat"><span>占用块数</span><strong>${totalBlocks}</strong></div>
    <div class="stat"><span>冲突天数</span><strong>${conflictDays}</strong></div>
  `;
}

function renderGrid(data) {
  const { dates, equipment: equipmentList } = data;

  if (!equipmentList.length) {
    gridEl.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)">暂无匹配设备</div>';
    return;
  }

  const cellWidth = 42;
  const labelWidth = 160;
  const totalWidth = labelWidth + dates.length * cellWidth;

  let html = '<div class="gantt-container" style="min-width:' + totalWidth + 'px">';

  html += '<div class="gantt-header">';
  html += '<div class="gantt-label-header">设备</div>';
  html += '<div class="gantt-dates-header">';
  for (const d of dates) {
    const wd = dayOfWeek(d);
    const weekend = isWeekend(d) ? " weekend" : "";
    const todayCls = isToday(d) ? " today" : "";
    const shortDate = d.slice(5);
    html += `<div class="date-cell${weekend}${todayCls}" title="${d}">
      <span class="date-day">${shortDate}</span>
      <span class="date-weekday">${wd}</span>
    </div>`;
  }
  html += "</div></div>";

  html += '<div class="gantt-body">';
  for (const eq of equipmentList) {
    html += '<div class="gantt-row">';
    html += `<div class="gantt-label" title="${escapeHtml(eq.id)} ${escapeHtml(eq.name)}">
      <span class="eq-id">${escapeHtml(eq.id)}</span>
      <span class="eq-name">${escapeHtml(eq.name)}</span>
      <span class="eq-cat">${escapeHtml(eq.category)}</span>
    </div>`;

    html += '<div class="gantt-cells">';
    for (const d of dates) {
      const ds = eq.dailyStatus[d];
      const weekend = isWeekend(d) ? " weekend" : "";
      const todayCls = isToday(d) ? " today" : "";
      let cellCls = "cell" + weekend + todayCls;

      if (ds && !ds.available && ds.statuses.length > 0) {
        const primaryStatus = ds.statuses[0].blockType;
        cellCls += " cell-" + primaryStatus;
      } else {
        cellCls += " cell-available";
      }

      html += `<div class="${cellCls}" data-eq-id="${escapeHtml(eq.id)}" data-date="${d}"></div>`;
    }
    html += "</div>";

    html += '<div class="gantt-blocks">';
    for (const block of eq.blocks) {
      const startIdx = dates.indexOf(block.startDate) >= 0 ? dates.indexOf(block.startDate) : 0;
      const endIdx = dates.indexOf(block.endDate) >= 0 ? dates.indexOf(block.endDate) : dates.length - 1;
      const spanCount = endIdx - startIdx + 1;
      if (spanCount <= 0) continue;

      const left = startIdx * cellWidth;
      const width = spanCount * cellWidth - 2;
      const blockLabel = block.customer || BLOCK_TYPE_LABELS[block.blockType] || "";
      const shortLabel = width < 80 ? "" : escapeHtml(blockLabel);

      const isLocked = block.isLocked ? "1" : "0";
      const isLockExpired = block.isLockExpired ? "1" : "0";
      const lockStartAt = block.lockStartAt || "";
      const lockEndAt = block.lockEndAt || "";
      const lockRemainingMs = block.lockRemainingMs != null ? block.lockRemainingMs : "";
      const lockExpiredMs = block.lockExpiredMs != null ? block.lockExpiredMs : "";

      let lockTooltip = "";
      if (block.isLocked) {
        const days = Math.ceil(block.lockRemainingMs / (1000 * 60 * 60 * 24));
        lockTooltip = ` 🔒 报价锁定中 · 剩余约${days}天（锁定至 ${block.lockEndAt?.slice(0, 16).replace("T", " ")}）`;
      } else if (block.isLockExpired) {
        const days = Math.floor(block.lockExpiredMs / (1000 * 60 * 60 * 24));
        lockTooltip = ` 🔓 曾锁定（已过期${days}天前）`;
      }

      html += `<div class="block block-${block.blockType}" 
        style="left:${left}px;width:${width}px" 
        data-type="${block.type}" 
        data-id="${escapeHtml(block.id)}" 
        data-block-type="${block.blockType}"
        data-customer="${escapeHtml(block.customer || "")}"
        data-start="${block.startDate}" 
        data-end="${block.endDate}"
        data-note="${escapeHtml(block.note || "")}"
        data-is-locked="${isLocked}"
        data-is-lock-expired="${isLockExpired}"
        data-lock-start-at="${escapeHtml(lockStartAt)}"
        data-lock-end-at="${escapeHtml(lockEndAt)}"
        data-lock-remaining-ms="${lockRemainingMs}"
        data-lock-expired-ms="${lockExpiredMs}"
        title="${escapeHtml(block.customer || "")} ${block.startDate}~${block.endDate} ${BLOCK_TYPE_LABELS[block.blockType] || ""}${lockTooltip}">
        ${block.isLocked ? "🔒 " : block.isLockExpired ? "🔓 " : ""}${shortLabel}
      </div>`;
    }
    html += "</div>";

    html += "</div>";
  }
  html += "</div></div>";

  gridEl.innerHTML = html;

  gridEl.querySelectorAll(".block").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openBlockDetail(el);
    });
  });

  gridEl.querySelectorAll(".cell").forEach((el) => {
    el.addEventListener("click", () => {
      const eqId = el.dataset.eqId;
      const date = el.dataset.date;
      const eq = equipmentList.find((e) => e.id === eqId);
      if (!eq) return;
      const ds = eq.dailyStatus[date];
      if (ds && ds.statuses.length > 0) {
        openCellDetail(eqId, date, ds);
      }
    });
  });
}

function openBlockDetail(el) {
  const type = el.dataset.type;
  const id = el.dataset.id;
  const blockType = el.dataset.blockType;
  const customer = el.dataset.customer;
  const start = el.dataset.start;
  const end = el.dataset.end;
  const note = el.dataset.note;
  const isLocked = el.dataset.isLocked === "1";
  const isLockExpired = el.dataset.isLockExpired === "1";
  const lockStartAt = el.dataset.lockStartAt;
  const lockEndAt = el.dataset.lockEndAt;
  const lockRemainingMs = el.dataset.lockRemainingMs ? parseInt(el.dataset.lockRemainingMs, 10) : null;
  const lockExpiredMs = el.dataset.lockExpiredMs ? parseInt(el.dataset.lockExpiredMs, 10) : null;

  const typeLabels = { order: "订单", quotation: "报价单", repair: "维修工单" };
  detailTitle.textContent = (typeLabels[type] || "详情") + " " + id;

  let gotoUrl = "";
  if (type === "order") gotoUrl = `/?id=${encodeURIComponent(id)}`;
  else if (type === "quotation") gotoUrl = `/quotations?id=${encodeURIComponent(id)}`;
  else if (type === "repair") gotoUrl = `/repairs?id=${encodeURIComponent(id)}`;

  let lockHtml = "";
  if (isLocked) {
    const days = Math.floor(lockRemainingMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((lockRemainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const remainingStr = days > 0 ? `${days}天${hours}小时` : `${hours}小时`;
    lockHtml = `
      <tr><th>锁定状态</th><td><span class="block-badge block-quote_locked">🔒 报价锁定中</span></td></tr>
      <tr><th>锁定开始</th><td>${escapeHtml(lockStartAt ? lockStartAt.slice(0, 16).replace("T", " ") : "—")}</td></tr>
      <tr><th>锁定结束</th><td>${escapeHtml(lockEndAt ? lockEndAt.slice(0, 16).replace("T", " ") : "—")}</td></tr>
      <tr><th>剩余时间</th><td>约 ${remainingStr}</td></tr>
    `;
  } else if (isLockExpired) {
    const days = Math.floor(lockExpiredMs / (1000 * 60 * 60 * 24));
    lockHtml = `
      <tr><th>锁定状态</th><td><span class="block-badge block-quote_lock_expired">🔓 锁定已过期</span></td></tr>
      <tr><th>原锁定开始</th><td>${escapeHtml(lockStartAt ? lockStartAt.slice(0, 16).replace("T", " ") : "—")}</td></tr>
      <tr><th>原锁定结束</th><td>${escapeHtml(lockEndAt ? lockEndAt.slice(0, 16).replace("T", " ") : "—")}</td></tr>
      <tr><th>过期时间</th><td>${days > 0 ? `已过期 ${days} 天` : "刚刚过期"}</td></tr>
    `;
  }

  detailBody.innerHTML = `
    <table class="detail-table">
      <tr><th>类型</th><td>${typeLabels[type] || type}</td></tr>
      <tr><th>编号</th><td>${escapeHtml(id)}</td></tr>
      <tr><th>状态</th><td><span class="block-badge block-${blockType}">${BLOCK_TYPE_LABELS[blockType] || blockType}</span></td></tr>
      ${lockHtml}
      <tr><th>客户</th><td>${escapeHtml(customer)}</td></tr>
      <tr><th>起始日期</th><td>${escapeHtml(start)}</td></tr>
      <tr><th>结束日期</th><td>${escapeHtml(end)}</td></tr>
      ${note ? `<tr><th>备注</th><td>${escapeHtml(note)}</td></tr>` : ""}
    </table>
  `;

  if (gotoUrl) {
    detailGotoBtn.classList.remove("hidden");
    detailGotoBtn.onclick = () => {
      window.open(gotoUrl, "_blank");
    };
  } else {
    detailGotoBtn.classList.add("hidden");
  }

  blockDetailModal.classList.remove("hidden");
}

function openCellDetail(eqId, date, dailyStatus) {
  detailTitle.textContent = eqId + " · " + date;

  let rows = "";
  for (const s of dailyStatus.statuses) {
    const typeLabels = { order: "订单", quotation: "报价单", repair: "维修" };
    let gotoUrl = "";
    if (s.type === "order") gotoUrl = `/?id=${encodeURIComponent(s.id)}`;
    else if (s.type === "quotation") gotoUrl = `/quotations?id=${encodeURIComponent(s.id)}`;
    else if (s.type === "repair") gotoUrl = `/repairs?id=${encodeURIComponent(s.id)}`;

    let lockTag = "";
    if (s.blockType === "quote_locked") {
      lockTag = " 🔒";
    } else if (s.blockType === "quote_lock_expired") {
      lockTag = " 🔓";
    }

    rows += `<tr>
      <td>${typeLabels[s.type] || s.type}</td>
      <td>${escapeHtml(s.id)}</td>
      <td><span class="block-badge block-${s.blockType}">${BLOCK_TYPE_LABELS[s.blockType] || s.blockType}${lockTag}</span></td>
      <td>${escapeHtml(s.customer || "—")}</td>
      <td>${gotoUrl ? `<a href="${gotoUrl}" target="_blank" class="goto-link">跳转 →</a>` : "—"}</td>
    </tr>`;
  }

  const hasLockConflict = dailyStatus.statuses.some(s => s.blockType === "quote_locked");

  detailBody.innerHTML = `
    <p style="margin:0 0 12px;color:var(--muted);font-size:13px">
      设备 <strong>${escapeHtml(eqId)}</strong> 在 <strong>${escapeHtml(date)}</strong> 有 ${dailyStatus.statuses.length} 条占用记录：
      ${hasLockConflict ? '<span style="color:#92400e;margin-left:8px">⚠️ 含报价锁定</span>' : ""}
    </p>
    <table class="detail-table">
      <thead><tr><th>类型</th><th>编号</th><th>状态</th><th>客户</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  detailGotoBtn.classList.add("hidden");
  blockDetailModal.classList.remove("hidden");
}

function closeModal() {
  blockDetailModal.classList.add("hidden");
}

closeDetailModal.addEventListener("click", closeModal);
detailCloseBtn.addEventListener("click", closeModal);
blockDetailModal.addEventListener("click", (e) => {
  if (e.target === blockDetailModal) closeModal();
});

async function loadSchedule() {
  gridEl.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)">加载中…</div>';
  try {
    const params = getFilterParams();
    const data = await Schedule.get(params);
    renderStats(data);
    renderGrid(data);
  } catch (err) {
    gridEl.innerHTML = `<div style="text-align:center;padding:60px;color:var(--red)">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

applyFilterBtn.addEventListener("click", loadSchedule);

resetFilterBtn.addEventListener("click", () => {
  initDateRange();
  categoryFilter.value = "";
  equipmentFilter.value = "";
  customerFilter.value = "";
  loadSchedule();
});

reloadBtn.addEventListener("click", loadSchedule);

customerFilter.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    loadSchedule();
  }
});

for (const btn of quickRangeBtns) {
  btn.addEventListener("click", () => {
    const range = parseInt(btn.dataset.range, 10);
    startDateInput.value = today();
    endDateInput.value = addDays(today(), range);
    loadSchedule();
  });
}

initDateRange();
loadEquipmentOptions();
loadSchedule();
