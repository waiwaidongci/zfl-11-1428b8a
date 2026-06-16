import {
  Repairs,
  Equipment,
  AuditLogs,
  showToast,
  REPAIR_STATUS_LABELS,
  REPAIR_SOURCE_LABELS,
  REPAIR_LIABILITY_LABELS
} from "./api.js";

const state = {
  list: [],
  equipmentList: [],
  editingId: null,
  filters: {
    search: "",
    status: ""
  }
};

const $ = (id) => document.getElementById(id);
const grid = $("repairGrid");
const statsEl = $("stats");
const countInfo = $("countInfo");
const statusFilter = $("statusFilter");
const searchEl = $("search");
const modal = $("modal");
const form = $("repairForm");
const modalTitle = $("modalTitle");
const equipmentSelect = $("equipmentSelect");

const STATUS_FLOW = {
  pending: { next: "repairing", btnText: "确认送修" },
  repairing: { next: "completed", btnText: "完成维修" },
  completed: null,
  cancelled: null
};

function renderStats() {
  const total = state.list.length;
  const pending = state.list.filter((r) => r.status === "pending").length;
  const repairing = state.list.filter((r) => r.status === "repairing").length;
  const completed = state.list.filter((r) => r.status === "completed").length;
  const totalCost = state.list
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + (Number(r.repairCost) || 0), 0);

  statsEl.innerHTML = `
    <div class="stat"><span>工单总数</span><strong>${total}</strong></div>
    <div class="stat"><span>待送修</span><strong style="color:var(--yellow)">${pending}</strong></div>
    <div class="stat"><span>维修中</span><strong style="color:var(--red)">${repairing}</strong></div>
    <div class="stat"><span>已完成 / 累计费用</span><strong style="color:var(--green)">${completed} / ¥${totalCost.toFixed(2)}</strong></div>
  `;
}

function renderEquipmentOptions() {
  const available = state.equipmentList.filter((e) => {
    if (e.condition !== "available") {
      const active = state.list.find(
        (r) => r.equipmentId === e.id && ["pending", "repairing"].includes(r.status)
      );
      if (!active) return true;
      return false;
    }
    return true;
  });

  equipmentSelect.innerHTML =
    '<option value="">请选择设备</option>' +
    available
      .map(
        (e) =>
          `<option value="${e.id}" ${e.condition === "repair" ? "data-repair='1'" : ""}>
            ${escapeHtml(e.name)} (${e.id})${e.condition === "repair" ? " - [当前维修中]" : ""}
          </option>`
      )
      .join("");
}

function getFiltered() {
  const q = state.filters.search.trim().toLowerCase();
  return state.list.filter((r) => {
    if (state.filters.status && r.status !== state.filters.status) return false;
    if (q) {
      const hay = `${r.id} ${r.equipmentName} ${r.equipmentId} ${r.faultDescription} ${r.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTimeline(status) {
  const steps = ["pending", "repairing", "completed"];
  const labels = { pending: "待送修", repairing: "维修中", completed: "已完成" };
  const currentIdx = status === "cancelled" ? -1 : steps.indexOf(status);

  return `<div class="timeline">${steps
    .map((s, i) => {
      let cls = "pending-step";
      if (status === "cancelled") cls = "pending-step";
      else if (i < currentIdx) cls = "done";
      else if (i === currentIdx) cls = "active";
      return `<div class="timeline-step ${cls}">${labels[s]}</div>`;
    })
    .join("")}</div>`;
}

function getRepairCustomerAmount(repair) {
  if (repair.customerAmount !== undefined && repair.customerAmount !== null && repair.customerAmount !== "") {
    return Number(repair.customerAmount) || 0;
  }
  return Number(repair.actualRepairCost || repair.repairCost || 0);
}

function renderList() {
  const data = getFiltered();
  countInfo.textContent = `显示 ${data.length} / 共 ${state.list.length} 条`;

  if (!data.length) {
    grid.innerHTML = `
      <div class="empty-repairs">
        <h4>暂无维修工单</h4>
        <p>点击右上角"新建工单"或从设备管理页发起维修申请</p>
      </div>`;
    return;
  }

  grid.innerHTML = data
    .map((r) => {
      const flow = STATUS_FLOW[r.status];
      const statusBadge = `<span class="repair-status-badge ${r.status}"><span class="repair-status-dot"></span>${REPAIR_STATUS_LABELS[r.status] || r.status}</span>`;

      return `
    <article class="repair-card status-${r.status}" data-id="${r.id}">
      <div class="repair-head">
        <div>
          <h4>${escapeHtml(r.equipmentName)}</h4>
          <span class="cat-pill cat-${escapeCss(r.equipment?.category || "其他")}" style="margin-top:6px;display:inline-block">
            ${escapeHtml(r.equipment?.category || "其他")}
          </span>
        </div>
        <span class="repair-id">${escapeHtml(r.id)}</span>
      </div>

      <div class="repair-eq">
        <span class="repair-eq-name">${escapeHtml(r.equipment?.name || r.equipmentName)}</span>
        <span class="repair-eq-id">${escapeHtml(r.equipment?.id || r.equipmentId)}</span>
        ${r.equipment?.spec ? `<span class="meta">${escapeHtml(r.equipment.spec)}</span>` : ""}
      </div>

      <div class="repair-fault">
        <div class="repair-fault-label">⚠ 故障描述</div>
        ${escapeHtml(r.faultDescription)}
      </div>

      ${renderTimeline(r.status)}

      <div class="repair-meta">
        <div class="repair-meta-item">
          <span class="repair-meta-label">送修日期</span>
          <span class="repair-meta-value">${r.sendTime || "-"}</span>
        </div>
        <div class="repair-meta-item">
          <span class="repair-meta-label">预计恢复</span>
          <span class="repair-meta-value">${r.expectedReturn || "-"}</span>
        </div>
        <div class="repair-meta-item">
          <span class="repair-meta-label">预估费用</span>
          <span class="repair-meta-value cost">¥${(Number(r.repairCost) || 0).toFixed(2)}</span>
        </div>
        <div class="repair-meta-item">
          <span class="repair-meta-label">实际费用</span>
          <span class="repair-meta-value cost">¥${(Number(r.actualRepairCost) || 0).toFixed(2)}</span>
        </div>
      </div>

      <div class="repair-meta">
        <div class="repair-meta-item">
          <span class="repair-meta-label">责任归属</span>
          <span class="repair-meta-value">${REPAIR_LIABILITY_LABELS[r.liability] || "-"}</span>
        </div>
        ${
          r.liability === "customer"
            ? `<div class="repair-meta-item">
            <span class="repair-meta-label">客户承担</span>
            <span class="repair-meta-value cost">¥${getRepairCustomerAmount(r).toFixed(2)}</span>
          </div>`
            : ""
        }
        <div class="repair-meta-item">
          <span class="repair-meta-label">工单来源</span>
          <span class="repair-meta-value">${REPAIR_SOURCE_LABELS[r.source] || "手动创建"}</span>
        </div>
        ${
          r.orderId
            ? `<div class="repair-meta-item">
            <span class="repair-meta-label">关联订单</span>
            <span class="repair-meta-value"><a href="/?id=${encodeURIComponent(r.orderId)}" target="_blank">${escapeHtml(r.orderId)}</a></span>
          </div>`
            : ""
        }
      </div>

      <div class="repair-note">${escapeHtml(r.note) || ""}</div>

      <div class="repair-foot">
        ${statusBadge}
        <div class="repair-actions">
          ${flow ? `<button class="secondary small" data-action="advance">${flow.btnText}</button>` : ""}
          <button class="ghost small" data-action="edit">编辑</button>
          <button class="danger small" data-action="delete">删除</button>
        </div>
      </div>
    </article>
  `;
    })
    .join("");

  grid.querySelectorAll(".repair-card").forEach((card) => {
    const id = card.dataset.id;
    const advanceBtn = card.querySelector('[data-action="advance"]');
    const editBtn = card.querySelector('[data-action="edit"]');
    const delBtn = card.querySelector('[data-action="delete"]');

    if (advanceBtn) {
      advanceBtn.addEventListener("click", async () => {
        try {
          const updated = await Repairs.advance(id);
          const idx = state.list.findIndex((x) => x.id === id);
          if (idx !== -1) state.list[idx] = updated;
          showToast(`工单状态已推进为「${REPAIR_STATUS_LABELS[updated.status]}」`);
          if (updated.status === "completed") {
            const eq = state.equipmentList.find((e) => e.id === updated.equipmentId);
            if (eq) eq.condition = "available";
          }
          renderStats();
          renderList();
        } catch (err) {
          showToast(err.message, "error");
          await load();
        }
      });
    }

    editBtn.addEventListener("click", () => openEdit(id));
    delBtn.addEventListener("click", async () => {
      const r = state.list.find((x) => x.id === id);
      if (!confirm(`确定删除维修工单「${r.id} - ${r.equipmentName}」吗？${["pending", "repairing"].includes(r.status) ? "（该工单进行中，删除后设备将恢复可用）" : ""}`)) return;
      try {
        await Repairs.remove(id);
        state.list = state.list.filter((x) => x.id !== id);
        showToast("工单已删除");
        renderStats();
        renderList();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

function formatDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("zh-CN");
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
      minute: "2-digit"
    });
  } catch {
    return "-";
  }
}

async function renderAuditHistory(containerId, { objectType, objectId, onRefresh }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const logs = await AuditLogs.list({ objectType, objectId, limit: 50 });
    if (!logs || !logs.length) {
      container.innerHTML = `<div class="audit-empty">暂无操作记录</div>`;
      return;
    }

    container.innerHTML = logs
      .map((log) => {
        const canRevert = log.reversible && !log.reverted;
        return `
          <div class="audit-item" data-id="${log.id}">
            <div class="audit-dot"></div>
            <div class="audit-content">
              <div class="audit-head">
                <span class="audit-action">${escapeHtml(log.actionLabel || log.action)}</span>
                <span class="audit-time">${formatDateTime(log.timestamp)}</span>
              </div>
              ${log.summary ? `<div class="audit-summary">${escapeHtml(log.summary)}</div>` : ""}
              ${log.detail ? `<div class="audit-detail">${escapeHtml(log.detail)}</div>` : ""}
              ${canRevert ? `<button class="audit-revert ghost small" data-log-id="${log.id}">撤销</button>` : ""}
              ${log.reverted ? `<span class="audit-reverted">已撤销</span>` : ""}
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".audit-revert").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const logId = btn.dataset.logId;
        try {
          await AuditLogs.revert(logId);
          showToast("操作已撤销");
          if (onRefresh) {
            await onRefresh();
          } else {
            await renderAuditHistory(containerId, { objectType, objectId, onRefresh });
          }
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="audit-empty">加载操作历史失败：${escapeHtml(err.message)}</div>`;
  }
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
  setTimeout(() => form.faultDescription?.focus(), 50);
}

function closeModal() {
  modal.classList.add("hidden");
  state.editingId = null;
  form.reset();
}

function openCreate(preselectedEquipmentId) {
  state.editingId = null;
  modalTitle.textContent = "新建维修工单";
  form.reset();
  renderEquipmentOptions();
  form.status.value = "pending";
  form.liability.value = "company";
  form.sendTime.value = new Date().toISOString().slice(0, 10);
  $("sourceInfoRow").style.display = "none";
  if (preselectedEquipmentId) {
    form.equipmentId.value = preselectedEquipmentId;
  }
  openModal();
}

function openEdit(id) {
  const r = state.list.find((x) => x.id === id);
  if (!r) return;
  state.editingId = id;
  modalTitle.textContent = "编辑维修工单";
  renderEquipmentOptions();

  if (!state.equipmentList.some((e) => e.id === r.equipmentId)) {
    const opt = document.createElement("option");
    opt.value = r.equipmentId;
    opt.textContent = `${r.equipmentName} (${r.equipmentId})`;
    equipmentSelect.insertBefore(opt, equipmentSelect.firstChild);
  }

  form.id.value = r.id;
  form.equipmentId.value = r.equipmentId;
  form.faultDescription.value = r.faultDescription;
  form.sendTime.value = r.sendTime || "";
  form.expectedReturn.value = r.expectedReturn || "";
  form.repairCost.value = r.repairCost != null ? r.repairCost : "";
  form.actualRepairCost.value = r.actualRepairCost != null ? r.actualRepairCost : "";
  form.status.value = r.status;
  form.liability.value = r.liability || "company";
  form.customerAmount.value = r.customerAmount != null ? r.customerAmount : "";
  form.orderId.value = r.orderId || "";
  form.note.value = r.note || "";
  form.id.readOnly = true;
  form.equipmentId.disabled = true;

  const sourceInfoRow = $("sourceInfoRow");
  if (r.source && r.source !== "manual") {
    sourceInfoRow.style.display = "";
    form.sourceLabel.value = REPAIR_SOURCE_LABELS[r.source] || r.source;
    form.sourceId.value = r.sourceId || "";
  } else {
    sourceInfoRow.style.display = "none";
  }

  renderAuditHistory("auditHistoryList", { objectType: "repair", objectId: id });

  openModal();
}

async function submitForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.faultDescription = data.faultDescription?.trim();
  data.orderId = data.orderId?.trim();

  if (!data.equipmentId) {
    showToast("请选择维修设备", "error");
    return;
  }
  if (!data.faultDescription) {
    showToast("请填写故障描述", "error");
    return;
  }
  if (data.repairCost !== "") {
    data.repairCost = Number(data.repairCost);
  }
  if (data.actualRepairCost !== "") {
    data.actualRepairCost = Number(data.actualRepairCost);
  }
  if (data.customerAmount !== "") {
    data.customerAmount = Number(data.customerAmount);
  }

  try {
    if (state.editingId) {
      const { id, equipmentId, sourceLabel, ...rest } = data;
      const updated = await Repairs.update(state.editingId, rest);
      const idx = state.list.findIndex((x) => x.id === state.editingId);
      if (idx !== -1) state.list[idx] = updated;

      const eq = state.equipmentList.find((e) => e.id === updated.equipmentId);
      if (eq) eq.condition = ["pending", "repairing"].includes(updated.status) ? "repair" : "available";

      showToast("工单已更新");
    } else {
      const created = await Repairs.create(data);
      state.list.unshift(created);
      const eq = state.equipmentList.find((e) => e.id === created.equipmentId);
      if (eq) eq.condition = "repair";
      showToast(`维修工单「${created.id}」已创建`);
    }
    renderStats();
    renderList();
    closeModal();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function load() {
  try {
    const [repairs, equipment] = await Promise.all([Repairs.list(), Equipment.list()]);
    state.list = repairs;
    state.equipmentList = equipment;
    renderStats();
    renderList();
  } catch (err) {
    showToast(err.message, "error");
  }
}

$("addBtn").addEventListener("click", () => openCreate());
$("closeModal").addEventListener("click", closeModal);
$("cancelBtn").addEventListener("click", closeModal);
$("submitBtn").addEventListener("click", submitForm);
$("reloadBtn").addEventListener("click", load);

searchEl.addEventListener("input", (e) => {
  state.filters.search = e.target.value;
  renderList();
});
statusFilter.addEventListener("change", (e) => {
  state.filters.status = e.target.value;
  renderList();
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !modal.classList.contains("hidden")) submitForm();
});

const params = new URLSearchParams(location.search);
const equipmentParam = params.get("equipment");
const idParam = params.get("id");
if (equipmentParam) {
  load().then(() => openCreate(equipmentParam));
} else if (idParam) {
  load().then(() => openEdit(idParam));
} else {
  load();
}
