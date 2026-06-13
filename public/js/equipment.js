import { Equipment, showToast } from "./api.js";

const state = {
  list: [],
  editingId: null,
  filters: {
    search: "",
    category: "",
    condition: ""
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
    .map(
      (e) => `
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
      <div style="margin-bottom:10px">
        ${
          e.condition === "repair"
            ? '<span class="badge repair">维修中</span>'
            : '<span class="badge available">在库可用</span>'
        }
      </div>
      <div class="eq-foot">
        <div class="cond-switch">
          <input type="checkbox" id="c_${e.id}" ${e.condition === "repair" ? "checked" : ""}>
          <label for="c_${e.id}">标记维修</label>
        </div>
        <div class="eq-actions">
          <button class="secondary small" data-action="edit">编辑</button>
          <button class="danger small" data-action="delete">删除</button>
        </div>
      </div>
    </article>
  `
    )
    .join("");

  grid.querySelectorAll(".eq-card").forEach((card) => {
    const id = card.dataset.id;
    const checkbox = card.querySelector('input[type="checkbox"]');
    const editBtn = card.querySelector('[data-action="edit"]');
    const delBtn = card.querySelector('[data-action="delete"]');

    checkbox.addEventListener("change", async () => {
      try {
        const next = checkbox.checked ? "repair" : "available";
        await Equipment.setCondition(id, next);
        const target = state.list.find((x) => x.id === id);
        if (target) target.condition = next;
        showToast(`已标记为「${next === "repair" ? "维修中" : "在库可用"}」`);
        renderStats();
        renderList();
      } catch (err) {
        showToast(err.message, "error");
        await load();
      }
    });

    editBtn.addEventListener("click", () => openEdit(id));
    delBtn.addEventListener("click", async () => {
      const eq = state.list.find((x) => x.id === id);
      if (!confirm(`确定删除设备「${eq.name} (${id})」吗？`)) return;
      try {
        await Equipment.remove(id);
        state.list = state.list.filter((x) => x.id !== id);
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
    state.list = await Equipment.list();
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !modal.classList.contains("hidden")) submitForm();
});

load();
