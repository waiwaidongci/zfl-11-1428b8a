import { Customers, showToast } from "./api.js";

const state = {
  list: [],
  editingId: null,
  filters: {
    search: "",
    activityType: ""
  }
};

const $ = (id) => document.getElementById(id);
const grid = $("customerGrid");
const statsEl = $("stats");
const countInfo = $("countInfo");
const activityFilter = $("activityFilter");
const searchEl = $("search");
const modal = $("modal");
const custForm = $("custForm");
const modalTitle = $("modalTitle");

function renderStats() {
  const total = state.list.length;
  const activityTypes = new Set(state.list.map((c) => c.activityType).filter(Boolean)).size;
  const hasContact = state.list.filter((c) => c.contact || c.phone).length;

  statsEl.innerHTML = `
    <div class="stat"><span>客户总数</span><strong>${total}</strong></div>
    <div class="stat"><span>活动类型</span><strong style="color:var(--blue)">${activityTypes}</strong></div>
    <div class="stat"><span>有联系方式</span><strong style="color:var(--green)">${hasContact}</strong></div>
    <div class="stat"><span>无备注</span><strong style="color:var(--muted)">${total - state.list.filter((c) => c.note).length}</strong></div>
  `;
}

function renderActivityOptions() {
  const types = [...new Set(state.list.map((c) => c.activityType).filter(Boolean))];
  activityFilter.innerHTML =
    '<option value="">全部活动类型</option>' +
    types.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
  activityFilter.value = state.filters.activityType;
}

function getFiltered() {
  const q = state.filters.search.trim().toLowerCase();
  return state.list.filter((c) => {
    if (state.filters.activityType && c.activityType !== state.filters.activityType) return false;
    if (q) {
      const hay = `${c.name} ${c.contact} ${c.phone} ${c.activityType} ${c.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderList() {
  const data = getFiltered();
  countInfo.textContent = `显示 ${data.length} / 共 ${state.list.length} 位`;

  if (!data.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h4>暂无匹配客户</h4>
        <p>试试调整筛选条件，或点击右上角"新增客户"添加</p>
      </div>`;
    return;
  }

  grid.innerHTML = data
    .map(
      (c) => `
    <article class="cust-card" data-id="${c.id}">
      <div class="cust-head">
        <div>
          <h4>${escapeHtml(c.name)}</h4>
          ${
            c.activityType
              ? `<span class="act-pill act-${escapeCss(c.activityType)}">${escapeHtml(c.activityType)}</span>`
              : ""
          }
        </div>
        <span class="cust-id">${escapeHtml(c.id)}</span>
      </div>
      <div class="cust-info">
        ${
          c.contact
            ? `<div class="info-row"><span class="info-label">联系人</span><span>${escapeHtml(c.contact)}</span></div>`
            : ""
        }
        ${
          c.phone
            ? `<div class="info-row"><span class="info-label">电话</span><span>${escapeHtml(c.phone)}</span></div>`
            : ""
        }
      </div>
      <div class="cust-note">${c.note ? escapeHtml(c.note) : '<span class="no-note">暂无备注</span>'}</div>
      <div class="cust-foot">
        <div class="cust-actions">
          <button class="secondary small" data-action="edit">编辑</button>
          <button class="danger small" data-action="delete">删除</button>
        </div>
      </div>
    </article>
  `
    )
    .join("");

  grid.querySelectorAll(".cust-card").forEach((card) => {
    const id = card.dataset.id;
    const editBtn = card.querySelector('[data-action="edit"]');
    const delBtn = card.querySelector('[data-action="delete"]');

    editBtn.addEventListener("click", () => openEdit(id));
    delBtn.addEventListener("click", async () => {
      const cust = state.list.find((x) => x.id === id);
      if (!confirm(`确定删除客户「${cust.name} (${id})」吗？`)) return;
      try {
        await Customers.remove(id);
        state.list = state.list.filter((x) => x.id !== id);
        showToast("客户已删除");
        renderStats();
        renderActivityOptions();
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
  setTimeout(() => custForm.name?.focus(), 50);
}

function closeModal() {
  modal.classList.add("hidden");
  state.editingId = null;
  custForm.reset();
}

function openEdit(id) {
  const cust = state.list.find((x) => x.id === id);
  if (!cust) return;
  state.editingId = id;
  modalTitle.textContent = "编辑客户";
  custForm.id.value = cust.id;
  custForm.name.value = cust.name;
  custForm.contact.value = cust.contact || "";
  custForm.phone.value = cust.phone || "";
  custForm.activityType.value = cust.activityType || "";
  custForm.note.value = cust.note || "";
  custForm.id.readOnly = true;
  openModal();
}

function openCreate() {
  state.editingId = null;
  modalTitle.textContent = "新增客户";
  custForm.reset();
  custForm.id.readOnly = false;
  custForm.activityType.value = "";
  openModal();
}

async function submitForm() {
  const data = Object.fromEntries(new FormData(custForm).entries());
  data.name = data.name?.trim();
  if (!data.name) {
    showToast("请填写客户名称", "error");
    return;
  }
  try {
    if (state.editingId) {
      await Customers.update(state.editingId, data);
      const idx = state.list.findIndex((x) => x.id === state.editingId);
      if (idx !== -1) state.list[idx] = { ...state.list[idx], ...data, id: state.editingId };
      showToast("客户信息已更新");
    } else {
      const created = await Customers.create(data);
      state.list.unshift(created);
      showToast(`客户「${created.name}」已添加`);
    }
    renderStats();
    renderActivityOptions();
    renderList();
    closeModal();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function load() {
  try {
    state.list = await Customers.list();
    renderStats();
    renderActivityOptions();
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

searchEl.addEventListener("input", (e) => {
  state.filters.search = e.target.value;
  renderList();
});
activityFilter.addEventListener("change", (e) => {
  state.filters.activityType = e.target.value;
  renderList();
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !modal.classList.contains("hidden")) submitForm();
});

load();
