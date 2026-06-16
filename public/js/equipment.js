import {
  Equipment,
  Repairs,
  Packages,
  showToast,
  REPAIR_STATUS_LABELS,
  REPAIR_SOURCE_LABELS
} from "./api.js";

const state = {
  list: [],
  repairs: [],
  editingId: null,
  filters: {
    search: "",
    category: "",
    condition: ""
  },
  importFile: null,
  importPreview: null,
  packages: [],
  packageEditingId: null,
  packageFilters: {
    search: "",
    category: ""
  },
  packageSelectedItems: new Set(),
  packageDepositOverrides: {},
  packageItemFilters: {
    category: "",
    search: ""
  }
};

const $ = (id) => document.getElementById(id);
const grid = $("equipmentGrid");
const statsEl = $("stats");
const countInfo = $("countInfo");
const categoryFilter = $("categoryFilter");
const conditionFilter = $("conditionFilter");
const searchEl = $("search");
const modal = $("modal");
const eqForm = $("eqForm");
const modalTitle = $("modalTitle");

const repairModal = $("repairModal");
const repairForm = $("repairForm");
const repairModalTitle = $("repairModalTitle");

const importModal = $("importModal");
const importStep1 = $("importStep1");
const importStep2 = $("importStep2");
const importFileInput = $("importFileInput");
const dropZone = $("dropZone");
const selectedFileInfo = $("selectedFileInfo");
const selectedFileName = $("selectedFileName");
const exportMenu = $("exportMenu");

function getActiveRepair(equipmentId) {
  return state.repairs.find(
    (r) => r.equipmentId === equipmentId && ["pending", "repairing"].includes(r.status)
  );
}

function renderStats() {
  const total = state.list.length;
  const available = state.list.filter((e) => e.condition === "available").length;
  const repair = state.list.filter((e) => e.condition === "repair").length;
  const categories = new Set(state.list.map((e) => e.category)).size;

  statsEl.innerHTML = `
    <div class="stat"><span>设备总数</span><strong>${total}</strong></div>
    <div class="stat"><span>在库可用</span><strong style="color:var(--green)">${available}</strong></div>
    <div class="stat"><span>维修中</span><strong style="color:var(--red)">${repair}</strong></div>
    <div class="stat"><span>类别数</span><strong>${categories}</strong></div>
  `;
}

function renderCategoryOptions() {
  const categories = [...new Set(state.list.map((e) => e.category))];
  categoryFilter.innerHTML =
    '<option value="">全部类别</option>' +
    categories.map((c) => `<option>${c}</option>`).join("");
  categoryFilter.value = state.filters.category;
}

function getFiltered() {
  const q = state.filters.search.trim().toLowerCase();
  return state.list.filter((e) => {
    if (state.filters.category && e.category !== state.filters.category) return false;
    if (state.filters.condition && e.condition !== state.filters.condition) return false;
    if (q) {
      const hay = `${e.id} ${e.name} ${e.spec} ${e.location} ${e.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderList() {
  const data = getFiltered();
  countInfo.textContent = `显示 ${data.length} / 共 ${state.list.length} 台`;

  if (!data.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h4>暂无匹配设备</h4>
        <p>试试调整筛选条件，或点击右上角"新增设备"入库</p>
      </div>`;
    return;
  }

  grid.innerHTML = data
    .map((e) => {
      const activeRepair = getActiveRepair(e.id);
      const sourceLabel = activeRepair?.source
        ? REPAIR_SOURCE_LABELS[activeRepair.source] || activeRepair.source
        : "";
      const repairSection = activeRepair
        ? `
          <div style="margin-bottom:10px">
            <span class="badge repair">${REPAIR_STATUS_LABELS[activeRepair.status] || "维修中"}</span>
            ${sourceLabel ? `<span class="badge source-badge" style="margin-left:6px">来源：${sourceLabel}</span>` : ""}
            <br>
            <a class="eq-repair-link" data-action="view-repair" data-repair-id="${activeRepair.id}">
              🔧 查看工单 ${activeRepair.id}
            </a>
            ${activeRepair.orderId ? `<div class="meta" style="font-size:11px;margin-top:4px">关联订单：${escapeHtml(activeRepair.orderId)}</div>` : ""}
          </div>
        `
        : e.condition === "repair"
        ? `
          <div style="margin-bottom:10px">
            <span class="badge repair">维修中</span>
          </div>
        `
        : `
          <div style="margin-bottom:10px">
            <span class="badge available">在库可用</span>
          </div>
        `;

      const actionBtn = activeRepair
        ? `<button class="secondary small" data-action="view-repair" data-repair-id="${activeRepair.id}">查看工单</button>`
        : `<button class="danger small" data-action="repair">🔧 发起维修</button>`;

      return `
    <article class="eq-card" data-id="${e.id}">
      <div class="eq-head">
        <div>
          <h4>${escapeHtml(e.name)}</h4>
          <span class="cat-pill cat-${escapeCss(e.category)}">${escapeHtml(e.category)}</span>
        </div>
        <span class="eq-id">${escapeHtml(e.id)}</span>
      </div>
      <div class="eq-spec">${escapeHtml(e.spec)}</div>
      <div class="eq-loc">${escapeHtml(e.location || "未指定")}</div>
      ${repairSection}
      <div class="eq-foot">
        ${
          activeRepair
            ? `<span class="meta" style="font-size:11px;color:var(--red)">故障：${escapeHtml(
                (activeRepair.faultDescription || "").slice(0, 20)
              )}${(activeRepair.faultDescription || "").length > 20 ? "..." : ""}</span>`
            : `<span class="meta" style="font-size:11px">可正常出租</span>`
        }
        <div class="eq-actions">
          ${actionBtn}
          <button class="secondary small" data-action="edit">编辑</button>
          <button class="danger small" data-action="delete">删除</button>
        </div>
      </div>
    </article>
  `;
    })
    .join("");

  grid.querySelectorAll(".eq-card").forEach((card) => {
    const id = card.dataset.id;
    const repairBtn = card.querySelector('[data-action="repair"]');
    const viewRepairBtns = card.querySelectorAll('[data-action="view-repair"]');
    const editBtn = card.querySelector('[data-action="edit"]');
    const delBtn = card.querySelector('[data-action="delete"]');

    if (repairBtn) {
      repairBtn.addEventListener("click", () => openRepairModal(id));
    }
    viewRepairBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const rid = btn.dataset.repairId;
        window.location.href = `/repairs?id=${rid}`;
      });
    });

    editBtn.addEventListener("click", () => openEdit(id));
    delBtn.addEventListener("click", async () => {
      const eq = state.list.find((x) => x.id === id);
      if (!confirm(`确定删除设备「${eq.name} (${id})」吗？`)) return;
      try {
        await Equipment.remove(id);
        state.list = state.list.filter((x) => x.id !== id);
        state.repairs = state.repairs.filter((r) => r.equipmentId !== id);
        showToast("设备已删除");
        renderStats();
        renderCategoryOptions();
        renderList();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

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

function openModal() {
  modal.classList.remove("hidden");
  setTimeout(() => eqForm.name?.focus(), 50);
}

function closeModal() {
  modal.classList.add("hidden");
  state.editingId = null;
  eqForm.reset();
}

function openRepairModal(equipmentId) {
  const eq = state.list.find((x) => x.id === equipmentId);
  if (!eq) return;

  repairModalTitle.textContent = `发起维修 - ${eq.name}`;
  repairForm.reset();
  repairForm.equipmentId.value = equipmentId;
  $("repairEqName").textContent = eq.name;
  $("repairEqId").textContent = `(${eq.id})`;
  repairForm.sendTime.value = new Date().toISOString().slice(0, 10);
  repairForm.status.value = "pending";

  repairModal.classList.remove("hidden");
  setTimeout(() => repairForm.faultDescription?.focus(), 50);
}

function closeRepairModal() {
  repairModal.classList.add("hidden");
}

async function submitRepairForm() {
  const data = Object.fromEntries(new FormData(repairForm).entries());
  data.faultDescription = data.faultDescription?.trim();

  if (!data.faultDescription) {
    showToast("请填写故障描述", "error");
    return;
  }
  if (data.repairCost !== "") {
    data.repairCost = Number(data.repairCost);
  }

  try {
    const created = await Repairs.create(data);
    state.repairs.unshift(created);

    const eq = state.list.find((x) => x.id === data.equipmentId);
    if (eq) eq.condition = "repair";

    showToast(`维修工单「${created.id}」已创建，设备已标记为维修中`);
    closeRepairModal();
    renderStats();
    renderList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openEdit(id) {
  const eq = state.list.find((x) => x.id === id);
  if (!eq) return;
  state.editingId = id;
  modalTitle.textContent = "编辑设备";
  eqForm.id.value = eq.id;
  eqForm.name.value = eq.name;
  eqForm.category.value = eq.category;
  eqForm.spec.value = eq.spec || "";
  eqForm.location.value = eq.location || "";
  eqForm.condition.value = eq.condition;
  eqForm.id.readOnly = true;
  openModal();
}

function openCreate() {
  state.editingId = null;
  modalTitle.textContent = "新增设备";
  eqForm.reset();
  eqForm.id.readOnly = false;
  eqForm.condition.value = "available";
  openModal();
}

async function submitForm() {
  const data = Object.fromEntries(new FormData(eqForm).entries());
  data.name = data.name?.trim();
  data.category = data.category?.trim();
  if (!data.name || !data.category) {
    showToast("请填写设备名称和类别", "error");
    return;
  }
  try {
    if (state.editingId) {
      const activeRepair = getActiveRepair(state.editingId);
      if (activeRepair && data.condition === "available") {
        if (!confirm("该设备有进行中的维修工单，改为可用将同时取消工单，是否继续？")) {
          return;
        }
        await Repairs.update(activeRepair.id, { status: "cancelled" });
        const ridx = state.repairs.findIndex((r) => r.id === activeRepair.id);
        if (ridx !== -1) state.repairs[ridx].status = "cancelled";
      }

      await Equipment.update(state.editingId, data);
      const idx = state.list.findIndex((x) => x.id === state.editingId);
      if (idx !== -1) state.list[idx] = { ...state.list[idx], ...data, id: state.editingId };
      showToast("设备信息已更新");
    } else {
      const created = await Equipment.create(data);
      state.list.unshift(created);
      showToast(`设备「${created.name}」已入库`);
    }
    renderStats();
    renderCategoryOptions();
    renderList();
    closeModal();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function load() {
  try {
    const [equipment, repairs] = await Promise.all([Equipment.list(), Repairs.list()]);
    state.list = equipment;
    state.repairs = repairs;
    renderStats();
    renderCategoryOptions();
    renderList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

$("addBtn").addEventListener("click", openCreate);
$("closeModal").addEventListener("click", closeModal);
$("cancelBtn").addEventListener("click", closeModal);
$("submitBtn").addEventListener("click", submitForm);
$("reloadBtn").addEventListener("click", load);

$("closeRepairModal").addEventListener("click", closeRepairModal);
$("cancelRepairBtn").addEventListener("click", closeRepairModal);
$("submitRepairBtn").addEventListener("click", submitRepairForm);

searchEl.addEventListener("input", (e) => {
  state.filters.search = e.target.value;
  renderList();
});
categoryFilter.addEventListener("change", (e) => {
  state.filters.category = e.target.value;
  renderList();
});
conditionFilter.addEventListener("change", (e) => {
  state.filters.condition = e.target.value;
  renderList();
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
repairModal.addEventListener("click", (e) => {
  if (e.target === repairModal) closeRepairModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modal.classList.contains("hidden")) closeModal();
    if (!repairModal.classList.contains("hidden")) closeRepairModal();
    if (!importModal.classList.contains("hidden")) closeImportModal();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (!modal.classList.contains("hidden")) submitForm();
    if (!repairModal.classList.contains("hidden")) submitRepairForm();
  }
});

function openImportModal() {
  resetImportState();
  importModal.classList.remove("hidden");
}

function closeImportModal() {
  importModal.classList.add("hidden");
}

function resetImportState() {
  state.importFile = null;
  state.importPreview = null;
  importStep1.classList.remove("hidden");
  importStep2.classList.add("hidden");
  $("backStepBtn").classList.add("hidden");
  $("previewImportBtn").classList.remove("hidden");
  $("previewImportBtn").disabled = true;
  $("confirmImportBtn").classList.add("hidden");
  $("confirmImportBtn").disabled = true;
  selectedFileInfo.classList.add("hidden");
  importFileInput.value = "";
}

function setImportFile(file) {
  if (!file) return;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext !== "csv" && ext !== "json") {
    showToast("仅支持 CSV 或 JSON 文件", "error");
    return;
  }
  state.importFile = file;
  selectedFileName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  selectedFileInfo.classList.remove("hidden");
  $("previewImportBtn").disabled = false;
  dropZone.classList.add("has-file");
}

function downloadTemplate() {
  const headers = ["设备编号", "设备名称", "设备类别", "规格参数", "存放位置", "设备状态"];
  const sample = [
    ["L-TEST01", "示例光束灯", "灯具", "230W 7R", "主仓A", "在库可用"],
    ["C-TEST01", "示例控台", "控台", "Command Wing", "控台柜", "在库可用"]
  ];
  const csv = "\uFEFF" + [headers.join(","), ...sample.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "equipment_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function runPreview() {
  if (!state.importFile) return;
  const fd = new FormData();
  fd.append("file", state.importFile);
  try {
    const result = await Equipment.previewImport(fd);
    state.importPreview = result;
    renderImportPreview(result);
    importStep1.classList.add("hidden");
    importStep2.classList.remove("hidden");
    $("backStepBtn").classList.remove("hidden");
    $("previewImportBtn").classList.add("hidden");
    $("confirmImportBtn").classList.remove("hidden");
    $("confirmImportBtn").disabled = result.validCount === 0;
  } catch (err) {
    showToast(err.message, "error");
  }
}

function backToStep1() {
  importStep1.classList.remove("hidden");
  importStep2.classList.add("hidden");
  $("backStepBtn").classList.add("hidden");
  $("previewImportBtn").classList.remove("hidden");
  $("confirmImportBtn").classList.add("hidden");
}

function renderImportPreview(r) {
  const COND_LABEL = { available: "在库可用", repair: "维修中" };

  let optionalMissingCount = 0;
  r.valid.forEach((v) => {
    if (v.missingOptional && v.missingOptional.length > 0) {
      optionalMissingCount++;
    }
  });

  $("importSummary").innerHTML = `
    <div class="summary-row">
      <div class="summary-card ok"><span>可写入</span><strong>${r.validCount}</strong></div>
      <div class="summary-card warn"><span>重复编号</span><strong>${r.duplicateCount}</strong></div>
      <div class="summary-card err"><span>字段缺失</span><strong>${r.missingCount}</strong></div>
      <div class="summary-card info"><span>总计</span><strong>${r.total}</strong></div>
    </div>
    ${optionalMissingCount > 0 ? `<div class="preview-hint">⚠️ 有 <strong>${optionalMissingCount}</strong> 条记录的可选字段使用了默认值，请在下表中查看黄色标记的单元格</div>` : ""}
  `;
  $("validCount").textContent = r.validCount;
  $("duplicateCount").textContent = r.duplicateCount;
  $("missingCount").textContent = r.missingCount;

  const validBody = $("validTable").querySelector("tbody");
  validBody.innerHTML = r.valid.length
    ? r.valid.map(({ row, record, missingOptional }) => {
        const missMap = {};
        (missingOptional || []).forEach((m) => { missMap[m.field] = m; });

        const hasMissing = (missingOptional || []).length > 0;
        const rowClass = hasMissing ? 'class="has-default"' : "";

        const specCell = missMap.spec
          ? `<td class="cell-default" title="字段缺失，使用默认值 ${missMap.spec.defaultValue}"><span class="default-badge">默认</span> ${escapeHtml(record.spec || "-")}</td>`
          : `<td>${escapeHtml(record.spec || "-")}</td>`;

        const locationCell = missMap.location
          ? `<td class="cell-default" title="字段缺失，使用默认值 ${missMap.location.defaultValue}"><span class="default-badge">默认</span> ${escapeHtml(record.location || "-")}</td>`
          : `<td>${escapeHtml(record.location || "-")}</td>`;

        const conditionCell = missMap.condition
          ? `<td class="cell-default" title="字段缺失，使用默认值 ${missMap.condition.defaultValue}"><span class="default-badge">默认</span> <span class="badge ${record.condition}">${COND_LABEL[record.condition] || record.condition}</span></td>`
          : `<td><span class="badge ${record.condition}">${COND_LABEL[record.condition] || record.condition}</span></td>`;

        return `
        <tr ${rowClass}>
          <td>${row}</td>
          <td class="mono">${escapeHtml(record.id)}</td>
          <td>${escapeHtml(record.name)}</td>
          <td>${escapeHtml(record.category)}</td>
          ${specCell}
          ${locationCell}
          ${conditionCell}
        </tr>
      `;
      }).join("")
    : `<tr><td colspan="7" class="empty-row">无可写入记录</td></tr>`;

  const dupBody = $("duplicateTable").querySelector("tbody");
  dupBody.innerHTML = r.duplicates.length
    ? r.duplicates.map(({ row, record, reason }) => `
        <tr>
          <td>${row}</td>
          <td class="mono">${escapeHtml(record.id)}</td>
          <td>${escapeHtml(record.name || "-")}</td>
          <td>${escapeHtml(record.category || "-")}</td>
          <td class="err-text">${escapeHtml(reason)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-row">无重复记录</td></tr>`;

  const missBody = $("missingTable").querySelector("tbody");
  missBody.innerHTML = r.missing.length
    ? r.missing.map(({ row, record, fields }) => `
        <tr>
          <td>${row}</td>
          <td class="mono">${escapeHtml(record.id || "-")}</td>
          <td>${escapeHtml(record.name || "-")}</td>
          <td>${escapeHtml(record.category || "-")}</td>
          <td class="err-text">${escapeHtml(fields.join(", "))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-row">无字段缺失记录</td></tr>`;
}

async function runConfirmImport() {
  if (!state.importFile) return;
  if (!confirm(`确定导入 ${state.importPreview.validCount} 条设备记录吗？`)) return;
  const fd = new FormData();
  fd.append("file", state.importFile);
  try {
    const result = await Equipment.confirmImport(fd);
    showToast(`成功导入 ${result.inserted} 条设备`);
    state.list = await Equipment.list();
    renderStats();
    renderCategoryOptions();
    renderList();
    closeImportModal();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openExportMenu(e) {
  e.stopPropagation();
  const rect = e.currentTarget.getBoundingClientRect();
  exportMenu.style.top = `${rect.bottom + 6}px`;
  exportMenu.style.right = `${window.innerWidth - rect.right}px`;
  exportMenu.classList.toggle("hidden");
}

function runExport(format) {
  const params = {
    format,
    search: state.filters.search,
    category: state.filters.category,
    condition: state.filters.condition
  };
  const url = Equipment.exportUrl(params);
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  exportMenu.classList.add("hidden");
  showToast("导出已开始");
}

$("importBtn").addEventListener("click", openImportModal);
$("closeImportModal").addEventListener("click", closeImportModal);
$("cancelImportBtn").addEventListener("click", closeImportModal);
$("backStepBtn").addEventListener("click", backToStep1);
$("previewImportBtn").addEventListener("click", runPreview);
$("confirmImportBtn").addEventListener("click", runConfirmImport);
$("clearFileBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  state.importFile = null;
  importFileInput.value = "";
  selectedFileInfo.classList.add("hidden");
  $("previewImportBtn").disabled = true;
  dropZone.classList.remove("has-file");
});

dropZone.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", (e) => setImportFile(e.target.files[0]));
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  setImportFile(e.dataTransfer.files[0]);
});

$("downloadTemplateBtn").addEventListener("click", downloadTemplate);

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) =>
      p.classList.toggle("active", p.dataset.panel === tab)
    );
  });
});

$("exportBtn").addEventListener("click", openExportMenu);
document.querySelectorAll(".dropdown-item").forEach((btn) => {
  btn.addEventListener("click", () => runExport(btn.dataset.format));
});

document.addEventListener("click", (e) => {
  if (!exportMenu.classList.contains("hidden") && !e.target.closest("#exportMenu") && !e.target.closest("#exportBtn")) {
    exportMenu.classList.add("hidden");
  }
  if (!importModal.classList.contains("hidden") && e.target === importModal) {
    closeImportModal();
  }
});

const pkgCategoryOptions = ["通用", "发布会", "演唱会", "婚礼", "会议", "演出", "其他"];

function renderPackageStats() {
  const total = state.packages.length;
  const categories = new Set(state.packages.map((p) => p.category || "通用")).size;
  const totalItems = state.packages.reduce((sum, p) => sum + ((p.itemIds || []).length), 0);
  return `共 ${total} 个套餐 · ${categories} 种类别 · ${totalItems} 台设备`;
}

function renderPackageList() {
  const q = state.packageFilters.search.trim().toLowerCase();
  const cat = state.packageFilters.category;

  let data = state.packages.filter((p) => {
    if (cat && (p.category || "通用") !== cat) return false;
    if (q) {
      const hay = `${p.id} ${p.name} ${p.category || "通用"} ${p.description || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pkgGrid = $("packagesGrid");
  const pkgCount = $("pkgCountInfo");
  const catFilter = $("pkgCategoryFilter");

  const allCategories = [...new Set(state.packages.map((p) => p.category || "通用"))];
  catFilter.innerHTML = '<option value="">全部类别</option>' +
    allCategories.map((c) => `<option ${cat === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");

  pkgCount.textContent = `显示 ${data.length} / ${renderPackageStats()}`;

  if (!data.length) {
    pkgGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h4>暂无套餐</h4>
        <p>点击右上角"新建套餐"创建常用设备组合</p>
      </div>`;
    return;
  }

  pkgGrid.innerHTML = data
    .map((p) => {
      const eqMap = new Map(state.list.map((e) => [e.id, e]));
      const itemTags = (p.itemIds || []).slice(0, 6).map((iid) => {
        const e = eqMap.get(iid);
        return `<span class="item-tag">${escapeHtml(e ? `${e.id} ${e.name}` : iid)}</span>`;
      }).join("");
      const moreTag = (p.itemIds || []).length > 6 ? `<span class="item-tag">+${(p.itemIds || []).length - 6} 件</span>` : "";

      const issueCount = (p.items || []).filter((it) => !it.exists || it.condition === "repair").length;
      const issueBadge = issueCount > 0
        ? `<span class="badge repair" title="${issueCount} 台设备有问题">⚠️ ${issueCount} 异常</span>`
        : `<span class="badge available">设备正常</span>`;

      return `
        <article class="eq-card" data-pkg-id="${escapeHtml(p.id)}">
          <div class="eq-head">
            <div>
              <h4>${escapeHtml(p.name)}</h4>
              <span class="cat-pill cat-${escapeCss(p.category || "通用")}">${escapeHtml(p.category || "通用")}</span>
            </div>
            <span class="eq-id">${escapeHtml(p.id)}</span>
          </div>
          <div class="eq-spec">${escapeHtml(p.description || "暂无描述")}</div>
          <div class="eq-loc">含 ${(p.itemIds || []).length} 台设备</div>
          <div style="margin-bottom:10px">${issueBadge}</div>
          <div class="version-items" style="margin-bottom:10px;max-height:60px;overflow:hidden">
            ${itemTags}${moreTag}
          </div>
          <div class="eq-foot">
            <span class="meta" style="font-size:11px">
              创建：${formatDateShort(p.createdAt)}
              ${p.updatedAt !== p.createdAt ? ` · 更新：${formatDateShort(p.updatedAt)}` : ""}
            </span>
            <div class="eq-actions">
              <button class="secondary small" data-action="edit-pkg">编辑</button>
              <button class="danger small" data-action="delete-pkg">删除</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  pkgGrid.querySelectorAll(".eq-card").forEach((card) => {
    const id = card.dataset.pkgId;
    card.querySelector('[data-action="edit-pkg"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openPackageEdit(id);
    });
    card.querySelector('[data-action="delete-pkg"]').addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeletePackage(id);
    });
  });
}

function formatDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function openPackageModal() {
  state.packageEditingId = null;
  state.packageSelectedItems.clear();
  Object.keys(state.packageDepositOverrides).forEach((k) => delete state.packageDepositOverrides[k]);
  state.packageItemFilters = { category: "", search: "" };

  $("packageModalTitle").textContent = "新建套餐";
  $("packageForm").reset();
  $("packageForm").category.value = "通用";

  renderPackageEquipmentGrid();
  renderPackageDepositOverrides();
  updatePackageSelectionInfo();
  $("packageModal").classList.remove("hidden");
}

function closePackageModal() {
  $("packageModal").classList.add("hidden");
  state.packageEditingId = null;
}

async function openPackageEdit(id) {
  try {
    const pkg = await Packages.get(id);
    state.packageEditingId = id;
    state.packageSelectedItems.clear();
    Object.keys(state.packageDepositOverrides).forEach((k) => delete state.packageDepositOverrides[k]);

    (pkg.itemIds || []).forEach((iid) => state.packageSelectedItems.add(iid));
    if (pkg.depositOverrides) {
      Object.assign(state.packageDepositOverrides, pkg.depositOverrides);
    }

    $("packageModalTitle").textContent = `编辑套餐 ${pkg.id}`;
    $("packageForm").id.value = pkg.id;
    $("packageForm").id.readOnly = true;
    $("packageForm").name.value = pkg.name || "";
    $("packageForm").category.value = pkg.category || "通用";
    $("packageForm").description.value = pkg.description || "";

    renderPackageEquipmentGrid();
    renderPackageDepositOverrides();
    updatePackageSelectionInfo();
    $("packageModal").classList.remove("hidden");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderPackageEquipmentGrid() {
  const cat = state.packageItemFilters.category;
  const q = state.packageItemFilters.search.trim().toLowerCase();
  const gridEl = $("pkgEquipmentGrid");

  let visible = [...state.list];
  if (cat) visible = visible.filter((e) => e.category === cat);
  if (q) visible = visible.filter((e) => {
    const hay = `${e.id} ${e.name} ${e.category} ${e.spec || ""}`.toLowerCase();
    return hay.includes(q);
  });

  const catFilter = $("pkgItemCategoryFilter");
  const categories = [...new Set(state.list.map((e) => e.category))];
  catFilter.innerHTML = '<option value="">全部类别</option>' +
    categories.map((c) => `<option ${cat === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");

  if (!visible.length) {
    gridEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);grid-column:1/-1">暂无匹配设备</div>`;
    return;
  }

  gridEl.innerHTML = visible
    .map((item) => {
      const isRepair = item.condition === "repair";
      const isSelected = state.packageSelectedItems.has(item.id);
      const cls = "item " + (isSelected ? "selected " : "");
      let statusText = item.location;
      if (isRepair) statusText = "维修中";

      const disabledCls = isRepair ? " disabled" : "";
      const title = isRepair ? "维修中，不可加入套餐" : "点击选择加入套餐";
      return `<div class="${cls}${disabledCls}" data-id="${escapeHtml(item.id)}" data-repair="${isRepair ? 1 : 0}" title="${title}" style="padding:10px;cursor:pointer;border:1px solid ${isSelected ? 'var(--green)' : 'var(--line)'};border-radius:8px;background:${isSelected ? '#f1faf3' : '#fff'}">
        <b>${escapeHtml(item.name)}</b>
        <div class="meta">${escapeHtml(item.id)} · ${escapeHtml(item.category)} · ${escapeHtml(item.spec || "—")}</div>
        <div class="${isRepair ? "repair" : "meta"}" style="margin-top:4px">
          ${isRepair ? '<span class="badge repair">维修中</span>' : '<span class="badge available">在库</span>'}
          ${escapeHtml(statusText)}
        </div>
      </div>`;
    })
    .join("");

  gridEl.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      const isRepair = el.dataset.repair === "1";
      if (isRepair) {
        showToast("维修中设备不可加入套餐", "error");
        return;
      }
      if (state.packageSelectedItems.has(id)) {
        state.packageSelectedItems.delete(id);
        delete state.packageDepositOverrides[id];
      } else {
        state.packageSelectedItems.add(id);
      }
      renderPackageEquipmentGrid();
      renderPackageDepositOverrides();
      updatePackageSelectionInfo();
    };
  });
}

function updatePackageSelectionInfo() {
  $("pkgSelectionInfo").textContent = state.packageSelectedItems.size
    ? `已选择 ${state.packageSelectedItems.size} 台设备`
    : "请至少选择一台设备加入套餐";
}

function renderPackageDepositOverrides() {
  const wrap = $("pkgDepositOverrides");
  const ids = [...state.packageSelectedItems];
  if (!ids.length) {
    wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">请先选择设备</div>`;
    return;
  }

  const DEFAULTS = { 灯具: 500, 控台: 2000, 桁架: 300, 线缆: 100, 其他: 200 };

  wrap.innerHTML = ids
    .map((iid) => {
      const e = state.list.find((x) => x.id === iid);
      if (!e) return "";
      const defDep = DEFAULTS[e.category] || DEFAULTS.其他;
      const curVal = state.packageDepositOverrides[iid]?.deposit;
      const isSet = curVal != null && curVal !== defDep;
      const val = isSet ? curVal : defDep;
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px">
        <span style="flex:0 0 35%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.id)} ${escapeHtml(e.name)}">
          <strong>${escapeHtml(e.name)}</strong> <span class="meta">(${escapeHtml(e.id)})</span>
        </span>
        <span class="meta" style="flex:0 0 100px;text-align:right">默认 ¥${defDep.toLocaleString()}</span>
        <div style="flex:1;display:flex;align-items:center;gap:4px;justify-content:flex-end">
          <span style="color:var(--muted);font-weight:600">¥</span>
          <input type="number" min="0" step="10" value="${val}"
            data-item-id="${escapeHtml(iid)}"
            data-default="${defDep}"
            ${!isSet ? 'style="border-color:var(--line);color:var(--muted)"' : 'style="border-color:var(--blue);color:var(--blue);font-weight:600"'}
            style="width:100px;padding:4px 6px;border:1px solid ${isSet ? 'var(--blue)' : 'var(--line)'} ;border-radius:4px;font-family:monospace;text-align:right;color:${isSet ? 'var(--blue)' : 'var(--muted)'} ;font-weight:${isSet ? '600' : '400'}"
            class="pkg-deposit-input">
          ${isSet ? `<button class="ghost small pkg-deposit-reset" data-item-id="${escapeHtml(iid)}" style="padding:2px 6px;font-size:12px">↺</button>` : ''}
        </div>
      </div>
      `;
    })
    .join("");

  wrap.querySelectorAll(".pkg-deposit-input").forEach((inp) => {
    inp.onchange = () => {
      const id = inp.dataset.itemId;
      const def = Number(inp.dataset.default || 0);
      const val = Number(inp.value);
      if (Number.isNaN(val) || val < 0) {
        showToast("押金不能为负数", "error");
        inp.value = state.packageDepositOverrides[id]?.deposit ?? def;
        return;
      }
      if (val === def) {
        delete state.packageDepositOverrides[id];
      } else {
        state.packageDepositOverrides[id] = { deposit: val };
      }
      renderPackageDepositOverrides();
    };
  });

  wrap.querySelectorAll(".pkg-deposit-reset").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.itemId;
      delete state.packageDepositOverrides[id];
      renderPackageDepositOverrides();
    };
  });
}

async function submitPackage() {
  const form = $("packageForm");
  const data = Object.fromEntries(new FormData(form).entries());
  data.itemIds = [...state.packageSelectedItems];
  data.depositOverrides = { ...state.packageDepositOverrides };

  if (!data.name || !String(data.name).trim()) {
    showToast("请填写套餐名称", "error");
    return;
  }
  if (!data.itemIds.length) {
    showToast("请至少选择一台设备", "error");
    return;
  }

  try {
    if (state.packageEditingId) {
      await Packages.update(state.packageEditingId, data);
      showToast(`套餐 ${state.packageEditingId} 已更新`);
    } else {
      const created = await Packages.create(data);
      showToast(`套餐 ${created.id} 创建成功`);
    }
    closePackageModal();
    await loadPackages();
    renderPackageList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleDeletePackage(id) {
  const pkg = state.packages.find((p) => p.id === id);
  if (!pkg) return;
  if (!confirm(`确定删除套餐「${pkg.name} (${id})」吗？删除后不可恢复。`)) return;
  try {
    await Packages.remove(id);
    state.packages = state.packages.filter((p) => p.id !== id);
    showToast("套餐已删除");
    renderPackageList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadPackages() {
  try {
    state.packages = await Packages.list();
  } catch (err) {
    state.packages = [];
    showToast(err.message, "error");
  }
}

$("addPackageBtn").addEventListener("click", openPackageModal);
$("closePackageModal").addEventListener("click", closePackageModal);
$("cancelPackageBtn").addEventListener("click", closePackageModal);
$("submitPackageBtn").addEventListener("click", submitPackage);
$("pkgReloadBtn").addEventListener("click", async () => {
  await loadPackages();
  renderPackageList();
});

$("pkgSearch").addEventListener("input", (e) => {
  state.packageFilters.search = e.target.value;
  renderPackageList();
});

$("pkgCategoryFilter").addEventListener("change", (e) => {
  state.packageFilters.category = e.target.value;
  renderPackageList();
});

$("pkgItemCategoryFilter").addEventListener("change", (e) => {
  state.packageItemFilters.category = e.target.value;
  renderPackageEquipmentGrid();
});

$("pkgItemSearch").addEventListener("input", (e) => {
  state.packageItemFilters.search = e.target.value;
  renderPackageEquipmentGrid();
});

document.querySelectorAll("#mainTabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll("#mainTabs .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll('.tab-panel[data-panel]').forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === tab);
    });
    if (tab === "packages") {
      loadPackages().then(renderPackageList);
    }
  });
});

$("packageModal").addEventListener("click", (e) => {
  if (e.target.id === "packageModal") closePackageModal();
});

const originalLoad = load;
load = async function() {
  await Promise.all([
    (async () => {
      try {
        const [equipment, repairs] = await Promise.all([Equipment.list(), Repairs.list()]);
        state.list = equipment;
        state.repairs = repairs;
        renderStats();
        renderCategoryOptions();
        renderList();
      } catch (err) {
        showToast(err.message, "error");
      }
    })(),
    loadPackages().then(renderPackageList)
  ]);
};

load();
