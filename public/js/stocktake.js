import { Stocktakes, Equipment, AuditLogs, showToast, STOCKTAKE_STATUS_LABELS, STOCKTAKE_RESULT_LABELS } from "./api.js";

const state = {
  list: [],
  equipmentList: [],
  currentStocktake: null,
  currentItem: null,
  filters: {
    search: "",
    status: ""
  },
  detailFilters: {
    result: ""
  },
  view: "list",
  detailMode: "table",
  quickLogs: [],
  quickLogCounter: 0
};

const $ = (id) => document.getElementById(id);
const grid = $("stocktakeGrid");
const statsEl = $("stats");
const countInfo = $("countInfo");
const statusFilter = $("statusFilter");
const searchEl = $("search");

const listView = $("listView");
const detailView = $("detailView");
const detailStats = $("detailStats");
const detailItems = $("detailItems");
const detailCountInfo = $("detailCountInfo");
const resultFilter = $("resultFilter");

const tableViewPanel = $("tableViewPanel");
const quickViewPanel = $("quickViewPanel");
const quickScanInput = $("quickScanInput");
const quickActualLocation = $("quickActualLocation");
const quickLocationField = $("quickLocationField");
const quickProgressBar = $("quickProgressBar");
const quickProgressText = $("quickProgressText");
const quickCountInfo = $("quickCountInfo");
const qsNormal = $("qsNormal");
const qsDamaged = $("qsDamaged");
const qsMissing = $("qsMissing");
const qsMismatch = $("qsMismatch");
const qsUnmarked = $("qsUnmarked");
const quickLogList = $("quickLogList");

const createModal = $("createModal");
const createForm = $("createForm");
const categorySelect = $("categorySelect");

const resultModal = $("resultModal");
const resultForm = $("resultForm");

const damagedModal = $("damagedModal");
const damagedForm = $("damagedForm");

const diffReportModal = $("diffReportModal");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCss(str) {
  return String(str || "").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
}

function formatDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return "-";
  }
}

function formatDateTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return "-";
  }
}

async function renderAuditHistory(containerId, { objectType, objectId, onRefresh }) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = `<div class="audit-empty">加载中...</div>`;

  try {
    const allLogs = await AuditLogs.list({ objectType, limit: 50 });
    const logs = allLogs.filter((log) => log.objectId && log.objectId.startsWith(`${objectId}:`));

    if (!logs.length) {
      container.innerHTML = `<div class="audit-empty">暂无操作记录</div>`;
      return;
    }

    container.innerHTML = logs
      .map((log) => {
        const canRevert = log.reversible && !log.reverted;
        return `
        <div class="audit-item" data-log-id="${escapeHtml(log.id)}">
          <div class="audit-dot"></div>
          <div class="audit-content">
            <div class="audit-head">
              <div>
                <span class="audit-action">${escapeHtml(log.actionLabel || log.action || "操作")}</span>
                ${log.objectId ? `<span class="audit-object">${escapeHtml(log.objectId)}</span>` : ""}
              </div>
              <span class="audit-time">${formatDateTime(log.createdAt)}</span>
            </div>
            ${log.summary ? `<div class="audit-summary">${escapeHtml(log.summary)}</div>` : ""}
            ${log.detail ? `<div class="audit-detail">${escapeHtml(log.detail)}</div>` : ""}
            ${log.reverted ? `<div class="audit-reverted">已撤销</div>` : ""}
            ${canRevert ? `<div class="audit-revert"><button class="ghost small revert-btn" data-log-id="${escapeHtml(log.id)}">撤销</button></div>` : ""}
          </div>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll(".revert-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const logId = btn.dataset.logId;
        if (!confirm("确定撤销此操作吗？")) return;
        try {
          await AuditLogs.revert(logId);
          showToast("操作已撤销");
          if (onRefresh) onRefresh();
          renderAuditHistory(containerId, { objectType, objectId, onRefresh });
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="audit-empty" style="color:var(--red)">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderStats() {
  const total = state.list.length;
  const processing = state.list.filter((s) => s.status === "processing").length;
  const completed = state.list.filter((s) => s.status === "completed").length;
  const pendingDiff = state.list.reduce((sum, s) => sum + (s.stats?.pending || 0), 0);

  statsEl.innerHTML = `
    <div class="stat"><span>盘点任务总数</span><strong>${total}</strong></div>
    <div class="stat"><span>进行中</span><strong style="color:var(--blue)">${processing}</strong></div>
    <div class="stat"><span>已完成</span><strong style="color:var(--green)">${completed}</strong></div>
    <div class="stat"><span>待处理差异</span><strong style="color:var(--red)">${pendingDiff}</strong></div>
  `;
}

function renderCategoryOptions() {
  const categories = [...new Set(state.equipmentList.map((e) => e.category))].filter(Boolean);
  categorySelect.innerHTML =
    '<option value="">全部设备</option>' +
    categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
}

function getFiltered() {
  const q = state.filters.search.trim().toLowerCase();
  return state.list.filter((s) => {
    if (state.filters.status && s.status !== state.filters.status) return false;
    if (q) {
      const hay = `${s.id} ${s.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function getResultBadge(result, processed) {
  if (!result) return '<span class="badge result-unmarked">未盘点</span>';
  const cls = processed ? `result-${result} processed` : `result-${result}`;
  const icon = { normal: "✓", missing: "?", damaged: "⚠", mismatch: "📍" }[result] || "";
  return `<span class="badge ${cls}">${icon} ${STOCKTAKE_RESULT_LABELS[result] || result}${processed ? " · 已处理" : ""}</span>`;
}

function renderList() {
  const data = getFiltered();
  countInfo.textContent = `显示 ${data.length} / 共 ${state.list.length} 条`;

  if (!data.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h4>暂无盘点任务</h4>
        <p>点击右上角"新建盘点"开始第一次库存盘点</p>
      </div>`;
    return;
  }

  grid.innerHTML = data
    .map((s) => {
      const stats = s.stats || { total: 0, normal: 0, missing: 0, damaged: 0, mismatch: 0, pending: 0 };
      const progress = stats.total > 0 ? Math.round(((stats.total - (s.items?.filter((i) => !i.result).length || 0)) / stats.total) * 100) : 0;

      return `
    <article class="stocktake-card status-${s.status}" data-id="${s.id}">
      <div class="stocktake-head">
        <div>
          <h4>${escapeHtml(s.name)}</h4>
          <div style="margin-top:6px">
            ${s.category ? `<span class="cat-pill cat-${escapeCss(s.category)}">${escapeHtml(s.category)}</span>` : '<span class="cat-pill cat-其他">全量盘点</span>'}
          </div>
        </div>
        <span class="stocktake-id">${escapeHtml(s.id)}</span>
      </div>

      <div class="stocktake-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <span class="progress-text">${progress}% 完成</span>
      </div>

      <div class="stocktake-stats">
        <div class="stocktake-stat"><span class="stat-label">总计</span><strong>${stats.total}</strong></div>
        <div class="stocktake-stat"><span class="stat-label normal">正常</span><strong>${stats.normal}</strong></div>
        <div class="stocktake-stat"><span class="stat-label missing">丢失</span><strong>${stats.missing}</strong></div>
        <div class="stocktake-stat"><span class="stat-label damaged">损坏</span><strong>${stats.damaged}</strong></div>
        <div class="stocktake-stat"><span class="stat-label mismatch">位置</span><strong>${stats.mismatch}</strong></div>
        ${stats.pending > 0 ? `<div class="stocktake-stat"><span class="stat-label pending">待处理</span><strong style="color:var(--red)">${stats.pending}</strong></div>` : ""}
      </div>

      <div class="stocktake-meta">
        <div>创建时间：${formatDate(s.createdAt)}</div>
        ${s.completedAt ? `<div>完成时间：${formatDate(s.completedAt)}</div>` : ""}
      </div>

      ${s.note ? `<div class="stocktake-note">${escapeHtml(s.note)}</div>` : ""}

      <div class="stocktake-foot">
        <span class="status-badge ${s.status}">${STOCKTAKE_STATUS_LABELS[s.status] || s.status}</span>
        <div class="stocktake-actions">
          <button class="secondary small" data-action="view">查看详情</button>
          ${s.status === "processing" ? `<button class="small" data-action="submit">提交盘点</button>` : ""}
          ${s.status === "processing" ? `<button class="ghost small" data-action="cancel">取消</button>` : ""}
          ${s.status !== "processing" ? `<button class="danger small" data-action="delete">删除</button>` : ""}
          ${s.status === "completed" && stats.pending > 0 ? `<button class="danger small" data-action="diff">处理差异</button>` : ""}
        </div>
      </div>
    </article>
  `;
    })
    .join("");

  grid.querySelectorAll(".stocktake-card").forEach((card) => {
    const id = card.dataset.id;
    const viewBtn = card.querySelector('[data-action="view"]');
    const submitBtn = card.querySelector('[data-action="submit"]');
    const cancelBtn = card.querySelector('[data-action="cancel"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    const diffBtn = card.querySelector('[data-action="diff"]');

    if (viewBtn) viewBtn.addEventListener("click", () => openDetail(id));
    if (submitBtn) submitBtn.addEventListener("click", () => submitStocktake(id));
    if (cancelBtn) cancelBtn.addEventListener("click", () => cancelStocktake(id));
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteStocktake(id));
    if (diffBtn) diffBtn.addEventListener("click", () => showDiffReport(id));
  });
}

function renderDetailStats() {
  const s = state.currentStocktake;
  if (!s) return;
  const stats = s.stats || { total: 0, normal: 0, missing: 0, damaged: 0, mismatch: 0, pending: 0 };

  detailStats.innerHTML = `
    <div class="stat"><span>设备总数</span><strong>${stats.total}</strong></div>
    <div class="stat"><span>正常</span><strong style="color:var(--green)">${stats.normal}</strong></div>
    <div class="stat"><span>丢失</span><strong style="color:var(--red)">${stats.missing}</strong></div>
    <div class="stat"><span>损坏</span><strong style="color:var(--yellow)">${stats.damaged}</strong></div>
    <div class="stat"><span>位置不符</span><strong style="color:var(--blue)">${stats.mismatch}</strong></div>
    <div class="stat"><span>待处理差异</span><strong style="color:var(--red)">${stats.pending}</strong></div>
  `;
}

function getFilteredDetailItems() {
  const items = state.currentStocktake?.items || [];
  const f = state.detailFilters.result;

  return items.filter((item) => {
    if (!f) return true;
    if (f === "unmarked") return !item.result;
    if (f === "pending") return item.result && item.result !== "normal" && !item.processed;
    if (f === "processed") return item.processed;
    return item.result === f;
  });
}

function renderDetail() {
  const s = state.currentStocktake;
  if (!s) return;

  $("detailName").textContent = s.name;
  $("detailStatusBadge").textContent = s.statusLabel;
  $("detailStatusBadge").className = `badge status-${s.status}`;

  const metaHtml = [
    `编号：${s.id}`,
    `范围：${s.category || "全部设备"}`,
    `创建时间：${formatDate(s.createdAt)}`
  ];
  if (s.completedAt) metaHtml.push(`完成时间：${formatDate(s.completedAt)}`);
  if (s.note) metaHtml.push(`备注：${escapeHtml(s.note)}`);

  $("detailMeta").innerHTML = metaHtml.map((m) => `<span>${m}</span>`).join("");

  const actionsHtml = [];
  if (s.status === "processing") {
    actionsHtml.push(`<button class="small" id="submitDetailBtn">提交盘点</button>`);
    actionsHtml.push(`<button class="ghost small" id="cancelDetailBtn">取消盘点</button>`);
  }
  if (s.status === "completed" && s.stats?.pending > 0) {
    actionsHtml.push(`<button class="danger small" id="diffDetailBtn">处理差异报告</button>`);
  }
  $("detailActions").innerHTML = actionsHtml.join("");

  const submitDetailBtn = $("submitDetailBtn");
  const cancelDetailBtn = $("cancelDetailBtn");
  const diffDetailBtn = $("diffDetailBtn");
  if (submitDetailBtn) submitDetailBtn.addEventListener("click", () => submitStocktake(s.id));
  if (cancelDetailBtn) cancelDetailBtn.addEventListener("click", () => cancelStocktake(s.id));
  if (diffDetailBtn) diffDetailBtn.addEventListener("click", () => showDiffReport(s.id));

  renderDetailStats();

  const items = getFilteredDetailItems();
  detailCountInfo.textContent = `显示 ${items.length} / 共 ${s.items.length} 台`;

  if (!items.length) {
    detailItems.innerHTML = `
      <div class="empty-state">
        <h4>暂无匹配设备</h4>
        <p>试试调整筛选条件</p>
      </div>`;
    return;
  }

  detailItems.innerHTML = items
    .map((item, index) => {
      const eq = item.equipment || {};
      const canEdit = s.status === "processing";
      const canProcess = s.status === "completed";
      const isDiffItem = item.result && item.result !== "normal";
      const condLabel = { available: "在库可用", repair: "维修中", rented: "租赁中", missing: "已丢失" }[eq.condition] || eq.condition;

      return `
    <div class="stocktake-item ${item.result ? `result-${item.result}` : ""} ${item.processed ? "processed" : ""}" data-id="${item.equipmentId}">
      <div class="item-index">${index + 1}</div>
      <div class="item-main">
        <div class="item-head">
          <h5>${escapeHtml(item.equipmentName)}</h5>
          <span class="item-id">${escapeHtml(item.equipmentId)}</span>
        </div>
        <div class="item-meta">
          <span class="cat-pill cat-${escapeCss(item.category)}">${escapeHtml(item.category)}</span>
          <span class="meta">${escapeHtml(item.spec || "-")}</span>
          ${eq.condition && eq.condition !== "available" ? `<span class="meta cond-${eq.condition}">【${condLabel}】</span>` : ""}
        </div>
        <div class="item-locations">
          <div class="loc-row">
            <span class="loc-label">系统位置：</span>
            <span class="loc-value">${escapeHtml(item.expectedLocation || "未指定")}</span>
          </div>
          ${item.actualLocation ? `
          <div class="loc-row">
            <span class="loc-label">实际位置：</span>
            <span class="loc-value actual">${escapeHtml(item.actualLocation)}</span>
          </div>` : ""}
        </div>
        ${item.remark ? `<div class="item-remark">备注：${escapeHtml(item.remark)}</div>` : ""}
      </div>
      <div class="item-result">
        ${getResultBadge(item.result, item.processed)}
        ${item.linkedRepairId ? `<div class="linked-repair">关联工单：<a href="/repairs?id=${item.linkedRepairId}" target="_blank">${item.linkedRepairId}</a></div>` : ""}
      </div>
      <div class="item-actions">
        ${canEdit ? `<button class="secondary small" data-action="edit">记录结果</button>` : ""}
        ${canEdit && isDiffItem && !item.processed ? `<button class="process-btn" data-action="mark-processed">标记已处理</button>` : ""}
        ${canProcess && item.result === "damaged" && !item.processed ? `<button class="danger small" data-action="repair">转维修</button>` : ""}
        ${canProcess && item.result === "missing" && !item.processed ? `<button class="danger small" data-action="missing">冻结库存</button>` : ""}
        ${canProcess && item.result === "mismatch" && !item.processed ? `<button class="secondary small" data-action="mismatch">回写位置</button>` : ""}
      </div>
    </div>
  `;
    })
    .join("");

  detailItems.querySelectorAll(".stocktake-item").forEach((itemEl) => {
    const equipmentId = itemEl.dataset.id;
    const editBtn = itemEl.querySelector('[data-action="edit"]');
    const markProcessedBtn = itemEl.querySelector('[data-action="mark-processed"]');
    const repairBtn = itemEl.querySelector('[data-action="repair"]');
    const missingBtn = itemEl.querySelector('[data-action="missing"]');
    const mismatchBtn = itemEl.querySelector('[data-action="mismatch"]');

    if (editBtn) editBtn.addEventListener("click", () => openResultModal(equipmentId));
    if (markProcessedBtn) markProcessedBtn.addEventListener("click", () => markItemProcessed(equipmentId));
    if (repairBtn) repairBtn.addEventListener("click", () => openDamagedModal(equipmentId));
    if (missingBtn) missingBtn.addEventListener("click", () => processMissing(equipmentId));
    if (mismatchBtn) mismatchBtn.addEventListener("click", () => processMismatch(equipmentId));
  });

  renderQuickStats();
}

function renderQuickStats() {
  const s = state.currentStocktake;
  if (!s) return;
  const stats = s.stats || { total: 0, normal: 0, missing: 0, damaged: 0, mismatch: 0, pending: 0 };
  const total = stats.total;
  const done = stats.normal + stats.missing + stats.damaged + stats.mismatch;
  const unmarked = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  quickProgressBar.style.width = `${pct}%`;
  quickProgressText.textContent = `${done} / ${total} (${pct}%)`;
  quickCountInfo.textContent = `已完成 ${done} / 共 ${total} 台`;

  qsNormal.textContent = stats.normal;
  qsDamaged.textContent = stats.damaged;
  qsMissing.textContent = stats.missing;
  qsMismatch.textContent = stats.mismatch;
  qsUnmarked.textContent = unmarked;
}

function scrollToItem(equipmentId) {
  switchDetailMode("table");
  setTimeout(() => {
    const itemEl = detailItems.querySelector(`.stocktake-item[data-id="${CSS.escape(equipmentId)}"]`);
    if (itemEl) {
      itemEl.scrollIntoView({ behavior: "smooth", block: "center" });
      itemEl.classList.add("flash-highlight");
      setTimeout(() => itemEl.classList.remove("flash-highlight"), 2500);
    }
  }, 150);
}

function renderQuickLogs() {
  if (state.quickLogs.length === 0) {
    quickLogList.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:13px">
        <div style="font-size:36px;margin-bottom:10px">📋</div>
        开始扫描设备编号，扫码记录将显示在此处
      </div>`;
    return;
  }

  quickLogList.innerHTML = state.quickLogs
    .map((log) => {
      const badge = log.success
        ? getResultBadge(log.result, log.result === "normal")
        : `<span class="badge result-unmarked" style="background:#fde1dd;color:var(--red)">✗ ${log.errorTitle}</span>`;

      const msgCls = log.success
        ? (log.isDuplicate ? "warn" : "")
        : "error";
      const msgText = log.success
        ? (log.isDuplicate ? `重复扫码，已覆盖原结果「${log.previousResultLabel}」` : "")
        : log.message;

      const rowCls = log.success ? (log.isDuplicate ? "highlight" : "") : "";
      const locateBtn = log.success && log.result
        ? `<button class="ql-locate-btn" data-equipment-id="${escapeHtml(log.equipmentId)}" title="定位到表格">🎯</button>`
        : "";

      return `
        <div class="quick-log-item ${rowCls}">
          <div class="ql-index">${log.idx}</div>
          <div class="ql-main">
            <div class="ql-head">
              <span class="ql-name">${escapeHtml(log.name)}</span>
              <span class="ql-id">${escapeHtml(log.equipmentId)}</span>
            </div>
            <div class="ql-sub">
              ${log.category ? `<span class="ql-cat cat-${escapeCss(log.category)}">${escapeHtml(log.category)}</span>` : ""}
              ${log.location ? `<span>预期位置: ${escapeHtml(log.location)}</span>` : ""}
            </div>
            ${msgText ? `<div class="ql-msg ${msgCls}">${escapeHtml(msgText)}</div>` : ""}
          </div>
          <div class="ql-badge">${badge}</div>
          <div class="ql-actions">${locateBtn}</div>
        </div>
      `;
    })
    .join("");

  quickLogList.querySelectorAll(".ql-locate-btn").forEach((btn) => {
    btn.addEventListener("click", () => scrollToItem(btn.dataset.equipmentId));
  });

  quickLogList.scrollTop = 0;
}

function addQuickLog(log) {
  state.quickLogCounter++;
  state.quickLogs.unshift({
    idx: state.quickLogCounter,
    time: new Date().toISOString(),
    ...log
  });
  if (state.quickLogs.length > 100) {
    state.quickLogs.pop();
  }
  renderQuickLogs();
}

function openDetail(id) {
  const s = state.list.find((x) => x.id === id);
  if (!s) return;
  state.currentStocktake = s;
  state.detailFilters.result = "";
  resultFilter.value = "";
  state.quickLogs = [];
  state.quickLogCounter = 0;
  state.detailMode = "table";
  listView.classList.add("hidden");
  detailView.classList.remove("hidden");
  state.view = "detail";
  updateViewSwitch();
  renderDetail();
  renderQuickLogs();
  refreshStocktakeAudit();
}

function refreshStocktakeAudit() {
  if (!state.currentStocktake) return;
  renderAuditHistory("stocktakeAuditHistory", {
    objectType: "stocktake_item",
    objectId: state.currentStocktake.id,
    onRefresh: async () => {
      const updated = await Stocktakes.get(state.currentStocktake.id);
      state.currentStocktake = updated;
      const listIdx = state.list.findIndex((x) => x.id === state.currentStocktake.id);
      if (listIdx !== -1) state.list[listIdx] = updated;
      renderStats();
      renderList();
      renderDetail();
    }
  });
}

function backToList() {
  state.currentStocktake = null;
  state.view = "list";
  detailView.classList.add("hidden");
  listView.classList.remove("hidden");
  load();
}

function updateViewSwitch() {
  document.querySelectorAll(".view-switch-btn").forEach((btn) => {
    const v = btn.dataset.view;
    btn.classList.toggle("active", v === state.detailMode);
  });
  tableViewPanel.classList.toggle("hidden", state.detailMode !== "table");
  quickViewPanel.classList.toggle("hidden", state.detailMode !== "quick");
  if (state.detailMode === "quick") {
    setTimeout(() => quickScanInput?.focus(), 100);
  }
}

function switchDetailMode(mode) {
  if (!["table", "quick"].includes(mode)) return;
  state.detailMode = mode;
  updateViewSwitch();
}

function openCreateModal() {
  createForm.reset();
  renderCategoryOptions();
  createModal.classList.remove("hidden");
  setTimeout(() => createForm.name?.focus(), 50);
}

function closeCreateModal() {
  createModal.classList.add("hidden");
}

async function submitCreate() {
  const data = Object.fromEntries(new FormData(createForm).entries());
  data.name = data.name?.trim();

  if (!data.name) {
    showToast("请填写盘点任务名称", "error");
    return;
  }

  try {
    const created = await Stocktakes.create(data);
    state.list.unshift(created);
    showToast(`盘点任务「${created.name}」已创建`);
    closeCreateModal();
    renderStats();
    renderList();
    openDetail(created.id);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openResultModal(equipmentId) {
  const item = state.currentStocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return;
  state.currentItem = item;

  $("resultModalTitle").textContent = `记录盘点结果 - ${item.equipmentName}`;
  $("resultEqName").textContent = item.equipmentName;
  $("resultEqId").textContent = `(${item.equipmentId})`;
  $("resultEqSpec").textContent = item.spec || "-";
  $("resultEqLocation").textContent = item.expectedLocation || "未指定";

  resultForm.reset();
  resultForm.equipmentId.value = equipmentId;
  if (item.result) {
    const radio = resultForm.querySelector(`input[name="result"][value="${item.result}"]`);
    if (radio) radio.checked = true;
  }
  resultForm.actualLocation.value = item.actualLocation || "";
  resultForm.remark.value = item.remark || "";

  toggleActualLocationField();
  resultModal.classList.remove("hidden");
  setTimeout(() => {
    const firstRadio = resultForm.querySelector('input[name="result"]');
    if (firstRadio) firstRadio.focus();
  }, 50);
}

function closeResultModal() {
  resultModal.classList.add("hidden");
  state.currentItem = null;
}

function toggleActualLocationField() {
  const result = resultForm.querySelector('input[name="result"]:checked')?.value;
  const field = $("actualLocationField");
  if (result === "mismatch") {
    field.classList.remove("hidden");
    field.querySelector("input").required = true;
  } else {
    field.classList.add("hidden");
    field.querySelector("input").required = false;
  }
}

async function submitResult() {
  const data = Object.fromEntries(new FormData(resultForm).entries());
  const equipmentId = data.equipmentId;

  if (!data.result) {
    showToast("请选择盘点结果", "error");
    return;
  }
  if (data.result === "mismatch" && !data.actualLocation?.trim()) {
    showToast("请填写实际存放位置", "error");
    return;
  }

  try {
    const updateData = {
      items: [{
        equipmentId,
        result: data.result,
        actualLocation: data.actualLocation?.trim() || "",
        remark: data.remark?.trim() || ""
      }]
    };

    const updated = await Stocktakes.update(state.currentStocktake.id, updateData);
    state.currentStocktake = updated;
    const listIdx = state.list.findIndex((x) => x.id === updated.id);
    if (listIdx !== -1) state.list[listIdx] = updated;

    showToast("盘点结果已保存");
    closeResultModal();
    renderStats();
    renderList();
    renderDetail();
    refreshStocktakeAudit();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openDamagedModal(equipmentId) {
  const item = state.currentStocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return;
  state.currentItem = item;

  $("damagedEqName").textContent = item.equipmentName;
  $("damagedEqId").textContent = `(${item.equipmentId})`;
  $("damagedRemark").textContent = item.remark ? `盘点备注：${item.remark}` : "";

  damagedForm.reset();
  damagedForm.faultDescription.value = item.remark || "盘点时发现损坏";
  damagedForm.sendTime.value = new Date().toISOString().slice(0, 10);

  damagedModal.classList.remove("hidden");
  setTimeout(() => damagedForm.faultDescription?.focus(), 50);
}

function closeDamagedModal() {
  damagedModal.classList.add("hidden");
  state.currentItem = null;
}

async function submitDamaged() {
  const data = Object.fromEntries(new FormData(damagedForm).entries());
  data.faultDescription = data.faultDescription?.trim();

  if (!data.faultDescription) {
    showToast("请填写故障描述", "error");
    return;
  }
  if (data.repairCost !== "") {
    data.repairCost = Number(data.repairCost);
  }

  try {
    const result = await Stocktakes.processDamaged(
      state.currentStocktake.id,
      state.currentItem.equipmentId,
      data
    );

    state.currentStocktake = result.stocktake;
    const listIdx = state.list.findIndex((x) => x.id === result.stocktake.id);
    if (listIdx !== -1) state.list[listIdx] = result.stocktake;

    const eqIdx = state.equipmentList.findIndex((e) => e.id === state.currentItem.equipmentId);
    if (eqIdx !== -1) state.equipmentList[eqIdx].condition = "repair";

    showToast(`维修工单「${result.repair.id}」已创建，设备已标记为维修中`);
    closeDamagedModal();
    renderStats();
    renderList();
    renderDetail();
    refreshStocktakeAudit();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function processMissing(equipmentId) {
  const item = state.currentStocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return;

  if (!confirm(`确定将「${item.equipmentName} (${equipmentId})」标记为丢失并从可租库存中冻结吗？`)) return;

  try {
    const updated = await Stocktakes.processMissing(state.currentStocktake.id, equipmentId);
    state.currentStocktake = updated;
    const listIdx = state.list.findIndex((x) => x.id === updated.id);
    if (listIdx !== -1) state.list[listIdx] = updated;

    const eqIdx = state.equipmentList.findIndex((e) => e.id === equipmentId);
    if (eqIdx !== -1) state.equipmentList[eqIdx].condition = "missing";

    showToast("设备已标记为丢失，已从可租库存中冻结");
    renderStats();
    renderList();
    renderDetail();
    refreshStocktakeAudit();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function processMismatch(equipmentId) {
  const item = state.currentStocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return;

  if (!confirm(`确定将「${item.equipmentName} (${equipmentId})」的位置更新为「${item.actualLocation}」吗？`)) return;

  try {
    const updated = await Stocktakes.processMismatch(state.currentStocktake.id, equipmentId);
    state.currentStocktake = updated;
    const listIdx = state.list.findIndex((x) => x.id === updated.id);
    if (listIdx !== -1) state.list[listIdx] = updated;

    const eqIdx = state.equipmentList.findIndex((e) => e.id === equipmentId);
    if (eqIdx !== -1) state.equipmentList[eqIdx].location = item.actualLocation;

    showToast("设备位置已更新");
    renderStats();
    renderList();
    renderDetail();
    refreshStocktakeAudit();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function markItemProcessed(equipmentId) {
  const item = state.currentStocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return;

  const resultLabel = {
    damaged: "损坏",
    missing: "丢失",
    mismatch: "库位不符"
  }[item.result] || item.result;

  if (!confirm(`确定将「${item.equipmentName} (${equipmentId})」的「${resultLabel}」差异标记为已处理吗？标记后无法再次扫码修改。`)) return;

  try {
    const updated = await Stocktakes.markProcessed(state.currentStocktake.id, equipmentId);
    state.currentStocktake = updated;
    const listIdx = state.list.findIndex((x) => x.id === updated.id);
    if (listIdx !== -1) state.list[listIdx] = updated;

    showToast("差异已标记为已处理");
    renderStats();
    renderList();
    renderDetail();
    refreshStocktakeAudit();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function submitStocktake(id) {
  if (!confirm("确定提交本次盘点吗？提交后将生成差异报告，且无法再修改盘点结果。")) return;

  try {
    const updated = await Stocktakes.submit(id);
    const idx = state.list.findIndex((x) => x.id === id);
    if (idx !== -1) state.list[idx] = updated;
    if (state.currentStocktake?.id === id) state.currentStocktake = updated;

    showToast("盘点已提交，差异报告已生成");
    renderStats();
    renderList();
    if (state.view === "detail") {
      renderDetail();
      refreshStocktakeAudit();
    }
    if (updated.stats?.pending > 0) {
      setTimeout(() => showDiffReport(id), 500);
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function cancelStocktake(id) {
  const s = state.list.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`确定取消盘点任务「${s.name}」吗？`)) return;

  try {
    const updated = await Stocktakes.cancel(id);
    const idx = state.list.findIndex((x) => x.id === id);
    if (idx !== -1) state.list[idx] = updated;
    if (state.currentStocktake?.id === id) state.currentStocktake = updated;

    showToast("盘点任务已取消");
    renderStats();
    renderList();
    if (state.view === "detail") {
      renderDetail();
      refreshStocktakeAudit();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function deleteStocktake(id) {
  const s = state.list.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`确定删除盘点任务「${s.name}」吗？此操作不可恢复。`)) return;

  try {
    await Stocktakes.remove(id);
    state.list = state.list.filter((x) => x.id !== id);
    showToast("盘点任务已删除");
    renderStats();
    renderList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function showDiffReport(id) {
  const s = state.list.find((x) => x.id === id) || state.currentStocktake;
  if (!s) return;

  const diffItems = s.items.filter((i) => i.result && i.result !== "normal");

  if (diffItems.length === 0) {
    showToast("本次盘点无差异，所有设备正常", "success");
    return;
  }

  const damagedItems = diffItems.filter((i) => i.result === "damaged");
  const missingItems = diffItems.filter((i) => i.result === "missing");
  const mismatchItems = diffItems.filter((i) => i.result === "mismatch");

  const renderItemRow = (item) => `
    <tr>
      <td>${escapeHtml(item.equipmentId)}</td>
      <td>${escapeHtml(item.equipmentName)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${getResultBadge(item.result, item.processed)}</td>
      <td>${escapeHtml(item.remark || "-")}</td>
      <td>
        ${item.processed ? '<span class="meta">已处理</span>' : '<span style="color:var(--red)">待处理</span>'}
      </td>
    </tr>
  `;

  $("diffReportBody").innerHTML = `
    <div class="diff-summary">
      <h4>盘点差异汇总</h4>
      <div class="diff-stats">
        <div class="diff-stat">
          <span class="diff-label">盘点任务</span>
          <strong>${escapeHtml(s.name)}</strong>
        </div>
        <div class="diff-stat">
          <span class="diff-label">完成时间</span>
          <strong>${formatDate(s.completedAt)}</strong>
        </div>
        <div class="diff-stat">
          <span class="diff-label damaged">损坏设备</span>
          <strong>${damagedItems.length} 台${damagedItems.filter((i) => !i.processed).length > 0 ? ` (${damagedItems.filter((i) => !i.processed).length} 待处理)` : ""}</strong>
        </div>
        <div class="diff-stat">
          <span class="diff-label missing">丢失设备</span>
          <strong>${missingItems.length} 台${missingItems.filter((i) => !i.processed).length > 0 ? ` (${missingItems.filter((i) => !i.processed).length} 待处理)` : ""}</strong>
        </div>
        <div class="diff-stat">
          <span class="diff-label mismatch">位置不符</span>
          <strong>${mismatchItems.length} 台${mismatchItems.filter((i) => !i.processed).length > 0 ? ` (${mismatchItems.filter((i) => !i.processed).length} 待处理)` : ""}</strong>
        </div>
      </div>
    </div>

    ${damagedItems.length > 0 ? `
    <div class="diff-section">
      <h5>🔧 损坏设备（${damagedItems.length}）</h5>
      <table class="diff-table">
        <thead><tr><th>编号</th><th>名称</th><th>类别</th><th>结果</th><th>备注</th><th>状态</th></tr></thead>
        <tbody>${damagedItems.map(renderItemRow).join("")}</tbody>
      </table>
      <p class="diff-hint">处理方式：点击"转维修"按钮创建维修工单，设备将自动标记为维修中</p>
    </div>` : ""}

    ${missingItems.length > 0 ? `
    <div class="diff-section">
      <h5>❓ 丢失设备（${missingItems.length}）</h5>
      <table class="diff-table">
        <thead><tr><th>编号</th><th>名称</th><th>类别</th><th>结果</th><th>备注</th><th>状态</th></tr></thead>
        <tbody>${missingItems.map(renderItemRow).join("")}</tbody>
      </table>
      <p class="diff-hint">处理方式：点击"冻结库存"按钮将设备标记为丢失，从可租库存中移除</p>
    </div>` : ""}

    ${mismatchItems.length > 0 ? `
    <div class="diff-section">
      <h5>📍 位置不符设备（${mismatchItems.length}）</h5>
      <table class="diff-table">
        <thead><tr><th>编号</th><th>名称</th><th>类别</th><th>结果</th><th>备注</th><th>状态</th></tr></thead>
        <tbody>${mismatchItems.map((item) => `
          <tr>
            <td>${escapeHtml(item.equipmentId)}</td>
            <td>${escapeHtml(item.equipmentName)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>${getResultBadge(item.result, item.processed)}</td>
            <td>系统：${escapeHtml(item.expectedLocation)} → 实际：${escapeHtml(item.actualLocation)}</td>
            <td>${item.processed ? '<span class="meta">已处理</span>' : '<span style="color:var(--red)">待处理</span>'}</td>
          </tr>
        `).join("")}</tbody>
      </table>
      <p class="diff-hint">处理方式：点击"回写位置"按钮将设备位置更新为实际位置</p>
    </div>` : ""}
  `;

  diffReportModal.classList.remove("hidden");
}

function closeDiffReport() {
  diffReportModal.classList.add("hidden");
}

function toggleQuickLocationField() {
  const result = document.querySelector('input[name="quickResult"]:checked')?.value;
  if (result === "mismatch") {
    quickLocationField.classList.remove("hidden");
  } else {
    quickLocationField.classList.add("hidden");
    if (quickActualLocation) quickActualLocation.value = "";
  }
}

async function handleQuickScan() {
  const s = state.currentStocktake;
  if (!s) return;
  if (s.status !== "processing") {
    showToast("只有进行中的盘点才能扫码录入", "error");
    return;
  }

  const equipmentId = quickScanInput.value.trim();
  if (!equipmentId) return;

  const result = document.querySelector('input[name="quickResult"]:checked')?.value || "normal";
  const actualLocation = quickActualLocation?.value.trim() || "";

  if (result === "mismatch" && !actualLocation) {
    showToast("选择库位不符时请填写实际位置", "error");
    quickActualLocation?.focus();
    addQuickLog({
      success: false,
      equipmentId,
      name: "库位信息缺失",
      category: "",
      location: "",
      result: "",
      message: "选择库位不符时必须填写实际位置",
      errorTitle: "参数错误"
    });
    return;
  }

  quickScanInput.disabled = true;

  try {
    const response = await Stocktakes.scan(s.id, {
      equipmentId,
      result,
      actualLocation,
      remark: ""
    });

    state.currentStocktake = response.stocktake;
    const listIdx = state.list.findIndex((x) => x.id === response.stocktake.id);
    if (listIdx !== -1) state.list[listIdx] = response.stocktake;

    const item = response.item;
    addQuickLog({
      success: true,
      equipmentId: item.equipmentId,
      name: item.equipmentName,
      category: item.category,
      location: item.expectedLocation,
      result: item.result,
      isDuplicate: response.isDuplicate,
      previousResultLabel: response.previousResultLabel
    });

    if (response.isDuplicate) {
      showToast(`已覆盖原结果「${response.previousResultLabel}」`, "warn");
    } else {
      showToast(`${item.equipmentName} 已标记为「${STOCKTAKE_RESULT_LABELS[item.result]}」`);
    }

    renderStats();
    renderList();
    renderDetail();
    refreshStocktakeAudit();

  } catch (err) {
    const code = err.code || err.message?.includes("code:") ? "" : "";
    let errorTitle = "扫码失败";
    let name = equipmentId;
    let category = "";
    let location = "";
    let message = err.message;

    if (err.message?.includes("不在本次盘点范围内")) {
      errorTitle = "范围外设备";
      if (err.equipment) {
        name = err.equipment.name;
        category = err.equipment.category;
      }
    } else if (err.message?.includes("不存在")) {
      errorTitle = "设备不存在";
      name = `未知设备 (${equipmentId})`;
    } else if (err.message?.includes("差异已处理")) {
      errorTitle = "已处理差异";
      if (err.item) {
        name = err.item.equipmentName;
        category = err.item.category;
        message = `该设备标记为「${err.item.resultLabel}」的差异已处理`;
      }
    } else if (err.message?.includes("已完成或已取消")) {
      errorTitle = "任务已结束";
    }

    addQuickLog({
      success: false,
      equipmentId,
      name,
      category,
      location,
      result: "",
      message,
      errorTitle
    });

    showToast(message, "error");
  } finally {
    quickScanInput.disabled = false;
    quickScanInput.value = "";
    if (result !== "mismatch" && quickActualLocation) {
      quickActualLocation.value = "";
    }
    setTimeout(() => quickScanInput.focus(), 50);
  }
}

async function load() {
  try {
    const [stocktakes, equipment] = await Promise.all([Stocktakes.list(), Equipment.list()]);
    state.list = stocktakes;
    state.equipmentList = equipment;
    renderStats();
    renderList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

$("addBtn").addEventListener("click", openCreateModal);
$("reloadBtn").addEventListener("click", load);
$("backBtn").addEventListener("click", backToList);

const refreshAuditBtn = $("refreshAuditBtn");
if (refreshAuditBtn) {
  refreshAuditBtn.addEventListener("click", refreshStocktakeAudit);
}

$("closeCreateModal").addEventListener("click", closeCreateModal);
$("cancelCreateBtn").addEventListener("click", closeCreateModal);
$("submitCreateBtn").addEventListener("click", submitCreate);

$("closeResultModal").addEventListener("click", closeResultModal);
$("cancelResultBtn").addEventListener("click", closeResultModal);
$("submitResultBtn").addEventListener("click", submitResult);

resultForm.querySelectorAll('input[name="result"]').forEach((radio) => {
  radio.addEventListener("change", toggleActualLocationField);
});

document.querySelectorAll('input[name="quickResult"]').forEach((radio) => {
  radio.addEventListener("change", toggleQuickLocationField);
});

document.querySelectorAll(".view-switch-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchDetailMode(btn.dataset.view));
});

if (quickScanInput) {
  quickScanInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleQuickScan();
    }
  });
  quickScanInput.addEventListener("paste", (e) => {
    setTimeout(() => {
      if (quickScanInput.value.trim()) {
        handleQuickScan();
      }
    }, 10);
  });
}

if (quickActualLocation) {
  quickActualLocation.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleQuickScan();
    }
  });
}

$("closeDamagedModal").addEventListener("click", closeDamagedModal);
$("cancelDamagedBtn").addEventListener("click", closeDamagedModal);
$("submitDamagedBtn").addEventListener("click", submitDamaged);

$("closeDiffModal").addEventListener("click", closeDiffReport);
$("closeDiffBtn").addEventListener("click", closeDiffReport);

searchEl.addEventListener("input", (e) => {
  state.filters.search = e.target.value;
  renderList();
});
statusFilter.addEventListener("change", (e) => {
  state.filters.status = e.target.value;
  renderList();
});
resultFilter.addEventListener("change", (e) => {
  state.detailFilters.result = e.target.value;
  renderDetail();
});

[createModal, resultModal, damagedModal, diffReportModal].forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!createModal.classList.contains("hidden")) closeCreateModal();
    if (!resultModal.classList.contains("hidden")) closeResultModal();
    if (!damagedModal.classList.contains("hidden")) closeDamagedModal();
    if (!diffReportModal.classList.contains("hidden")) closeDiffReport();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (!createModal.classList.contains("hidden")) submitCreate();
    if (!resultModal.classList.contains("hidden")) submitResult();
    if (!damagedModal.classList.contains("hidden")) submitDamaged();
  }
});

load();
