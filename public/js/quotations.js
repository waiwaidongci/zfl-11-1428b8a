import { Equipment, Quotations, Customers, showToast, overlap } from "./api.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let allEquipment = [];
let allQuotations = [];
let allCustomers = [];
let allOrders = [];

const selectedItems = new Set();
const depositOverrides = {};
let editingId = null;
let currentPreview = null;
let currentDetailId = null;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusBadgeClass(status) {
  switch (status) {
    case "草稿": return "draft";
    case "已确认": return "confirmed";
    case "已转订单": return "converted";
    case "已取消": return "canceled";
    default: return "";
  }
}

function renderStats() {
  const counts = {
    报价总数: allQuotations.length,
    草稿: allQuotations.filter((q) => q.status === "草稿").length,
    已确认: allQuotations.filter((q) => q.status === "已确认").length,
    已转订单: allQuotations.filter((q) => q.status === "已转订单").length
  };
  $("#stats").innerHTML = Object.entries(counts)
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`)
    .join("");
}

function renderGrid() {
  const search = $("#search").value.trim().toLowerCase();
  const status = $("#statusFilter").value;

  let visible = allQuotations.filter((q) => {
    if (status && q.status !== status) return false;
    if (search) {
      const hay = [q.id, q.customer, q.note, ...(q.itemIds || [])]
        .join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  visible.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  $("#countInfo").textContent = `共 ${visible.length} 张`;

  if (!visible.length) {
    $("#quoteGrid").innerHTML = `<div style="padding:30px;text-align:center;color:var(--muted);grid-column:1/-1">暂无匹配报价单</div>`;
    return;
  }

  const eqMap = new Map(allEquipment.map((e) => [e.id, e]));

  $("#quoteGrid").innerHTML = visible
    .map((q) => {
      const tags = (q.itemIds || [])
        .map((id) => {
          const e = eqMap.get(id);
          return `<span class="item-tag">${escapeHtml(e ? `${e.id} ${e.name}` : id)}</span>`;
        })
        .join("");

      const hasTotal = q.summary && typeof q.summary.grandTotal === "number";
      const totalHtml = hasTotal
        ? `<span class="quote-total">¥${fmtMoney(q.summary.grandTotal)}</span>`
        : `<span class="quote-counts">${q.itemIds?.length || 0} 台 · ${q.rentalDays || 0} 天</span>`;

      const canEdit = q.status !== "已转订单";
      const canDelete = q.status !== "已转订单";
      const canConvert = q.status === "已确认";

      return `<article class="quote-card" data-id="${escapeHtml(q.id)}">
        <div class="quote-head">
          <h3>${escapeHtml(q.customer || "（未填客户）")}</h3>
          <span class="quote-id">${escapeHtml(q.id)}</span>
        </div>
        <div class="quote-dates">
          ${escapeHtml(q.startDate || "—")} 至 ${escapeHtml(q.endDate || "—")}
          ${q.rentalDays ? ` · 共 ${q.rentalDays} 天` : ""}
        </div>
        <div class="quote-items">${tags || '<span class="meta">未选设备</span>'}</div>
        <div class="quote-summary">
          ${totalHtml}
          <span class="badge ${statusBadgeClass(q.status)}">${escapeHtml(q.status)}</span>
        </div>
        ${q.note ? `<div class="meta">📝 ${escapeHtml(q.note)}</div>` : ""}
        <div class="quote-actions">
          <button class="view-btn ghost small" data-id="${escapeHtml(q.id)}">查看</button>
          ${canEdit ? `<button class="edit-btn ghost small" data-id="${escapeHtml(q.id)}">编辑</button>` : ""}
          ${canConvert ? `<button class="convert-btn secondary small" data-id="${escapeHtml(q.id)}">转订单</button>` : ""}
          ${canDelete ? `<button class="delete-btn danger small" data-id="${escapeHtml(q.id)}">删除</button>` : ""}
        </div>
      </article>`;
    })
    .join("");

  $$(".quote-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      openDetail(card.dataset.id);
    });
  });
  $$(".view-btn").forEach((b) => b.onclick = (e) => { e.stopPropagation(); openDetail(b.dataset.id); });
  $$(".edit-btn").forEach((b) => b.onclick = (e) => { e.stopPropagation(); openEdit(b.dataset.id); });
  $$(".convert-btn").forEach((b) => b.onclick = (e) => { e.stopPropagation(); handleConvertClick(b.dataset.id); });
  $$(".delete-btn").forEach((b) => b.onclick = (e) => { e.stopPropagation(); handleDeleteClick(b.dataset.id); });
}

function renderItems() {
  const start = $("#startDateInput").value;
  const end = $("#endDateInput").value;
  const category = $("#itemCategoryFilter").value;
  let visible = category ? allEquipment.filter((e) => e.category === category) : [...allEquipment];

  if (!visible.length) {
    $("#items").innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);grid-column:1/-1">暂无设备，请到 <a href="/equipment" style="color:var(--green)">设备管理</a> 入库</div>`;
    renderSelection();
    return;
  }

  $("#items").innerHTML = visible
    .map((item) => {
      const isRepair = item.condition === "repair";
      const cls = "item " + (selectedItems.has(item.id) ? "selected " : "");
      let statusText = item.location;
      if (isRepair) statusText = "维修中";

      return `<div class="${cls}" data-id="${escapeHtml(item.id)}" title="点击选择">
        <b>${escapeHtml(item.name)}</b>
        <div class="meta">${escapeHtml(item.id)} · ${escapeHtml(item.category)} · ${escapeHtml(item.spec || "—")}</div>
        <div class="${isRepair ? "repair" : "meta"}">
          ${isRepair ? '<span class="badge repair">维修中</span> ' : '<span class="badge available">在库</span> '}
          ${escapeHtml(statusText)}
        </div>
      </div>`;
    })
    .join("");

  $$(".item").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      if (selectedItems.has(id)) {
        selectedItems.delete(id);
        delete depositOverrides[id];
      } else {
        selectedItems.add(id);
      }
      renderSelection();
      renderItems();
      schedulePreview();
    };
  });

  renderSelection();
}

function renderSelection() {
  $("#selection").textContent = selectedItems.size
    ? `已选择 ${selectedItems.size} 台：${[...selectedItems].join("、")}`
    : "还没有选择设备（点击卡片勾选）";
}

function renderCategoryFilters() {
  const categories = [...new Set(allEquipment.map((e) => e.category))];
  $("#itemCategoryFilter").innerHTML =
    '<option value="">全部类别</option>' +
    categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
}

function renderCustomerOptions() {
  $("#customerSelect").innerHTML =
    '<option value="">— 选择已有客户 —</option>' +
    allCustomers
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
      .join("");
}

function handleCustomerChange() {
  const custId = $("#customerSelect").value;
  if (!custId) {
    $("#customerInfo").classList.add("hidden");
    return;
  }
  const cust = allCustomers.find((c) => c.id === custId);
  if (cust) {
    $("#customerNameInput").value = cust.name;
    $("#infoContact").textContent = cust.contact || "—";
    $("#infoPhone").textContent = cust.phone || "—";
    $("#infoActivity").textContent = cust.activityType || "—";
    $("#customerInfo").classList.remove("hidden");
    if (cust.activityType && !$("#noteInput").value) {
      $("#noteInput").value = cust.activityType;
    }
    schedulePreview();
  }
}

function startNewCustomer() {
  $("#customerSelect").value = "";
  $("#customerNameInput").value = "";
  $("#customerNameInput").focus();
  $("#customerInfo").classList.add("hidden");
}

function handleDiscountPreset() {
  const v = $("#discountPreset").value;
  if (v !== "custom") {
    $("#discountInput").value = v;
    schedulePreview();
  }
}

function handleDiscountInput() {
  const v = Number($("#discountInput").value || 0);
  const presets = ["0", "0.05", "0.1", "0.15", "0.2", "0.3"];
  $("#discountPreset").value = presets.includes(String(v)) ? String(v) : "custom";
  schedulePreview();
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 200);
}

async function runPreview() {
  const start = $("#startDateInput").value;
  const end = $("#endDateInput").value;
  const itemIds = [...selectedItems];
  const discount = Number($("#discountInput").value || 0);

  if (!start || !end || !itemIds.length) {
    $("#previewEmpty").classList.remove("hidden");
    $("#previewContent").classList.add("hidden");
    $("#breakdownCard").classList.add("hidden");
    currentPreview = null;
    return;
  }

  try {
    const summary = await Quotations.preview({
      itemIds, startDate: start, endDate: end, discount,
      depositOverride: { ...depositOverrides }
    });
    currentPreview = summary;
    renderPreview(summary);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderPreview(summary) {
  $("#previewEmpty").classList.add("hidden");
  $("#previewContent").classList.remove("hidden");
  $("#breakdownCard").classList.remove("hidden");

  $("#sumDays").textContent = summary.rentalDays;
  $("#sumItems").textContent = summary.itemBreakdown.length;
  $("#sumSubtotal").textContent = fmtMoney(summary.subtotal);
  $("#sumDiscount").textContent = fmtMoney(summary.discountAmount);
  $("#sumDiscounted").textContent = fmtMoney(summary.discounted);
  $("#sumDeposit").textContent = fmtMoney(summary.totalDeposit);
  $("#sumTotal").textContent = fmtMoney(summary.grandTotal);

  $("#breakdownBody").innerHTML = summary.itemBreakdown
    .map((it) => {
      const curDeposit = (depositOverrides[it.id] && depositOverrides[it.id].deposit != null)
        ? depositOverrides[it.id].deposit
        : it.deposit;
      const isOverridden = depositOverrides[it.id] && depositOverrides[it.id].deposit != null && depositOverrides[it.id].deposit !== it.deposit;
      return `
      <div class="breakdown-item" data-item-id="${escapeHtml(it.id)}">
        <div class="bd-head">
          <span>${escapeHtml(it.name)} <span class="meta">(${escapeHtml(it.id)})</span></span>
          <span class="bd-daily">¥${fmtMoney(it.subtotal)}</span>
        </div>
        <div class="bd-sub">
          <span>¥${fmtMoney(it.daily)} × ${summary.rentalDays}天</span>
        </div>
        <div class="bd-deposit-row">
          <label class="bd-deposit-label">押金</label>
          <div class="bd-deposit-input-wrap">
            <span class="bd-deposit-prefix">¥</span>
            <input type="number" min="0" step="10"
              class="bd-deposit-input ${isOverridden ? 'overridden' : ''}"
              data-item-id="${escapeHtml(it.id)}"
              data-default="${it.deposit}"
              value="${curDeposit}"
              title="默认押金 ¥${fmtMoney(it.deposit)}${isOverridden ? '（已修改）' : ''}">
            ${isOverridden ? `<button class="bd-deposit-reset ghost small" data-item-id="${escapeHtml(it.id)}" title="恢复默认押金 ¥${fmtMoney(it.deposit)}">↺</button>` : ''}
          </div>
        </div>
      </div>
    `})
    .join("");

  $$(".bd-deposit-input").forEach((inp) => {
    inp.onchange = () => {
      const id = inp.dataset.itemId;
      const defVal = Number(inp.dataset.default || 0);
      const val = Number(inp.value);
      if (Number.isNaN(val) || val < 0) {
        depositOverrides[id] = { deposit: defVal };
        inp.value = defVal;
        showToast("押金不能为负数", "error");
      } else {
        depositOverrides[id] = { deposit: val };
      }
      inp.classList.toggle("overridden", depositOverrides[id].deposit !== defVal);
      schedulePreview();
    };
    inp.oninput = () => {
      const id = inp.dataset.itemId;
      const defVal = Number(inp.dataset.default || 0);
      const val = Number(inp.value);
      inp.classList.toggle("overridden", !Number.isNaN(val) && val >= 0 && val !== defVal);
    };
  });

  $$(".bd-deposit-reset").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.itemId;
      delete depositOverrides[id];
      schedulePreview();
    };
  });
}

function resetEditForm() {
  editingId = null;
  $("#quoteForm").reset();
  selectedItems.clear();
  Object.keys(depositOverrides).forEach((k) => delete depositOverrides[k]);
  currentPreview = null;
  $("#modalTitle").textContent = "新建报价单";
  $("#statusSelect").innerHTML = '<option value="草稿">草稿</option><option value="已确认">已确认</option>';
  $("#previewEmpty").classList.remove("hidden");
  $("#previewContent").classList.add("hidden");
  $("#breakdownCard").classList.add("hidden");
  $("#customerInfo").classList.add("hidden");
  $("#customerSelect").value = "";
  $("#itemCategoryFilter").value = "";
}

async function openEdit(id = null) {
  resetEditForm();
  renderItems();
  $("#editModal").classList.remove("hidden");

  if (id) {
    try {
      const q = await Quotations.get(id);
      editingId = id;
      $("#modalTitle").textContent = `编辑报价单 ${q.id}`;

      const form = $("#quoteForm");
      form.id.value = q.id;
      $("#customerNameInput").value = q.customer || "";
      $("#startDateInput").value = q.startDate || "";
      $("#endDateInput").value = q.endDate || "";
      $("#discountInput").value = q.discount || 0;
      handleDiscountPreset();
      $("#noteInput").value = q.note || "";
      $("#statusSelect").value = q.status === "已取消" ? "草稿" : (q.status === "已转订单" ? "草稿" : (q.status || "草稿"));

      if (q.status === "已转订单") {
        $("#statusSelect").innerHTML = '<option value="已转订单">已转订单（不可修改）</option>';
        $("#statusSelect").value = "已转订单";
        $("#statusSelect").disabled = true;
      } else {
        $("#statusSelect").disabled = false;
      }

      selectedItems.clear();
      (q.itemIds || []).forEach((iid) => selectedItems.add(iid));

      if (q.depositOverride && typeof q.depositOverride === "object") {
        Object.keys(q.depositOverride).forEach((iid) => {
          depositOverrides[iid] = { ...q.depositOverride[iid] };
        });
      }

      const cust = allCustomers.find((c) => c.name === q.customer);
      if (cust) {
        $("#customerSelect").value = cust.id;
        $("#infoContact").textContent = cust.contact || "—";
        $("#infoPhone").textContent = cust.phone || "—";
        $("#infoActivity").textContent = cust.activityType || "—";
        $("#customerInfo").classList.remove("hidden");
      }

      renderItems();
      if (q.summary) renderPreview(q.summary);
    } catch (err) {
      showToast(err.message, "error");
      $("#editModal").classList.add("hidden");
    }
  }
}

function closeEditModal() {
  $("#editModal").classList.add("hidden");
  editingId = null;
}

async function submitQuote() {
  const form = $("#quoteForm");
  const data = Object.fromEntries(new FormData(form).entries());
  data.itemIds = [...selectedItems];

  Object.keys(depositOverrides).forEach((iid) => {
    if (!data.itemIds.includes(iid)) delete depositOverrides[iid];
  });
  data.depositOverride = { ...depositOverrides };

  if (!data.customer || !data.customer.trim()) {
    showToast("请填写客户名称", "error");
    return;
  }
  if (!data.startDate || !data.endDate) {
    showToast("请填写完整租期", "error");
    return;
  }
  if (!data.itemIds.length) {
    showToast("请至少选择一件设备", "error");
    return;
  }
  if (new Date(data.endDate) < new Date(data.startDate)) {
    showToast("结束日期不能早于开始日期", "error");
    return;
  }

  try {
    let result;
    if (editingId) {
      result = await Quotations.update(editingId, data);
      showToast(`报价单 ${result.id} 已更新`);
    } else {
      result = await Quotations.create(data);
      showToast(`报价单 ${result.id} 创建成功`);
    }
    closeEditModal();
    await load();
    openDetail(result.id);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function openDetail(id) {
  currentDetailId = id;
  $("#detailModal").classList.remove("hidden");
  $("#detailTitle").textContent = "报价单详情";
  $("#detailBody").innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中…</div>';

  try {
    const [q, check] = await Promise.all([
      Quotations.get(id),
      Quotations.checkConvert(id).catch(() => null)
    ]);
    renderDetail(q, check);
  } catch (err) {
    $("#detailBody").innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderDetail(q, check) {
  const summary = q.summary || {};
  const bdRows = (summary.itemBreakdown || [])
    .map((it, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(it.id)}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(it.spec || "—")}</td>
        <td class="num">${escapeHtml(it.category)}</td>
        <td class="num">¥${fmtMoney(it.daily)}</td>
        <td class="num">¥${fmtMoney(it.subtotal)}</td>
        <td class="num">¥${fmtMoney(it.deposit)}</td>
      </tr>
    `)
    .join("") || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">暂无设备明细</td></tr>';

  let alertHtml = "";
  if (check) {
    if (!check.convertible) {
      const issues = [];
      if (check.reason) issues.push(`<li>${escapeHtml(check.reason)}</li>`);
      if (check.equipmentCheck) {
        (check.equipmentCheck.repair || []).forEach((r) => issues.push(`<li>⚠️ 维修中：${escapeHtml(r.id)} ${escapeHtml(r.name)}</li>`));
        (check.equipmentCheck.conflicts || []).forEach((c) => issues.push(`<li>⚠️ 租期冲突：${escapeHtml(c.id)} ${escapeHtml(c.name)} → ${escapeHtml(c.conflictOrderCustomer || c.conflictOrderId || "")} ${escapeHtml(c.conflictRange || "")}</li>`));
        (check.equipmentCheck.missing || []).forEach((m) => issues.push(`<li>⚠️ 设备不存在：${escapeHtml(m)}</li>`));
      }
      alertHtml = `<div class="conflict-alert">
        <div class="ca-title">❌ 无法转订单</div>
        <ul>${issues.join("")}</ul>
        <div style="margin-top:8px;font-size:12px">请修改报价单或处理冲突后再操作。</div>
      </div>`;
    } else {
      alertHtml = `<div class="convert-ok">✅ 当前设备状态正常，可以转订单</div>`;
    }
  }

  let convertedLink = "";
  if (q.status === "已转订单" && q.convertedOrderId) {
    convertedLink = `<div class="convert-ok" style="margin-top:8px">
      📦 已转订单：<a href="/" style="color:var(--green);font-weight:600">${escapeHtml(q.convertedOrderId)}</a>
    </div>`;
  }

  $("#detailBody").innerHTML = `
    ${alertHtml}
    <div class="detail-section">
      <div class="q-id">${escapeHtml(q.id)}</div>
      <h3>${escapeHtml(q.customer || "（未填客户）")}</h3>
      <span class="badge ${statusBadgeClass(q.status)}">${escapeHtml(q.status)}</span>
      ${convertedLink}
    </div>

    <table class="info-table">
      <tr>
        <th>联系人</th>
        <td>${escapeHtml(q.customerContact || "—")}</td>
        <th>电话</th>
        <td>${escapeHtml(q.customerPhone || "—")}</td>
      </tr>
      <tr>
        <th>租期开始</th>
        <td>${escapeHtml(q.startDate || "—")}</td>
        <th>租期结束</th>
        <td>${escapeHtml(q.endDate || "—")}${q.rentalDays ? ` · ${q.rentalDays}天` : ""}</td>
      </tr>
      <tr>
        <th>常用活动</th>
        <td>${escapeHtml(q.customerActivity || "—")}</td>
        <th>折扣</th>
        <td>${q.discount ? (Number(q.discount) <= 1 ? `${Math.round((1 - Number(q.discount)) * 100)}% 折扣` : `减 ¥${Number(q.discount)}`) : "无折扣"}</td>
      </tr>
      <tr>
        <th>备注</th>
        <td colspan="3">${escapeHtml(q.note || "—")}</td>
      </tr>
    </table>

    <div class="detail-subtitle">设备明细 & 报价</div>
    <table class="breakdown-table">
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th style="width:90px">编号</th>
          <th>名称</th>
          <th>规格</th>
          <th style="width:70px">类别</th>
          <th style="width:90px">日租</th>
          <th style="width:100px">小计</th>
          <th style="width:90px">押金</th>
        </tr>
      </thead>
      <tbody>${bdRows}</tbody>
      ${summary.rentalDays ? `
      <tfoot>
        <tr>
          <td colspan="6" style="text-align:right">租期</td>
          <td colspan="2" class="num">${summary.rentalDays} 天</td>
        </tr>
        <tr>
          <td colspan="6" style="text-align:right">租金小计</td>
          <td colspan="2" class="num">¥${fmtMoney(summary.subtotal)}</td>
        </tr>
        ${summary.discountAmount ? `<tr>
          <td colspan="6" style="text-align:right;color:var(--red)">优惠折扣</td>
          <td colspan="2" class="num" style="color:var(--red)">-¥${fmtMoney(summary.discountAmount)}</td>
        </tr>` : ""}
        <tr>
          <td colspan="6" style="text-align:right">折后租金</td>
          <td colspan="2" class="num">¥${fmtMoney(summary.discounted)}</td>
        </tr>
        <tr>
          <td colspan="6" style="text-align:right">押金合计</td>
          <td colspan="2" class="num">¥${fmtMoney(summary.totalDeposit)}</td>
        </tr>
        <tr>
          <td colspan="6" style="text-align:right;font-size:15px">应收合计</td>
          <td colspan="2" class="num total-amount">¥${fmtMoney(summary.grandTotal)}</td>
        </tr>
      </tfoot>` : ""}
    </table>
  `;

  const canEdit = q.status !== "已转订单";
  const canConvert = q.status === "已确认";
  const canDelete = q.status !== "已转订单";

  const actions = [];
  if (canEdit) actions.push(`<button class="editDetailBtn ghost">✏️ 编辑</button>`);
  if (canConvert && check && check.convertible) actions.push(`<button class="convertDetailBtn secondary">📦 一键转订单</button>`);
  if (canConvert && check && !check.convertible) actions.push(`<button class="convertDetailBtn secondary" disabled style="opacity:.5;cursor:not-allowed">📦 无法转订单</button>`);
  if (q.status === "草稿") actions.push(`<button class="confirmDetailBtn">✅ 确认报价</button>`);
  if (q.status === "草稿" || q.status === "已确认") actions.push(`<button class="cancelDetailBtn danger">🚫 取消报价</button>`);
  if (canDelete) actions.push(`<button class="deleteDetailBtn ghost">🗑 删除</button>`);
  actions.push(`<button id="detailCloseBtn" class="ghost">关闭</button>`);

  $("#detailActions").innerHTML = actions.join("");

  const editBtn = $(".editDetailBtn");
  const convertBtn = $(".convertDetailBtn");
  const confirmBtn = $(".confirmDetailBtn");
  const cancelBtn = $(".cancelDetailBtn");
  const deleteBtn = $(".deleteDetailBtn");
  const closeBtn = $("#detailCloseBtn");

  if (editBtn) editBtn.onclick = () => { closeDetail(); openEdit(q.id); };
  if (convertBtn && !convertBtn.disabled) convertBtn.onclick = () => handleConvertClick(q.id);
  if (confirmBtn) confirmBtn.onclick = async () => {
    if (!confirm("确认将此报价单标记为「已确认」？确认后即可转订单。")) return;
    try {
      await Quotations.update(q.id, { status: "已确认" });
      showToast("报价单已确认");
      await load();
      openDetail(q.id);
    } catch (err) { showToast(err.message, "error"); }
  };
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!confirm("确定取消此报价单？取消后不能恢复。")) return;
    try {
      await Quotations.update(q.id, { status: "已取消" });
      showToast("报价单已取消");
      await load();
      openDetail(q.id);
    } catch (err) { showToast(err.message, "error"); }
  };
  if (deleteBtn) deleteBtn.onclick = () => handleDeleteClick(q.id);
  if (closeBtn) closeBtn.onclick = closeDetail;
}

function closeDetail() {
  $("#detailModal").classList.add("hidden");
  currentDetailId = null;
}

function handleDeleteClick(id) {
  const q = allQuotations.find((x) => x.id === id);
  if (!q) return;
  if (q.status === "已转订单") {
    showToast("已转订单的报价单不能删除", "error");
    return;
  }
  showConfirm(
    `删除报价单 ${id}？`,
    `客户：${q.customer || "（未填）"}\n将永久删除此报价单，此操作不可恢复。`,
    async () => {
      try {
        await Quotations.remove(id);
        showToast(`报价单 ${id} 已删除`);
        if (currentDetailId === id) closeDetail();
        await load();
      } catch (err) { showToast(err.message, "error"); }
    }
  );
}

function handleConvertClick(id) {
  showConfirm(
    `将报价单 ${id} 转为租赁订单？`,
    "系统将重新校验设备维修状态和时间冲突。\n校验通过后将自动创建订单，并把报价单标记为「已转订单」。",
    async () => {
      try {
        const result = await Quotations.convert(id);
        showToast(`✅ 转换成功！已创建订单 ${result.order.id}`);
        if (currentDetailId === id) {
          openDetail(id);
        }
        await load();
        setTimeout(() => {
          if (confirm(`已生成订单 ${result.order.id}，是否跳转到订单中心查看？`)) {
            window.location.href = "/";
          }
        }, 300);
      } catch (err) {
        showToast(err.message, "error");
        if (currentDetailId === id) openDetail(id);
      }
    },
    "📦 确认转订单"
  );
}

function showConfirm(title, body, onOk, okText = "确认") {
  $("#confirmTitle").textContent = title;
  $("#confirmBody").innerHTML = body.split("\n").map((l) => `<p style="margin:6px 0">${escapeHtml(l)}</p>`).join("");
  $("#confirmOkBtn").textContent = okText;
  $("#confirmModal").classList.remove("hidden");

  const close = () => $("#confirmModal").classList.add("hidden");
  $("#closeConfirmModal").onclick = close;
  $("#confirmCancelBtn").onclick = close;
  $("#confirmOkBtn").onclick = async () => {
    close();
    await onOk();
  };
}

async function load() {
  try {
    [allEquipment, allQuotations, allCustomers, allOrders] = await Promise.all([
      Equipment.list(),
      Quotations.list(),
      Customers.list(),
      import("./api.js").then((m) => (typeof m.Orders !== "undefined" ? m.Orders.list() : fetch("/api/orders").then((r) => r.json())))
    ]);
    renderCategoryFilters();
    renderCustomerOptions();
    renderStats();
    renderGrid();
  } catch (err) {
    showToast(err.message, "error");
  }
}

$("#addBtn").onclick = () => openEdit();
$("#reloadBtn").onclick = load;
$("#search").addEventListener("input", renderGrid);
$("#statusFilter").addEventListener("change", renderGrid);

$("#closeEditModal").onclick = closeEditModal;
$("#cancelBtn").onclick = closeEditModal;
$("#submitBtn").onclick = submitQuote;
$("#previewBtn").onclick = runPreview;

$("#customerSelect").addEventListener("change", handleCustomerChange);
$("#newCustomerBtn").onclick = startNewCustomer;
$("#discountPreset").addEventListener("change", handleDiscountPreset);
$("#discountInput").addEventListener("input", handleDiscountInput);
$("#startDateInput").addEventListener("input", schedulePreview);
$("#endDateInput").addEventListener("input", schedulePreview);
$("#customerNameInput").addEventListener("input", () => {
  $("#customerSelect").value = "";
  $("#customerInfo").classList.add("hidden");
});
$("#itemCategoryFilter").addEventListener("change", renderItems);

$("#closeDetailModal").onclick = closeDetail;

$("#editModal").addEventListener("click", (e) => {
  if (e.target.id === "editModal") closeEditModal();
});
$("#detailModal").addEventListener("click", (e) => {
  if (e.target.id === "detailModal") closeDetail();
});
$("#confirmModal").addEventListener("click", (e) => {
  if (e.target.id === "confirmModal") $("#confirmModal").classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("#confirmModal").classList.add("hidden");
    if (!$("#editModal").classList.contains("hidden")) closeEditModal();
    else if (!$("#detailModal").classList.contains("hidden")) closeDetail();
  }
});

load();
