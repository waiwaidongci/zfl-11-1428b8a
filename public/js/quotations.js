import { Equipment, Quotations, Customers, Packages, showToast, overlap, formatConflictDetails, renderConflictDetailsHtml } from "./api.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let allEquipment = [];
let allQuotations = [];
let allCustomers = [];
let allOrders = [];
let allPackages = [];
let customerFilterFromUrl = "";

const selectedItems = new Set();
const depositOverrides = {};
const selectedPackages = new Set();
const packageItemIssues = {};
let editingId = null;
let currentPreview = null;
let currentDetailId = null;
let allVersions = [];
let currentCompareV1 = null;
let currentCompareV2 = null;
let detailTab = "info";
let pendingLockStartAt = null;
let pendingLockEndAt = null;

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

function versionStatusBadgeClass(status) {
  switch (status) {
    case "pending": return "version-pending";
    case "approved": return "version-approved";
    case "rejected": return "version-rejected";
    case "superseded": return "version-superseded";
    default: return "";
  }
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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
    if (customerFilterFromUrl && (q.customer || "") !== customerFilterFromUrl) return false;
    if (search) {
      const hay = [q.id, q.customer, q.note, ...(q.itemIds || [])]
        .join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  visible.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const countInfo = customerFilterFromUrl
    ? `客户「${escapeHtml(customerFilterFromUrl)}」共 ${visible.length} 张 · <a href="/quotations" style="color:var(--blue)">显示全部</a>`
    : `共 ${visible.length} 张`;
  $("#countInfo").innerHTML = countInfo;

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

      const lockStatus = q.lockStatus || {};
      let lockBadge = "";
      if (lockStatus.locked) {
        const remainHours = Math.ceil(lockStatus.remainingMs / (1000 * 60 * 60));
        const remainText = remainHours < 24
          ? `剩${remainHours}小时`
          : `剩${Math.round(remainHours / 24 * 10) / 10}天`;
        lockBadge = `<span class="badge lock-active" title="设备临时锁定中，有效期至 ${new Date(lockStatus.lockEndAt).toLocaleString('zh-CN')}">🔒 锁定${remainText}</span>`;
      } else if (lockStatus.expired && !lockStatus.neverLocked) {
        lockBadge = `<span class="badge lock-expired" title="曾于 ${new Date(lockStatus.lockStartAt || '').toLocaleString('zh-CN')} 至 ${new Date(lockStatus.lockEndAt || '').toLocaleString('zh-CN')} 锁定过">🔓 已过期</span>`;
      }

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
          ${lockBadge}
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

      const disabledCls = isRepair ? " disabled" : "";
      const title = isRepair ? "维修中，不可选择" : "点击选择";
      return `<div class="${cls}${disabledCls}" data-id="${escapeHtml(item.id)}" data-repair="${isRepair ? 1 : 0}" title="${title}">
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
      const isRepair = el.dataset.repair === "1";
      if (isRepair) {
        showToast("维修中设备不可加入报价单", "error");
        return;
      }
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
  const pkgInfo = selectedPackages.size > 0
    ? ` · 含 ${selectedPackages.size} 个套餐`
    : "";
  $("#selection").textContent = selectedItems.size
    ? `已选择 ${selectedItems.size} 台${pkgInfo}：${[...selectedItems].join("、")}`
    : `还没有选择设备（点击卡片勾选或选择套餐快速添加）${pkgInfo}`;
}

function renderPackagesList() {
  const wrap = $("#packagesList");
  if (!wrap) return;

  if (!allPackages || !allPackages.length) {
    wrap.innerHTML = `<div style="padding:10px;text-align:center;color:var(--muted);font-size:12px;grid-column:1/-1">暂无套餐，请到 <a href="/equipment" style="color:var(--green)">设备管理-套餐管理</a> 创建</div>`;
    return;
  }

  const start = $("#startDateInput")?.value;
  const end = $("#endDateInput")?.value;

  wrap.innerHTML = allPackages
    .map((pkg) => {
      const isSelected = selectedPackages.has(pkg.id);
      const eqMap = new Map(allEquipment.map((e) => [e.id, e]));
      const repairIds = (pkg.items || []).filter((it) => it.condition === "repair").map((it) => it.id);
      const missingIds = (pkg.items || []).filter((it) => !it.exists).map((it) => it.id);
      const issues = packageItemIssues[pkg.id] || [];
      const hasIssue = repairIds.length > 0 || missingIds.length > 0 || issues.length > 0;

      const issueCount = repairIds.length + missingIds.length + issues.length;
      const issueBadge = hasIssue
        ? `<span class="badge repair" title="${issueCount} 个问题" style="position:absolute;top:8px;right:8px">⚠️ ${issueCount}</span>`
        : "";

      const issueList = [];
      if (missingIds.length) issueList.push(`<li>❌ 已删除：${missingIds.join("、")}</li>`);
      if (repairIds.length) issueList.push(`<li>🔧 维修中：${repairIds.join("、")}</li>`);
      issues.forEach((iss) => {
        if (iss.type === "conflict") issueList.push(`<li>📅 租期冲突：${iss.id} ${iss.name} → ${iss.conflictOrderCustomer || iss.conflictOrderId || ''} ${iss.conflictRange || ''}</li>`);
        if (iss.type === "quote_lock") issueList.push(`<li>🔒 报价锁定：${iss.id} ${iss.name} → 报价 ${iss.conflictQuoteId || ''} ${iss.conflictQuoteCustomer || ''}</li>`);
      });

      const issueHtml = hasIssue
        ? `<div class="package-issue-hint" style="margin-top:6px;padding:6px 8px;background:#fff4f2;border:1px solid #f0c0b8;border-radius:4px;font-size:11px;color:var(--red)">
            <strong>⚠️ 存在问题：</strong>
            <ul style="margin:4px 0 0;padding-left:16px">${issueList.join("")}</ul>
          </div>`
        : "";

      const tags = (pkg.itemIds || []).slice(0, 4).map((iid) => {
        const e = eqMap.get(iid);
        return `<span class="item-tag" style="font-size:10px;padding:1px 5px">${escapeHtml(e ? e.name : iid)}</span>`;
      }).join("");
      const moreTag = (pkg.itemIds || []).length > 4
        ? `<span class="item-tag" style="font-size:10px;padding:1px 5px">+${(pkg.itemIds || []).length - 4}</span>`
        : "";

      return `<div class="package-card" data-pkg-id="${escapeHtml(pkg.id)}" data-selected="${isSelected ? "1" : "0"}"
        style="padding:10px 12px;border:2px solid ${isSelected ? 'var(--green)' : 'var(--line)'};border-radius:8px;cursor:pointer;transition:all 0.15s;background:${isSelected ? '#f1faf3' : '#fff'};position:relative">
        ${issueBadge}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
          <div>
            <strong style="font-size:13px">${escapeHtml(pkg.name)}</strong>
            <span class="cat-pill cat-${escapeCss(pkg.category || '通用')}" style="margin-left:6px;font-size:10px;padding:1px 6px">${escapeHtml(pkg.category || "通用")}</span>
          </div>
          <span class="meta" style="font-size:10px;white-space:nowrap">${(pkg.itemIds || []).length} 台</span>
        </div>
        ${pkg.description ? `<div class="meta" style="font-size:11px;margin-bottom:4px">${escapeHtml(pkg.description)}</div>` : ""}
        <div style="display:flex;flex-wrap:wrap;gap:3px">${tags}${moreTag}</div>
        ${issueHtml}
      </div>`;
    })
    .join("");

  $$(".package-card").forEach((card) => {
    card.onclick = () => handlePackageClick(card.dataset.pkgId);
  });
}

async function handlePackageClick(pkgId) {
  const pkg = allPackages.find((p) => p.id === pkgId);
  if (!pkg) return;

  if (selectedPackages.has(pkgId)) {
    selectedPackages.delete(pkgId);
    (pkg.itemIds || []).forEach((iid) => {
      selectedItems.delete(iid);
      delete depositOverrides[iid];
    });
    delete packageItemIssues[pkgId];
  } else {
    selectedPackages.add(pkgId);

    const eqMap = new Map(allEquipment.map((e) => [e.id, e]));
    const repairItems = [];
    const missingItems = [];
    (pkg.itemIds || []).forEach((iid) => {
      const eq = eqMap.get(iid);
      if (!eq) {
        missingItems.push(iid);
        return;
      }
      if (eq.condition === "repair") {
        repairItems.push({ id: iid, name: eq.name });
        return;
      }
      selectedItems.add(iid);
      if (pkg.depositOverrides && pkg.depositOverrides[iid] && !depositOverrides[iid]) {
        depositOverrides[iid] = { ...pkg.depositOverrides[iid] };
      }
    });

    const issues = [];
    if (missingItems.length) {
      missingItems.forEach((id) => issues.push({ type: "missing", id, name: id }));
    }
    if (repairItems.length) {
      repairItems.forEach((r) => issues.push({ type: "repair", id: r.id, name: r.name }));
    }

    const start = $("#startDateInput")?.value;
    const end = $("#endDateInput")?.value;
    if (start && end && editingId) {
      try {
        const check = await Packages.checkAvailability(pkgId, {
          startDate: start,
          endDate: end,
          exceptQuoteId: editingId
        });
        (check.conflicts || []).forEach((c) => issues.push({ type: "conflict", ...c }));
        (check.quoteLocks || []).forEach((c) => issues.push({ type: "quote_lock", ...c }));
      } catch (e) {}
    } else if (start && end) {
      const conflictIds = checkItemConflictsLocally(pkg.itemIds, start, end);
      conflictIds.forEach((c) => issues.push(c));
    }

    if (issues.length) {
      packageItemIssues[pkgId] = issues;
    }
  }

  renderPackagesList();
  renderItems();
  renderSelection();
  renderPackageIssuesAlert();
  schedulePreview();
}

function checkItemConflictsLocally(itemIds, startDate, endDate) {
  const issues = [];
  const occupied = new Set();

  (allOrders || []).forEach((o) => {
    if (["已取消", "已归还"].includes(o.status)) return;
    if (overlap(startDate, endDate, o.startDate, o.endDate)) {
      (o.itemIds || []).forEach((id) => occupied.add(id));
    }
  });

  const eqMap = new Map(allEquipment.map((e) => [e.id, e]));
  itemIds.forEach((id) => {
    if (occupied.has(id)) {
      const eq = eqMap.get(id);
      issues.push({
        type: "conflict",
        id,
        name: eq ? eq.name : id,
        conflictOrderId: "本地检测",
        conflictOrderCustomer: "订单占用",
        conflictRange: `${startDate} ~ ${endDate}`
      });
    }
  });

  return issues;
}

function renderPackageIssuesAlert() {
  const alertEl = $("#packageIssuesAlert");
  if (!alertEl) return;

  const allIssues = [];
  Object.entries(packageItemIssues).forEach(([pkgId, issues]) => {
    const pkg = allPackages.find((p) => p.id === pkgId);
    const pkgName = pkg ? pkg.name : pkgId;
    issues.forEach((iss) => {
      let text = "";
      switch (iss.type) {
        case "missing":
          text = `套餐「${pkgName}」：设备 ${iss.id || iss.name} 已不存在，建议替换或移除`;
          break;
        case "repair":
          text = `套餐「${pkgName}」：${iss.id} ${iss.name} 正在维修中，建议替换或移除`;
          break;
        case "conflict":
          text = `套餐「${pkgName}」：${iss.id} ${iss.name} 租期冲突（${iss.conflictOrderCustomer || iss.conflictOrderId || '已有订单'} ${iss.conflictRange || ''}），建议替换`;
          break;
        case "quote_lock":
          text = `套餐「${pkgName}」：${iss.id} ${iss.name} 被其他报价锁定（报价 ${iss.conflictQuoteId || ''} ${iss.conflictQuoteCustomer || ''}），建议替换`;
          break;
      }
      if (text) allIssues.push({ text, pkgId, iss });
    });
  });

  if (!allIssues.length) {
    alertEl.classList.add("hidden");
    alertEl.innerHTML = "";
    return;
  }

  const uniqueMissing = new Set();
  const uniqueRepair = new Set();
  allIssues.forEach(({ iss }) => {
    if (iss.type === "missing") uniqueMissing.add(iss.id);
    if (iss.type === "repair") uniqueRepair.add(iss.id);
  });

  const hasBlocking = uniqueMissing.size > 0 || uniqueRepair.size > 0;

  const html = `
    <div style="margin-bottom:6px;font-weight:700">
      ${hasBlocking ? "❌ 套餐存在必须处理的问题" : "⚠️ 套餐存在需要注意的问题"}
    </div>
    <ul style="margin:4px 0;padding-left:18px">
      ${allIssues.map(({ text, pkgId, iss }) => `
        <li style="margin-bottom:3px">
          ${escapeHtml(text)}
          ${['missing', 'repair'].includes(iss.type)
            ? `<button class="ghost small" style="padding:1px 6px;font-size:10px;margin-left:4px" onclick="window.__removePkgItem?.('${pkgId}','${iss.id}','${iss.type}')">✂️ 移除</button>`
            : `<button class="ghost small" style="padding:1px 6px;font-size:10px;margin-left:4px" onclick="window.__showReplaceTip?.()">🔄 替换建议</button>`
          }
        </li>
      `).join("")}
    </ul>
    ${hasBlocking ? `<div style="margin-top:6px;font-size:11px;color:var(--muted)">提示：维修中或已删除的设备需要处理后才能保存报价单</div>` : ""}
  `;

  alertEl.innerHTML = html;
  alertEl.classList.remove("hidden");
}

window.__removePkgItem = function(pkgId, itemId, issueType) {
  if (!selectedPackages.has(pkgId)) return;
  selectedItems.delete(itemId);
  delete depositOverrides[itemId];
  if (packageItemIssues[pkgId]) {
    packageItemIssues[pkgId] = packageItemIssues[pkgId].filter((iss) => iss.id !== itemId);
    if (packageItemIssues[pkgId].length === 0) delete packageItemIssues[pkgId];
  }
  showToast(`已从选择中移除设备 ${itemId}`);
  renderPackagesList();
  renderItems();
  renderSelection();
  renderPackageIssuesAlert();
  schedulePreview();
};

window.__showReplaceTip = function() {
  showToast("请手动取消选择冲突设备，然后从设备列表中选择其他可用的同类设备", "info");
};

async function loadPackagesData() {
  try {
    allPackages = await Packages.list();
  } catch (e) {
    allPackages = [];
  }
  renderPackagesList();
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

    const alertEl = $("#editConflictAlert");
    if (alertEl && summary.lockCheck && !summary.lockCheck.valid) {
      const parts = formatConflictDetails(summary.lockCheck);
      if (parts.length) {
        alertEl.innerHTML = renderConflictDetailsHtml(summary.lockCheck, "预览提醒：存在潜在冲突");
        alertEl.classList.remove("hidden");
      } else {
        alertEl.classList.add("hidden");
        alertEl.innerHTML = "";
      }
    } else if (alertEl) {
      alertEl.classList.add("hidden");
      alertEl.innerHTML = "";
    }
  } catch (err) {
    const alertEl = $("#editConflictAlert");
    if (alertEl && err.details) {
      const parts = formatConflictDetails(err.details);
      if (parts.length) {
        alertEl.innerHTML = renderConflictDetailsHtml(err.details, "预览失败");
        alertEl.classList.remove("hidden");
      }
    }
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
  selectedPackages.clear();
  Object.keys(depositOverrides).forEach((k) => delete depositOverrides[k]);
  Object.keys(packageItemIssues).forEach((k) => delete packageItemIssues[k]);
  currentPreview = null;
  pendingLockStartAt = null;
  pendingLockEndAt = null;
  $("#modalTitle").textContent = "新建报价单";
  $("#statusSelect").innerHTML = '<option value="草稿">草稿</option>';
  $("#previewEmpty").classList.remove("hidden");
  $("#previewContent").classList.add("hidden");
  $("#breakdownCard").classList.add("hidden");
  $("#customerInfo").classList.add("hidden");
  $("#customerSelect").value = "";
  $("#itemCategoryFilter").value = "";
  $("#lockStartAtInput").value = "";
  $("#lockEndAtInput").value = "";
  $("#lockAppliedHint").classList.add("hidden");
  $("#lockAppliedRange").textContent = "";
  const alertEl = $("#editConflictAlert");
  if (alertEl) {
    alertEl.classList.add("hidden");
    alertEl.innerHTML = "";
  }
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
      if (q.status === "已确认") {
        $("#statusSelect").innerHTML = '<option value="已确认">已确认（由审批通过生成）</option><option value="草稿">退回草稿</option>';
      } else {
        $("#statusSelect").innerHTML = '<option value="草稿">草稿</option>';
      }
      $("#statusSelect").value = q.status === "已确认" ? "已确认" : "草稿";

      if (q.status === "已转订单") {
        $("#statusSelect").innerHTML = '<option value="已转订单">已转订单（不可修改）</option>';
        $("#statusSelect").value = "已转订单";
        $("#statusSelect").disabled = true;
      } else {
        $("#statusSelect").disabled = false;
      }

      selectedItems.clear();
      (q.itemIds || []).forEach((iid) => selectedItems.add(iid));

      selectedPackages.clear();
      (q.packageIds || []).forEach((pid) => selectedPackages.add(pid));

      if (q.depositOverride && typeof q.depositOverride === "object") {
        Object.keys(q.depositOverride).forEach((iid) => {
          depositOverrides[iid] = { ...q.depositOverride[iid] };
        });
      }

      if (q.lockEndAt) {
        pendingLockStartAt = q.lockStartAt || null;
        pendingLockEndAt = q.lockEndAt;
        if (q.lockStartAt) {
          const d = new Date(q.lockStartAt);
          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
          $("#lockStartAtInput").value = local.toISOString().slice(0, 16);
        }
        const d2 = new Date(q.lockEndAt);
        const local2 = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000);
        $("#lockEndAtInput").value = local2.toISOString().slice(0, 16);
        updateLockAppliedHint();
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
      renderPackagesList();
      renderPackageIssuesAlert();
      if (q.summary) renderPreview(q.summary);
    } catch (err) {
      showToast(err.message, "error");
      $("#editModal").classList.add("hidden");
    }
  }
}

function updateLockAppliedHint() {
  if (pendingLockEndAt) {
    $("#lockAppliedHint").classList.remove("hidden");
    const startStr = pendingLockStartAt
      ? new Date(pendingLockStartAt).toLocaleString("zh-CN")
      : "立即生效";
    const endStr = new Date(pendingLockEndAt).toLocaleString("zh-CN");
    $("#lockAppliedRange").textContent = `${startStr} → ${endStr}`;
  } else {
    $("#lockAppliedHint").classList.add("hidden");
  }
}

function closeEditModal() {
  $("#editModal").classList.add("hidden");
  editingId = null;
}

function toISOLocalString(datetimeLocal) {
  if (!datetimeLocal) return null;
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

async function submitQuote() {
  const form = $("#quoteForm");
  const data = Object.fromEntries(new FormData(form).entries());
  data.itemIds = [...selectedItems];
  data.packageIds = [...selectedPackages];

  Object.keys(depositOverrides).forEach((iid) => {
    if (!data.itemIds.includes(iid)) delete depositOverrides[iid];
  });
  data.depositOverride = { ...depositOverrides };

  if (pendingLockStartAt) {
    data.lockStartAt = pendingLockStartAt;
  } else if (data.lockStartAt) {
    data.lockStartAt = toISOLocalString(data.lockStartAt);
  }
  if (pendingLockEndAt) {
    data.lockEndAt = pendingLockEndAt;
  } else if (data.lockEndAt) {
    data.lockEndAt = toISOLocalString(data.lockEndAt);
  }
  data.lockedBy = "user";

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

  const repairItems = allEquipment.filter((e) => data.itemIds.includes(e.id) && e.condition === "repair");
  if (repairItems.length) {
    showToast(`维修中设备不可加入报价单：${repairItems.map((e) => `${e.id} ${e.name}`).join("、")}`, "error");
    return;
  }

  try {
    let result;
    if (editingId) {
      result = await Quotations.update(editingId, data);
      if (result.newVersionCreated) {
        showToast(`报价单 ${result.id} 已更新，已生成新版本 V${(allVersions.length + 1) || result.currentVersionId}`);
      } else {
        showToast(`报价单 ${result.id} 已更新`);
      }
    } else {
      result = await Quotations.create(data);
      showToast(`报价单 ${result.id} 创建成功`);
    }
    closeEditModal();
    await load();
    openDetail(result.id);
  } catch (err) {
    const alertEl = $("#editConflictAlert");
    if (alertEl && err.details) {
      const parts = formatConflictDetails(err.details);
      if (parts.length) {
        alertEl.innerHTML = renderConflictDetailsHtml(err.details, "保存失败");
        alertEl.classList.remove("hidden");
      } else {
        alertEl.classList.add("hidden");
        alertEl.innerHTML = "";
      }
    }
    showToast(err.message, "error");
  }
}

async function openDetail(id) {
  currentDetailId = id;
  $("#detailModal").classList.remove("hidden");
  $("#detailTitle").textContent = "报价单详情";
  $("#detailBody").innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中…</div>';
  detailTab = "info";
  currentCompareV1 = null;
  currentCompareV2 = null;

  try {
    const [q, check, versions] = await Promise.all([
      Quotations.get(id),
      Quotations.checkConvert(id).catch(() => null),
      Quotations.listVersions(id).catch(() => [])
    ]);
    allVersions = versions || [];
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
        (check.equipmentCheck.repair || []).forEach((r) => issues.push(`<li>🔧 维修中：${escapeHtml(r.id)} ${escapeHtml(r.name)}</li>`));
        (check.equipmentCheck.conditionMissing || []).forEach((r) => issues.push(`<li>⚠️ 设备缺失：${escapeHtml(r.id)} ${escapeHtml(r.name)}</li>`));
        (check.equipmentCheck.rented || []).forEach((r) => issues.push(`<li>📦 租赁中：${escapeHtml(r.id)} ${escapeHtml(r.name)}${r.orderCustomer ? `（客户：${escapeHtml(r.orderCustomer)}）` : r.orderId ? `（订单：${escapeHtml(r.orderId)}）` : ""}</li>`));
        (check.equipmentCheck.conflicts || []).forEach((c) => issues.push(`<li>📅 租期冲突：${escapeHtml(c.id)} ${escapeHtml(c.name)} → ${escapeHtml(c.conflictOrderCustomer || c.conflictOrderId || "")} ${escapeHtml(c.conflictRange || "")}</li>`));
        (check.equipmentCheck.quoteLocks || []).forEach((c) => issues.push(`<li>🔒 报价锁定冲突：${escapeHtml(c.id)} ${escapeHtml(c.name)} → 报价 ${escapeHtml(c.conflictQuoteId || "")} ${escapeHtml(c.conflictQuoteCustomer || "")}${c.conflictQuoteLockEndAt ? `（锁定至 ${escapeHtml(new Date(c.conflictQuoteLockEndAt).toLocaleString('zh-CN').slice(0, 16))}）` : ""}，租期 ${escapeHtml(c.conflictRange || "")}</li>`));
        (check.equipmentCheck.missing || []).forEach((m) => issues.push(`<li>❌ 设备不存在：${escapeHtml(m)}</li>`));
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

  const lockStatus = q.lockStatus || {};
  let lockInfoHtml = "";
  if (lockStatus.locked) {
    const remainHours = Math.ceil(lockStatus.remainingMs / (1000 * 60 * 60));
    const remainText = remainHours < 24
      ? `剩余约 ${remainHours} 小时`
      : `剩余约 ${Math.round(remainHours / 24 * 10) / 10} 天`;
    lockInfoHtml = `<div style="margin-top:10px;padding:10px 14px;background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.4);border-radius:8px">
      <strong style="color:var(--orange)">🔒 临时锁定中 · ${remainText}</strong>
      <div class="meta" style="margin-top:4px">有效期：${lockStatus.lockStartAt ? escapeHtml(new Date(lockStatus.lockStartAt).toLocaleString('zh-CN')) + " → " : "立即生效 → "}${escapeHtml(new Date(lockStatus.lockEndAt).toLocaleString('zh-CN'))}</div>
      ${lockStatus.lockedBy ? `<div class="meta">操作人：${escapeHtml(lockStatus.lockedBy)}</div>` : ""}
    </div>`;
  } else if (lockStatus.expired && !lockStatus.neverLocked) {
    const expiredHours = Math.round(lockStatus.expiredMs / (1000 * 60 * 60) * 10) / 10;
    const expiredText = expiredHours < 24
      ? `${expiredHours} 小时前`
      : `${Math.round(expiredHours / 24 * 10) / 10} 天前`;
    lockInfoHtml = `<div style="margin-top:10px;padding:10px 14px;background:rgba(128,128,128,0.06);border:1px dashed rgba(128,128,128,0.3);border-radius:8px">
      <span style="color:var(--muted)">🔓 曾临时锁定（已过期 ${expiredText}）</span>
      <div class="meta" style="margin-top:4px">有效期：${lockStatus.lockStartAt ? escapeHtml(new Date(lockStatus.lockStartAt).toLocaleString('zh-CN')) + " → " : "立即生效 → "}${escapeHtml(new Date(lockStatus.lockEndAt).toLocaleString('zh-CN'))}</div>
    </div>`;
  }
  if (q.lockHistory && q.lockHistory.length) {
    const historyHtml = q.lockHistory.slice(-5).reverse().map((h) => {
      const actionText = { set: "设置锁定", update: "更新锁定", cancel: "取消锁定", convert: "转订单解除锁定" }[h.action] || h.action;
      return `<li class="meta">${escapeHtml(new Date(h.at).toLocaleString('zh-CN'))} · ${actionText}${h.lockEndAt ? `，至 ${escapeHtml(new Date(h.lockEndAt).toLocaleString('zh-CN').slice(0, 16))}` : h.newLockEndAt ? ` → ${escapeHtml(new Date(h.newLockEndAt).toLocaleString('zh-CN').slice(0, 16))}` : ""}</li>`;
    }).join("");
    lockInfoHtml += `<div style="margin-top:8px">
      <div class="meta" style="font-weight:600;margin-bottom:4px">📜 锁定历史：</div>
      <ul style="margin:0;padding-left:20px">${historyHtml}</ul>
    </div>`;
  }

  let convertedLink = "";
  if (q.status === "已转订单" && q.convertedOrderId) {
    convertedLink = `<div class="convert-ok" style="margin-top:8px">
      📦 已转订单：<a href="/" style="color:var(--green);font-weight:600">${escapeHtml(q.convertedOrderId)}</a>
    </div>`;
  }

  const versionsHtml = renderVersionsTab(q);
  const compareHtml = renderCompareTab(q);

  const infoTabContent = `
    ${alertHtml}
    <div class="detail-section">
      <div class="q-id">${escapeHtml(q.id)}</div>
      <h3>${escapeHtml(q.customer || "（未填客户）")}</h3>
      <span class="badge ${statusBadgeClass(q.status)}">${escapeHtml(q.status)}</span>
      ${convertedLink}
      ${lockInfoHtml}
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
      ${(q.packages && q.packages.length) ? `
      <tr>
        <th>使用套餐</th>
        <td colspan="3">
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${q.packages.map((p) => `
              <span class="item-tag" style="padding:4px 10px;font-size:12px;background:${p.exists ? '#e8f5e9' : '#ffebee'};color:${p.exists ? '#2e7d32' : '#c62828'}">
                🎁 ${escapeHtml(p.name)}
                <span class="meta" style="margin-left:4px">(${p.itemCount} 台)</span>
                ${p.exists ? '' : ' <span style="color:#c62828">（已删除）</span>'}
              </span>
            `).join("")}
          </div>
        </td>
      </tr>
      ` : ""}
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

  $("#detailBody").innerHTML = `
    <div class="detail-tabs">
      <button class="tab-btn ${detailTab === 'info' ? 'active' : ''}" data-tab="info">📋 基本信息</button>
      <button class="tab-btn ${detailTab === 'versions' ? 'active' : ''}" data-tab="versions">📜 版本历史 (${allVersions.length})</button>
      <button class="tab-btn ${detailTab === 'compare' ? 'active' : ''}" data-tab="compare">⚖️ 版本对比</button>
    </div>
    <div class="tab-content" style="display:${detailTab === 'info' ? 'block' : 'none'}" data-tab="info">${infoTabContent}</div>
    <div class="tab-content" style="display:${detailTab === 'versions' ? 'block' : 'none'}" data-tab="versions">${versionsHtml}</div>
    <div class="tab-content" style="display:${detailTab === 'compare' ? 'block' : 'none'}" data-tab="compare">${compareHtml}</div>
  `;

  $$(".tab-btn").forEach((btn) => {
    btn.onclick = () => {
      detailTab = btn.dataset.tab;
      $$(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".tab-content").forEach((c) => {
        c.style.display = c.dataset.tab === detailTab ? "block" : "none";
      });
      bindDetailTabEvents(q);
    };
  });

  bindDetailTabEvents(q);

  const canEdit = q.status !== "已转订单";
  const canConvert = q.status === "已确认";
  const canDelete = q.status !== "已转订单";

  const actions = [];
  if (canEdit) actions.push(`<button class="editDetailBtn ghost">✏️ 编辑</button>`);
  if (canConvert && check && check.convertible) actions.push(`<button class="convertDetailBtn secondary">📦 一键转订单</button>`);
  if (canConvert && check && !check.convertible) actions.push(`<button class="convertDetailBtn secondary" disabled style="opacity:.5;cursor:not-allowed">📦 无法转订单</button>`);
  if (q.status === "草稿" || q.status === "已确认") actions.push(`<button class="cancelDetailBtn danger">🚫 取消报价</button>`);
  if (canDelete) actions.push(`<button class="deleteDetailBtn ghost">🗑 删除</button>`);
  actions.push(`<button id="detailCloseBtn" class="ghost">关闭</button>`);

  $("#detailActions").innerHTML = actions.join("");

  const editBtn = $(".editDetailBtn");
  const convertBtn = $(".convertDetailBtn");
  const cancelBtn = $(".cancelDetailBtn");
  const deleteBtn = $(".deleteDetailBtn");
  const closeBtn = $("#detailCloseBtn");

  if (editBtn) editBtn.onclick = () => { closeDetail(); openEdit(q.id); };
  if (convertBtn && !convertBtn.disabled) convertBtn.onclick = () => handleConvertClick(q.id);
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

function renderVersionsTab(q) {
  if (!allVersions.length) {
    return `<div style="text-align:center;padding:40px;color:var(--muted)">暂无版本历史</div>`;
  }

  const canApprove = q.status !== "已转订单";

  return `
    <div class="versions-list">
      ${allVersions.map((v) => {
        const snapshot = v.snapshot || {};
        const items = snapshot.items || [];
        const summary = snapshot.summary || {};

        let approvalBadge = "";
        if (v.approvalStatus === "approved") {
          approvalBadge = `<span class="badge ${versionStatusBadgeClass(v.approvalStatus)}">✅ ${escapeHtml(v.approvalStatusLabel)}</span>`;
        } else if (v.approvalStatus === "rejected") {
          approvalBadge = `<span class="badge ${versionStatusBadgeClass(v.approvalStatus)}">❌ ${escapeHtml(v.approvalStatusLabel)}</span>`;
        } else if (v.approvalStatus === "superseded") {
          approvalBadge = `<span class="badge ${versionStatusBadgeClass(v.approvalStatus)}">♻️ ${escapeHtml(v.approvalStatusLabel)}</span>`;
        } else {
          approvalBadge = `<span class="badge ${versionStatusBadgeClass(v.approvalStatus)}">⏳ ${escapeHtml(v.approvalStatusLabel)}</span>`;
        }

        const tags = items
          .slice(0, 5)
          .map((it) => `<span class="item-tag">${escapeHtml(it.id)} ${escapeHtml(it.name)}</span>`)
          .join("");

        const moreTag = items.length > 5 ? `<span class="item-tag">+${items.length - 5} 件</span>` : "";

        return `
          <div class="version-card" data-version-id="${escapeHtml(v.versionId)}">
            <div class="version-head">
              <div class="version-title">
                <strong>版本 ${v.versionNumber}</strong>
                <span class="version-id">${escapeHtml(v.versionId)}</span>
              </div>
              <div class="version-status">
                ${approvalBadge}
                ${v.isCurrent ? '<span class="badge version-current">当前</span>' : ''}
                ${v.isApproved ? '<span class="badge version-approved-tag">已生效</span>' : ''}
              </div>
            </div>
            <div class="version-meta">
              <span>创建时间：${formatDateTime(v.createdAt)}</span>
              <span>创建人：${escapeHtml(v.createdBy)}</span>
              ${v.approvedAt ? `<span>审批时间：${formatDateTime(v.approvedAt)}</span>` : ''}
              ${v.rejectedAt ? `<span>驳回时间：${formatDateTime(v.rejectedAt)}</span>` : ''}
            </div>
            <div class="version-snapshot">
              <div class="snapshot-row">
                <span class="snapshot-label">客户：</span>
                <span>${escapeHtml(snapshot.customer || "—")}</span>
              </div>
              <div class="snapshot-row">
                <span class="snapshot-label">租期：</span>
                <span>${escapeHtml(snapshot.startDate || "—")} 至 ${escapeHtml(snapshot.endDate || "—")}${snapshot.rentalDays ? ` · ${snapshot.rentalDays}天` : ""}</span>
              </div>
              <div class="snapshot-row">
                <span class="snapshot-label">折扣：</span>
                <span>${snapshot.discount ? (Number(snapshot.discount) <= 1 ? `${Math.round((1 - Number(snapshot.discount)) * 100)}% 折扣` : `减 ¥${Number(snapshot.discount)}`) : "无折扣"}</span>
              </div>
              ${(snapshot.packages && snapshot.packages.length) ? `
              <div class="snapshot-row">
                <span class="snapshot-label">套餐：</span>
                <span>${snapshot.packages.map((p) => escapeHtml(p.name)).join("、")}</span>
              </div>
              ` : ""}
              <div class="snapshot-row">
                <span class="snapshot-label">合计：</span>
                <span class="snapshot-total">¥${fmtMoney(summary.grandTotal || 0)}</span>
              </div>
              <div class="version-items">
                ${tags}${moreTag}
              </div>
              ${snapshot.note ? `<div class="snapshot-note">📝 ${escapeHtml(snapshot.note)}</div>` : ""}
              ${v.rejectionReason ? `<div class="rejection-note">❌ 驳回原因：${escapeHtml(v.rejectionReason)}</div>` : ""}
            </div>
            <div class="version-actions">
              ${v.approvalStatus === "pending" && canApprove ? `
                <button class="approve-version-btn success small" data-version-id="${escapeHtml(v.versionId)}">✅ 通过审批</button>
                <button class="reject-version-btn danger small" data-version-id="${escapeHtml(v.versionId)}">❌ 驳回</button>
              ` : ""}
              ${!v.isCurrent && canApprove ? `
                <button class="restore-version-btn secondary small" data-version-id="${escapeHtml(v.versionId)}">↩️ 恢复此版本</button>
              ` : ""}
              ${allVersions.length >= 2 ? `
                <button class="compare-select-btn ghost small" data-version-id="${escapeHtml(v.versionId)}">⚖️ 选为对比项</button>
              ` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCompareTab(q) {
  if (allVersions.length < 2) {
    return `<div style="text-align:center;padding:40px;color:var(--muted)">至少需要两个版本才能进行对比</div>`;
  }

  const versionOptions = allVersions
    .map((v) => `<option value="${escapeHtml(v.versionId)}">版本 ${v.versionNumber} (${escapeHtml(v.versionId)})</option>`)
    .join("");

  let compareContent = "";
  if (currentCompareV1 && currentCompareV2) {
    const v1 = allVersions.find((v) => v.versionId === currentCompareV1);
    const v2 = allVersions.find((v) => v.versionId === currentCompareV2);

    if (v1 && v2) {
      compareContent = renderVersionComparison(v1, v2);
    }
  } else {
    compareContent = `<div style="text-align:center;padding:40px;color:var(--muted)">请选择两个版本进行对比</div>`;
  }

  return `
    <div class="compare-selector">
      <div class="compare-select-row">
        <label>版本 1：</label>
        <select class="compare-select" id="compareSelect1">
          <option value="">— 请选择 —</option>
          ${versionOptions}
        </select>
      </div>
      <div class="compare-vs">VS</div>
      <div class="compare-select-row">
        <label>版本 2：</label>
        <select class="compare-select" id="compareSelect2">
          <option value="">— 请选择 —</option>
          ${versionOptions}
        </select>
      </div>
      <button class="do-compare-btn primary" id="doCompareBtn">开始对比</button>
    </div>
    <div class="compare-result">
      ${compareContent}
    </div>
  `;
}

function renderVersionComparison(v1, v2) {
  const s1 = v1.snapshot || {};
  const s2 = v2.snapshot || {};
  const sum1 = s1.summary || {};
  const sum2 = s2.summary || {};

  function diffField(val1, val2, formatFn = (v) => v || "—") {
    const f1 = formatFn(val1);
    const f2 = formatFn(val2);
    const changed = f1 !== f2;
    return {
      v1: f1,
      v2: f2,
      changed
    };
  }

  function formatDiscount(d) {
    if (!d) return "无折扣";
    return Number(d) <= 1 ? `${Math.round((1 - Number(d)) * 100)}% 折扣` : `减 ¥${Number(d)}`;
  }

  function formatDateRange(d) {
    if (!d.startDate || !d.endDate) return "—";
    return `${d.startDate} 至 ${d.endDate}${d.rentalDays ? ` · ${d.rentalDays}天` : ""}`;
  }

  function formatPackages(pkgs) {
    if (!pkgs || !pkgs.length) return "—";
    return pkgs.map((p) => p.name).join("、");
  }

  const fields = [
    { label: "客户", ...diffField(s1.customer, s2.customer) },
    { label: "租期", ...diffField(s1, s2, formatDateRange) },
    { label: "折扣", ...diffField(s1.discount, s2.discount, formatDiscount) },
    { label: "使用套餐", ...diffField(s1.packages, s2.packages, formatPackages) },
    { label: "设备数量", ...diffField((s1.itemIds || []).length, (s2.itemIds || []).length, (v) => `${v} 件`) },
    { label: "租金小计", ...diffField(sum1.subtotal, sum2.subtotal, (v) => `¥${fmtMoney(v)}`) },
    { label: "优惠金额", ...diffField(sum1.discountAmount, sum2.discountAmount, (v) => `¥${fmtMoney(v)}`) },
    { label: "折后租金", ...diffField(sum1.discounted, sum2.discounted, (v) => `¥${fmtMoney(v)}`) },
    { label: "押金合计", ...diffField(sum1.totalDeposit, sum2.totalDeposit, (v) => `¥${fmtMoney(v)}`) },
    { label: "应收合计", ...diffField(sum1.grandTotal, sum2.grandTotal, (v) => `¥${fmtMoney(v)}`) },
    { label: "备注", ...diffField(s1.note, s2.note) }
  ];

  const items1 = s1.items || [];
  const items2 = s2.items || [];
  const itemIds1 = new Set(items1.map((i) => i.id));
  const itemIds2 = new Set(items2.map((i) => i.id));
  const allItemIds = new Set([...itemIds1, ...itemIds2]);

  const itemDiffRows = [...allItemIds].map((id) => {
    const it1 = items1.find((i) => i.id === id);
    const it2 = items2.find((i) => i.id === id);
    const in1 = !!it1;
    const in2 = !!it2;
    let status = "unchanged";
    if (in1 && !in2) status = "removed";
    else if (!in1 && in2) status = "added";

    return `
      <tr class="${status}">
        <td>${escapeHtml(id)}</td>
        <td>${in1 ? escapeHtml(it1.name) : "—"}</td>
        <td>${in2 ? escapeHtml(it2.name) : "—"}</td>
        <td class="num">${in1 ? `¥${fmtMoney(sum1.itemBreakdown?.find((x) => x.id === id)?.subtotal || 0)}` : "—"}</td>
        <td class="num">${in2 ? `¥${fmtMoney(sum2.itemBreakdown?.find((x) => x.id === id)?.subtotal || 0)}` : "—"}</td>
        <td>${status === "added" ? "新增" : status === "removed" ? "删除" : "未变"}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="compare-summary">
      <div class="compare-headers">
        <div class="compare-header v1">
          <strong>版本 ${v1.versionNumber}</strong>
          <span class="meta">${formatDateTime(v1.createdAt)} · ${escapeHtml(v1.approvalStatusLabel)}</span>
        </div>
        <div class="compare-header v2">
          <strong>版本 ${v2.versionNumber}</strong>
          <span class="meta">${formatDateTime(v2.createdAt)} · ${escapeHtml(v2.approvalStatusLabel)}</span>
        </div>
      </div>
      <table class="compare-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>版本 ${v1.versionNumber}</th>
            <th>版本 ${v2.versionNumber}</th>
            <th>变化</th>
          </tr>
        </thead>
        <tbody>
          ${fields.map((f) => `
            <tr class="${f.changed ? 'changed' : ''}">
              <td class="field-label">${f.label}</td>
              <td>${escapeHtml(f.v1)}</td>
              <td>${escapeHtml(f.v2)}</td>
              <td class="change-indicator">${f.changed ? '🔄 变更' : '—'}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="detail-subtitle">设备差异</div>
    <table class="compare-table">
      <thead>
        <tr>
          <th>设备编号</th>
          <th>版本 ${v1.versionNumber}</th>
          <th>版本 ${v2.versionNumber}</th>
          <th class="num">V1 小计</th>
          <th class="num">V2 小计</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        ${itemDiffRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">无设备差异</td></tr>'}
      </tbody>
    </table>
  `;
}

function bindDetailTabEvents(q) {
  if (detailTab === "versions") {
    $$(".approve-version-btn").forEach((btn) => {
      btn.onclick = async () => {
        const versionId = btn.dataset.versionId;
        const note = prompt("请输入审批备注（可选）：", "");
        if (note === null) return;
        try {
          await Quotations.approveVersion(q.id, versionId, { approvalNote: note });
          showToast("版本审批通过，报价单已确认");
          await load();
          openDetail(q.id);
        } catch (err) {
          showToast(err.message, "error");
        }
      };
    });

    $$(".reject-version-btn").forEach((btn) => {
      btn.onclick = async () => {
        const versionId = btn.dataset.versionId;
        const reason = prompt("请输入驳回原因：", "");
        if (!reason) {
          showToast("请输入驳回原因", "error");
          return;
        }
        try {
          await Quotations.rejectVersion(q.id, versionId, { rejectionReason: reason });
          showToast("版本已驳回");
          await load();
          openDetail(q.id);
        } catch (err) {
          showToast(err.message, "error");
        }
      };
    });

    $$(".restore-version-btn").forEach((btn) => {
      btn.onclick = async () => {
        const versionId = btn.dataset.versionId;
        if (!confirm("确定要恢复到此版本吗？这将覆盖当前报价单内容。")) return;
        try {
          await Quotations.restoreVersion(q.id, versionId);
          showToast("已恢复到该版本");
          await load();
          openDetail(q.id);
        } catch (err) {
          showToast(err.message, "error");
        }
      };
    });

    $$(".compare-select-btn").forEach((btn) => {
      btn.onclick = () => {
        const versionId = btn.dataset.versionId;
        if (!currentCompareV1) {
          currentCompareV1 = versionId;
          showToast(`已选为对比项 1`);
        } else if (!currentCompareV2) {
          currentCompareV2 = versionId;
          showToast(`已选为对比项 2`);
          detailTab = "compare";
          renderDetail(q, null);
        } else {
          currentCompareV1 = currentCompareV2;
          currentCompareV2 = versionId;
          showToast(`已选为对比项 2`);
          detailTab = "compare";
          renderDetail(q, null);
        }
      };
    });
  }

  if (detailTab === "compare") {
    const sel1 = $("#compareSelect1");
    const sel2 = $("#compareSelect2");
    if (sel1 && currentCompareV1) sel1.value = currentCompareV1;
    if (sel2 && currentCompareV2) sel2.value = currentCompareV2;

    const doCompareBtn = $("#doCompareBtn");
    if (doCompareBtn) {
      doCompareBtn.onclick = () => {
        currentCompareV1 = sel1.value;
        currentCompareV2 = sel2.value;
        if (!currentCompareV1 || !currentCompareV2) {
          showToast("请选择两个版本", "error");
          return;
        }
        if (currentCompareV1 === currentCompareV2) {
          showToast("请选择不同的版本进行对比", "error");
          return;
        }
        renderDetail(q, null);
      };
    }
  }
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
    const params = new URLSearchParams(window.location.search);
    customerFilterFromUrl = params.get("customer") || "";

    const quoteParams = customerFilterFromUrl ? { customer: customerFilterFromUrl } : null;
    [allEquipment, allQuotations, allCustomers, allOrders] = await Promise.all([
      Equipment.list(),
      Quotations.list(quoteParams),
      Customers.list(),
      import("./api.js").then((m) => (typeof m.Orders !== "undefined" ? m.Orders.list() : fetch("/api/orders").then((r) => r.json())))
    ]);
    loadPackagesData();
    renderCategoryFilters();
    renderCustomerOptions();
    renderStats();
    renderGrid();

    const quoteId = params.get("id");
    if (quoteId) {
      setTimeout(() => openDetail(quoteId), 100);
    }
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

$("#applyLockBtn").onclick = () => {
  const endVal = $("#lockEndAtInput").value;
  if (!endVal) {
    showToast("请填写锁定有效期至", "error");
    return;
  }
  const endDate = new Date(endVal);
  if (Number.isNaN(endDate.getTime())) {
    showToast("锁定有效期格式不正确", "error");
    return;
  }
  if (endDate <= new Date()) {
    showToast("锁定有效期必须晚于当前时间", "error");
    return;
  }
  const startVal = $("#lockStartAtInput").value;
  let startDate = null;
  if (startVal) {
    startDate = new Date(startVal);
    if (Number.isNaN(startDate.getTime())) {
      showToast("锁定开始时间格式不正确", "error");
      return;
    }
    if (endDate <= startDate) {
      showToast("锁定结束时间必须晚于开始时间", "error");
      return;
    }
  }
  if (!selectedItems.size) {
    showToast("请先选择设备再设置锁定", "error");
    return;
  }
  pendingLockStartAt = startDate ? startDate.toISOString() : null;
  pendingLockEndAt = endDate.toISOString();
  updateLockAppliedHint();
  showToast("锁定已设置，保存报价单后生效");
};

$("#clearLockBtn").onclick = () => {
  pendingLockStartAt = null;
  pendingLockEndAt = null;
  $("#lockStartAtInput").value = "";
  $("#lockEndAtInput").value = "";
  updateLockAppliedHint();
  showToast("已取消锁定设置（保存后生效）");
};

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
