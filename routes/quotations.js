import { loadDb, saveDb, genQuotationId, genVersionId, hasKeyFieldChanged, VERSION_APPROVAL_STATUSES, VERSION_APPROVAL_LABELS, getQuoteLockStatus, findQuoteLockConflicts, addQuoteLockHistory } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import { buildQuoteSummary, calcRentalDays } from "../lib/quoteCalculator.js";
import { convertQuotationToOrder, isQuoteConvertible } from "../lib/quoteToOrder.js";
import { validateEquipmentForOrder, findRepairItems, validateEquipmentForQuotation } from "../lib/equipmentValidator.js";

const QUOTE_STATUSES = ["草稿", "已确认", "已转订单", "已取消"];

export const QUOTE_LOCK_KEY_FIELDS = ["lockStartAt", "lockEndAt", "lockedBy"];

function buildQuotationPayload(db, quote, withSummary = true) {
  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const customer = (db.customers || []).find((c) => c.name === quote.customer);
  const lockStatus = getQuoteLockStatus(quote);

  const items = quote.itemIds.map((iid) => {
    const eq = eqMap.get(iid);
    return {
      id: iid,
      name: eq ? eq.name : "（已删除）",
      spec: eq ? eq.spec : "",
      category: eq ? eq.category : "",
      condition: eq ? eq.condition : "unknown"
    };
  });

  const payload = {
    ...quote,
    items,
    customerContact: customer ? customer.contact : "",
    customerPhone: customer ? customer.phone : "",
    customerActivity: customer ? customer.activityType : "",
    lockStatus
  };

  if (withSummary && quote.itemIds?.length && quote.startDate && quote.endDate) {
    payload.summary = buildQuoteSummary(
      db.equipment,
      quote.itemIds,
      quote.startDate,
      quote.endDate,
      quote.depositOverride || {},
      quote.discount || 0
    );
  }

  return payload;
}

function buildVersionSnapshot(db, quote) {
  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const items = (quote.itemIds || []).map((iid) => {
    const eq = eqMap.get(iid);
    return {
      id: iid,
      name: eq ? eq.name : "（已删除）",
      spec: eq ? eq.spec : "",
      category: eq ? eq.category : ""
    };
  });

  let summary = null;
  if (quote.itemIds?.length && quote.startDate && quote.endDate) {
    summary = buildQuoteSummary(
      db.equipment,
      quote.itemIds,
      quote.startDate,
      quote.endDate,
      quote.depositOverride || {},
      quote.discount || 0
    );
  }

  return {
    customer: quote.customer,
    startDate: quote.startDate,
    endDate: quote.endDate,
    rentalDays: quote.rentalDays,
    itemIds: quote.itemIds ? [...quote.itemIds] : [],
    items,
    discount: quote.discount,
    depositOverride: quote.depositOverride ? { ...quote.depositOverride } : {},
    note: quote.note,
    summary,
    lockStartAt: quote.lockStartAt,
    lockEndAt: quote.lockEndAt,
    lockedBy: quote.lockedBy
  };
}

function buildVersionPayload(db, quote, version) {
  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const snapshot = version.snapshot;
  const items = (snapshot.itemIds || []).map((iid) => {
    const eq = eqMap.get(iid);
    return {
      id: iid,
      name: eq ? eq.name : "（已删除）",
      spec: eq ? eq.spec : "",
      category: eq ? eq.category : ""
    };
  });

  const lockInfo = {
    lockStartAt: snapshot.lockStartAt ?? null,
    lockEndAt: snapshot.lockEndAt ?? null,
    lockedBy: snapshot.lockedBy ?? null
  };
  if (lockInfo.lockEndAt) {
    const pseudoQuote = { ...quote, ...lockInfo };
    lockInfo.lockStatus = getQuoteLockStatus(pseudoQuote);
  }

  return {
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    approvalStatus: version.approvalStatus,
    approvalStatusLabel: VERSION_APPROVAL_LABELS[version.approvalStatus] || version.approvalStatus,
    approvedAt: version.approvedAt,
    approvedBy: version.approvedBy,
    approvalNote: version.approvalNote,
    rejectedAt: version.rejectedAt,
    rejectedBy: version.rejectedBy,
    rejectionReason: version.rejectionReason,
    isCurrent: quote.currentVersionId === version.versionId,
    isApproved: quote.approvedVersionId === version.versionId,
    snapshot: {
      ...snapshot,
      items,
      ...lockInfo
    }
  };
}

export async function listVersions(req, res, quoteId) {
  const db = await loadDb();
  const quote = db.quotations.find((q) => q.id === quoteId);
  if (!quote) return sendJson(res, 404, { error: "quotation_not_found" });

  const versions = [...(quote.versions || [])]
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .map((v) => buildVersionPayload(db, quote, v));

  return sendJson(res, 200, versions);
}

export async function getVersion(req, res, quoteId, versionId) {
  const db = await loadDb();
  const quote = db.quotations.find((q) => q.id === quoteId);
  if (!quote) return sendJson(res, 404, { error: "quotation_not_found" });

  const version = (quote.versions || []).find((v) => v.versionId === versionId);
  if (!version) return sendJson(res, 404, { error: "version_not_found" });

  return sendJson(res, 200, buildVersionPayload(db, quote, version));
}

export async function createVersion(req, res, quoteId) {
  const db = await loadDb();
  const idx = db.quotations.findIndex((q) => q.id === quoteId);
  if (idx === -1) return sendJson(res, 404, { error: "quotation_not_found" });

  const quote = db.quotations[idx];
  if (quote.status === "已转订单") {
    return sendJson(res, 400, { error: "已转订单的报价单不能创建新版本" });
  }

  const input = await parseBody(req);

  const versions = quote.versions || [];
  const newVersionNumber = versions.length > 0
    ? Math.max(...versions.map((v) => v.versionNumber)) + 1
    : 1;

  const snapshot = buildVersionSnapshot(db, quote);

  const newVersion = {
    versionId: genVersionId(),
    versionNumber: newVersionNumber,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy || "user",
    snapshot,
    approvalStatus: "pending",
    approvedAt: null,
    approvedBy: null,
    approvalNote: "",
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: ""
  };

  versions.push(newVersion);
  quote.versions = versions;
  quote.currentVersionId = newVersion.versionId;
  quote.updatedAt = new Date().toISOString();

  await saveDb(db);
  return sendJson(res, 201, buildVersionPayload(db, quote, newVersion));
}

export async function approveVersion(req, res, quoteId, versionId) {
  const db = await loadDb();
  const idx = db.quotations.findIndex((q) => q.id === quoteId);
  if (idx === -1) return sendJson(res, 404, { error: "quotation_not_found" });

  const quote = db.quotations[idx];
  if (quote.status === "已转订单") {
    return sendJson(res, 400, { error: "已转订单的报价单不能审批" });
  }

  const version = (quote.versions || []).find((v) => v.versionId === versionId);
  if (!version) return sendJson(res, 404, { error: "version_not_found" });

  if (version.approvalStatus === "approved") {
    return sendJson(res, 400, { error: "该版本已通过审批" });
  }
  if (version.approvalStatus === "superseded") {
    return sendJson(res, 400, { error: "已取代的版本不能审批" });
  }

  const input = await parseBody(req);

  const oldApprovedVersion = (quote.versions || []).find(
    (v) => v.versionId === quote.approvedVersionId && v.approvalStatus === "approved"
  );
  if (oldApprovedVersion) {
    oldApprovedVersion.approvalStatus = "superseded";
  }

  version.approvalStatus = "approved";
  version.approvedAt = new Date().toISOString();
  version.approvedBy = input.approvedBy || "user";
  version.approvalNote = input.approvalNote || "";
  version.rejectedAt = null;
  version.rejectedBy = null;
  version.rejectionReason = "";

  quote.approvedVersionId = version.versionId;
  quote.currentVersionId = version.versionId;

  const snapshot = version.snapshot;
  const previewQuote = {
    ...quote,
    customer: snapshot.customer,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    rentalDays: snapshot.rentalDays,
    itemIds: [...(snapshot.itemIds || [])],
    discount: snapshot.discount,
    depositOverride: snapshot.depositOverride ? { ...snapshot.depositOverride } : {},
    note: snapshot.note,
    lockStartAt: snapshot.lockStartAt ?? null,
    lockEndAt: snapshot.lockEndAt ?? null,
    lockedBy: snapshot.lockedBy ?? null
  };

  const validation = validateQuoteConflictsForSave(db, previewQuote, quote.id);
  if (!validation.valid) {
    return sendJson(res, 409, {
      error: `审批失败：${validation.errors.join("；")}`,
      details: {
        repair: validation.repair,
        conflicts: validation.conflicts,
        quoteLocks: validation.quoteLocks,
        missing: validation.missing
      }
    });
  }

  quote.customer = previewQuote.customer;
  quote.startDate = previewQuote.startDate;
  quote.endDate = previewQuote.endDate;
  quote.rentalDays = previewQuote.rentalDays;
  quote.itemIds = previewQuote.itemIds;
  quote.discount = previewQuote.discount;
  quote.depositOverride = previewQuote.depositOverride;
  quote.note = previewQuote.note;
  quote.lockStartAt = previewQuote.lockStartAt;
  quote.lockEndAt = previewQuote.lockEndAt;
  quote.lockedBy = previewQuote.lockedBy;

  if (quote.status === "草稿") {
    quote.status = "已确认";
  }
  quote.updatedAt = new Date().toISOString();

  await saveDb(db);
  return sendJson(res, 200, {
    version: buildVersionPayload(db, quote, version),
    quotation: buildQuotationPayload(db, quote, true)
  });
}

export async function rejectVersion(req, res, quoteId, versionId) {
  const db = await loadDb();
  const idx = db.quotations.findIndex((q) => q.id === quoteId);
  if (idx === -1) return sendJson(res, 404, { error: "quotation_not_found" });

  const quote = db.quotations[idx];
  if (quote.status === "已转订单") {
    return sendJson(res, 400, { error: "已转订单的报价单不能审批" });
  }

  const version = (quote.versions || []).find((v) => v.versionId === versionId);
  if (!version) return sendJson(res, 404, { error: "version_not_found" });

  if (version.approvalStatus === "approved") {
    return sendJson(res, 400, { error: "已通过审批的版本不能驳回" });
  }

  const input = await parseBody(req);

  version.approvalStatus = "rejected";
  version.rejectedAt = new Date().toISOString();
  version.rejectedBy = input.rejectedBy || "user";
  version.rejectionReason = input.rejectionReason || "";

  quote.updatedAt = new Date().toISOString();

  await saveDb(db);
  return sendJson(res, 200, buildVersionPayload(db, quote, version));
}

export async function restoreVersion(req, res, quoteId, versionId) {
  const db = await loadDb();
  const idx = db.quotations.findIndex((q) => q.id === quoteId);
  if (idx === -1) return sendJson(res, 404, { error: "quotation_not_found" });

  const quote = db.quotations[idx];
  if (quote.status === "已转订单") {
    return sendJson(res, 400, { error: "已转订单的报价单不能恢复" });
  }

  const version = (quote.versions || []).find((v) => v.versionId === versionId);
  if (!version) return sendJson(res, 404, { error: "version_not_found" });

  const snapshot = version.snapshot;
  const previewQuote = {
    ...quote,
    customer: snapshot.customer,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    rentalDays: snapshot.rentalDays,
    itemIds: [...(snapshot.itemIds || [])],
    discount: snapshot.discount,
    depositOverride: snapshot.depositOverride ? { ...snapshot.depositOverride } : {},
    note: snapshot.note,
    lockStartAt: snapshot.lockStartAt ?? null,
    lockEndAt: snapshot.lockEndAt ?? null,
    lockedBy: snapshot.lockedBy ?? null,
    currentVersionId: version.versionId
  };

  if (version.approvalStatus === "approved" && quote.approvedVersionId === version.versionId) {
    if (previewQuote.status !== "已转订单") {
      previewQuote.status = "已确认";
    }
  } else {
    if (previewQuote.status === "已确认" || previewQuote.status === "已取消") {
      previewQuote.status = "草稿";
    }
  }

  const validation = validateQuoteConflictsForSave(db, previewQuote, quote.id);
  if (!validation.valid) {
    return sendJson(res, 409, {
      error: `恢复版本失败：${validation.errors.join("；")}`,
      details: {
        repair: validation.repair,
        conflicts: validation.conflicts,
        quoteLocks: validation.quoteLocks,
        missing: validation.missing
      }
    });
  }

  quote.customer = previewQuote.customer;
  quote.startDate = previewQuote.startDate;
  quote.endDate = previewQuote.endDate;
  quote.rentalDays = previewQuote.rentalDays;
  quote.itemIds = previewQuote.itemIds;
  quote.discount = previewQuote.discount;
  quote.depositOverride = previewQuote.depositOverride;
  quote.note = previewQuote.note;
  quote.lockStartAt = previewQuote.lockStartAt;
  quote.lockEndAt = previewQuote.lockEndAt;
  quote.lockedBy = previewQuote.lockedBy;
  quote.currentVersionId = previewQuote.currentVersionId;
  quote.status = previewQuote.status;
  quote.updatedAt = new Date().toISOString();

  await saveDb(db);
  return sendJson(res, 200, buildQuotationPayload(db, quote, true));
}

export async function compareVersions(req, res, quoteId) {
  const db = await loadDb();
  const quote = db.quotations.find((q) => q.id === quoteId);
  if (!quote) return sendJson(res, 404, { error: "quotation_not_found" });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const versionId1 = url.searchParams.get("v1");
  const versionId2 = url.searchParams.get("v2");

  if (!versionId1 || !versionId2) {
    return sendJson(res, 400, { error: "请指定两个版本ID进行对比" });
  }

  const v1 = (quote.versions || []).find((v) => v.versionId === versionId1);
  const v2 = (quote.versions || []).find((v) => v.versionId === versionId2);

  if (!v1 || !v2) return sendJson(res, 404, { error: "version_not_found" });

  return sendJson(res, 200, {
    v1: buildVersionPayload(db, quote, v1),
    v2: buildVersionPayload(db, quote, v2)
  });
}

export async function listQuotations(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");
  const customer = url.searchParams.get("customer");

  let list = [...db.quotations];
  if (status) list = list.filter((q) => q.status === status);
  if (customer) list = list.filter((q) => (q.customer || "") === customer);

  const result = list.map((q) => buildQuotationPayload(db, q, false));
  return sendJson(res, 200, result);
}

export async function getQuotation(req, res, id) {
  const db = await loadDb();
  const quote = db.quotations.find((q) => q.id === id);
  if (!quote) return sendJson(res, 404, { error: "quotation_not_found" });
  return sendJson(res, 200, buildQuotationPayload(db, quote, true));
}

function validateQuoteInput(input) {
  const errors = [];
  if (!input.customer || !String(input.customer).trim()) {
    errors.push("客户必填");
  }
  if (!input.startDate || !input.endDate) {
    errors.push("租期必填");
  } else if (new Date(input.endDate) < new Date(input.startDate)) {
    errors.push("结束日期不能早于开始日期");
  }
  if (!input.itemIds?.length) {
    errors.push("请至少选择一件设备");
  }
  if (input.discount != null) {
    const d = Number(input.discount);
    if (Number.isNaN(d)) errors.push("折扣格式不正确");
  }
  if (input.lockEndAt != null && input.lockEndAt !== "") {
    const lockEnd = new Date(input.lockEndAt);
    if (Number.isNaN(lockEnd.getTime())) {
      errors.push("锁定有效期格式不正确");
    } else if (input.lockStartAt != null && input.lockStartAt !== "") {
      const lockStart = new Date(input.lockStartAt);
      if (!Number.isNaN(lockStart.getTime()) && lockEnd < lockStart) {
        errors.push("锁定结束时间不能早于开始时间");
      }
    }
  }
  return errors;
}

function isCurrentVersionApproved(quote) {
  return quote.approvedVersionId != null &&
    quote.currentVersionId === quote.approvedVersionId &&
    (quote.versions || []).some(
      (v) => v.versionId === quote.currentVersionId && v.approvalStatus === "approved"
    );
}

function hasLockFieldChanged(oldData, newData) {
  for (const field of QUOTE_LOCK_KEY_FIELDS) {
    if (oldData[field] !== newData[field]) return true;
  }
  return false;
}

function hasBusinessFieldChanged(oldData, newData) {
  const oldItemIds = Array.isArray(oldData.itemIds) ? [...oldData.itemIds].sort() : [];
  const newItemIds = Array.isArray(newData.itemIds) ? [...newData.itemIds].sort() : [];
  return oldData.startDate !== newData.startDate
    || oldData.endDate !== newData.endDate
    || JSON.stringify(oldItemIds) !== JSON.stringify(newItemIds);
}

function validateQuoteConflictsForSave(db, quote, exceptQuoteId = null) {
  if (!quote.itemIds?.length || !quote.startDate || !quote.endDate) {
    return { valid: true, errors: [], repair: [], conflicts: [], quoteLocks: [], missing: [] };
  }
  return validateEquipmentForQuotation(db, quote.itemIds, quote.startDate, quote.endDate, exceptQuoteId);
}

export async function createQuotation(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  const errors = validateQuoteInput(input);
  if (errors.length) {
    return sendJson(res, 400, { error: errors.join("；") });
  }

  const quotation = {
    id: input.id?.trim() || genQuotationId(),
    customer: String(input.customer).trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    rentalDays: calcRentalDays(input.startDate, input.endDate),
    itemIds: [...new Set(input.itemIds.filter(Boolean))],
    discount: input.discount != null ? Number(input.discount) : 0,
    depositOverride: input.depositOverride || {},
    status: "草稿",
    note: input.note?.trim() || "",
    lockStartAt: input.lockStartAt || null,
    lockEndAt: input.lockEndAt || null,
    lockedBy: input.lockedBy || null,
    lockHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (db.quotations.some((q) => q.id === quotation.id)) {
    return sendJson(res, 409, { error: `报价单编号 ${quotation.id} 已存在` });
  }

  const repairItems = findRepairItems(db, quotation.itemIds);
  if (repairItems.length) {
    return sendJson(res, 409, {
      error: `维修中设备不可加入报价单：${repairItems.map((r) => `${r.id} ${r.name}`).join("、")}`
    });
  }

  const validation = validateQuoteConflictsForSave(db, quotation, quotation.id);
  if (!validation.valid) {
    return sendJson(res, 409, {
      error: validation.errors.join("；"),
      details: {
        repair: validation.repair,
        conflicts: validation.conflicts,
        quoteLocks: validation.quoteLocks,
        missing: validation.missing
      }
    });
  }
  if (quotation.lockEndAt) {
    addQuoteLockHistory(quotation, "set", {
      lockStartAt: quotation.lockStartAt,
      lockEndAt: quotation.lockEndAt,
      lockedBy: quotation.lockedBy
    });
  }

  const initialSnapshot = buildVersionSnapshot(db, quotation);
  quotation.versions = [{
    versionId: genVersionId(),
    versionNumber: 1,
    createdAt: quotation.createdAt,
    createdBy: "user",
    snapshot: initialSnapshot,
    approvalStatus: "pending",
    approvedAt: null,
    approvedBy: null,
    approvalNote: "",
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: ""
  }];
  quotation.currentVersionId = quotation.versions[0].versionId;
  quotation.approvedVersionId = null;

  db.quotations.unshift(quotation);
  await saveDb(db);
  return sendJson(res, 201, buildQuotationPayload(db, quotation, true));
}

export async function updateQuotation(req, res, id) {
  const db = await loadDb();
  const idx = db.quotations.findIndex((q) => q.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "quotation_not_found" });

  const input = await parseBody(req);
  const current = db.quotations[idx];

  if (current.status === "已转订单") {
    return sendJson(res, 400, { error: "已转订单的报价单不能修改" });
  }

  if (input.status && !QUOTE_STATUSES.includes(input.status)) {
    return sendJson(res, 400, { error: "无效的报价单状态" });
  }

  const merged = { ...current };

  if (input.customer !== undefined) merged.customer = String(input.customer).trim();
  if (input.startDate !== undefined) merged.startDate = input.startDate;
  if (input.endDate !== undefined) merged.endDate = input.endDate;
  if (merged.startDate && merged.endDate) {
    merged.rentalDays = calcRentalDays(merged.startDate, merged.endDate);
  }
  if (input.itemIds !== undefined) {
    merged.itemIds = [...new Set(input.itemIds.filter(Boolean))];
  }
  if (input.discount !== undefined) merged.discount = Number(input.discount) || 0;
  if (input.depositOverride !== undefined) merged.depositOverride = input.depositOverride;
  if (input.status !== undefined) merged.status = input.status;
  if (input.note !== undefined) merged.note = String(input.note || "").trim();

  const lockChanged = input.lockStartAt !== undefined || input.lockEndAt !== undefined || input.lockedBy !== undefined;
  const oldLockEnd = current.lockEndAt;
  const newLockEnd = input.lockEndAt !== undefined ? input.lockEndAt : current.lockEndAt;

  if (input.lockStartAt !== undefined) merged.lockStartAt = input.lockStartAt || null;
  if (input.lockEndAt !== undefined) merged.lockEndAt = input.lockEndAt || null;
  if (input.lockedBy !== undefined) merged.lockedBy = input.lockedBy || null;

  merged.updatedAt = new Date().toISOString();

  if (merged.startDate && merged.endDate && merged.itemIds?.length) {
    const errors = validateQuoteInput({
      customer: merged.customer,
      startDate: merged.startDate,
      endDate: merged.endDate,
      itemIds: merged.itemIds,
      discount: merged.discount,
      lockStartAt: merged.lockStartAt,
      lockEndAt: merged.lockEndAt
    });
    if (errors.length) {
      return sendJson(res, 400, { error: errors.join("；") });
    }
  }

  if (merged.itemIds?.length) {
    const repairItems = findRepairItems(db, merged.itemIds);
    if (repairItems.length) {
      return sendJson(res, 409, {
        error: `维修中设备不可加入报价单：${repairItems.map((r) => `${r.id} ${r.name}`).join("、")}`
      });
    }
  }

  const needsConflictCheck = hasBusinessFieldChanged(current, merged) || (lockChanged && newLockEnd && newLockEnd !== oldLockEnd);
  if (needsConflictCheck) {
    const validation = validateQuoteConflictsForSave(db, merged, merged.id);
    if (!validation.valid) {
      return sendJson(res, 409, {
        error: validation.errors.join("；"),
        details: {
          repair: validation.repair,
          conflicts: validation.conflicts,
          quoteLocks: validation.quoteLocks,
          missing: validation.missing
        }
      });
    }
  }

  if (lockChanged && newLockEnd && newLockEnd !== oldLockEnd) {
    if (!current.lockHistory) current.lockHistory = [];
    addQuoteLockHistory(current, "update", {
      oldLockStartAt: current.lockStartAt,
      oldLockEndAt: current.lockEndAt,
      oldLockedBy: current.lockedBy,
      newLockStartAt: merged.lockStartAt,
      newLockEndAt: merged.lockEndAt,
      newLockedBy: merged.lockedBy
    });
    merged.lockHistory = current.lockHistory;
  } else if (lockChanged && !newLockEnd && oldLockEnd) {
    if (!current.lockHistory) current.lockHistory = [];
    addQuoteLockHistory(current, "cancel", {
      oldLockStartAt: current.lockStartAt,
      oldLockEndAt: current.lockEndAt,
      oldLockedBy: current.lockedBy,
      canceledBy: input.lockedBy || "user"
    });
    merged.lockHistory = current.lockHistory;
  }

  if (input.status === "已确认" && !hasKeyFieldChanged(current, merged) && !hasLockFieldChanged(current, merged) && !isCurrentVersionApproved(merged)) {
    return sendJson(res, 400, { error: "只有当前版本审批通过后才能确认报价单" });
  }

  const keyFieldsChanged = hasKeyFieldChanged(current, merged) || hasLockFieldChanged(current, merged);

  if (keyFieldsChanged) {
    const versions = current.versions || [];
    const newVersionNumber = versions.length > 0
      ? Math.max(...versions.map((v) => v.versionNumber)) + 1
      : 1;

    const snapshot = buildVersionSnapshot(db, merged);

    const newVersion = {
      versionId: genVersionId(),
      versionNumber: newVersionNumber,
      createdAt: merged.updatedAt,
      createdBy: "user",
      snapshot,
      approvalStatus: "pending",
      approvedAt: null,
      approvedBy: null,
      approvalNote: "",
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: ""
    };

    versions.push(newVersion);
    merged.versions = versions;
    merged.currentVersionId = newVersion.versionId;

    if (merged.status === "已确认") {
      merged.status = "草稿";
    }
  }

  db.quotations[idx] = merged;
  await saveDb(db);

  const payload = buildQuotationPayload(db, merged, true);
  if (keyFieldsChanged) {
    payload.newVersionCreated = true;
    payload.currentVersionId = merged.currentVersionId;
  }
  return sendJson(res, 200, payload);
}

export async function deleteQuotation(req, res, id) {
  const db = await loadDb();
  const idx = db.quotations.findIndex((q) => q.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "quotation_not_found" });

  if (db.quotations[idx].status === "已转订单") {
    return sendJson(res, 400, { error: "已转订单的报价单不能删除" });
  }

  db.quotations.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}

export async function previewQuote(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);
  const itemIds = input.itemIds || [];
  const startDate = input.startDate;
  const endDate = input.endDate;
  const depositOverride = input.depositOverride || {};
  const discount = input.discount != null ? Number(input.discount) : 0;

  if (!startDate || !endDate) {
    return sendJson(res, 400, { error: "请填写完整租期" });
  }
  if (!itemIds.length) {
    return sendJson(res, 400, { error: "请至少选择一件设备" });
  }
  if (new Date(endDate) < new Date(startDate)) {
    return sendJson(res, 400, { error: "结束日期不能早于开始日期" });
  }

  const repairItems = findRepairItems(db, itemIds);
  if (repairItems.length) {
    return sendJson(res, 409, {
      error: `维修中设备不可加入报价单：${repairItems.map((r) => `${r.id} ${r.name}`).join("、")}`
    });
  }

  const validation = validateEquipmentForQuotation(db, itemIds, startDate, endDate, input.quotationId || null);
  const summary = buildQuoteSummary(db.equipment, itemIds, startDate, endDate, depositOverride, discount);

  summary.lockCheck = {
    valid: validation.valid,
    repair: validation.repair,
    conflicts: validation.conflicts,
    quoteLocks: validation.quoteLocks,
    missing: validation.missing,
    errors: validation.errors
  };

  return sendJson(res, 200, summary);
}

export async function convertToOrder(req, res, id) {
  const result = await convertQuotationToOrder(id);
  if (!result.success) {
    const body = { error: result.error };
    if (result.details) body.details = result.details;
    return sendJson(res, result.status, body);
  }
  return sendJson(res, result.status, {
    order: result.order,
    quotation: {
      id: result.quote.id,
      status: result.quote.status,
      convertedOrderId: result.quote.convertedOrderId
    }
  });
}

export async function checkConvertibility(req, res, id) {
  const db = await loadDb();
  const quote = db.quotations.find((q) => q.id === id);
  if (!quote) return sendJson(res, 404, { error: "quotation_not_found" });

  const check = isQuoteConvertible(quote);
  const response = { convertible: check.ok, reason: check.ok ? null : check.reason };

  if (check.ok && quote.itemIds?.length && quote.startDate && quote.endDate) {
    const validation = validateEquipmentForOrder(db, quote.itemIds, quote.startDate, quote.endDate, null, quote.id);
    response.equipmentCheck = {
      valid: validation.valid,
      repair: validation.repair,
      conflicts: validation.conflicts,
      quoteLocks: validation.quoteLocks,
      missing: validation.missing
    };
    if (!validation.valid) {
      response.convertible = false;
      response.reason = `转订单校验失败：${validation.errors.join("；")}`;
    }
  }

  const lockStatus = getQuoteLockStatus(quote);
  response.lockStatus = lockStatus;

  return sendJson(res, 200, response);
}
