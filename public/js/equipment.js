import {
  Equipment,
  Repairs,
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
  importPreview: null
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
        window.location.href = `/repairs?highlight=${rid}`;
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

load();
