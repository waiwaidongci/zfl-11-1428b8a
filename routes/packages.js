import { loadDb, saveDb, genPackageId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import { findRepairItems, findMissingItems } from "../lib/equipmentValidator.js";
import { findConflictItems } from "../lib/equipmentValidator.js";

function buildPackagePayload(db, pkg) {
  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const items = (pkg.itemIds || []).map((iid) => {
    const eq = eqMap.get(iid);
    return {
      id: iid,
      name: eq ? eq.name : "（已删除）",
      spec: eq ? eq.spec : "",
      category: eq ? eq.category : "",
      condition: eq ? eq.condition : "unknown",
      exists: !!eq
    };
  });

  return {
    ...pkg,
    items,
    itemCount: (pkg.itemIds || []).length
  };
}

export async function listPackages(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const category = url.searchParams.get("category");

  let list = [...(db.packages || [])];
  if (category) list = list.filter((p) => (p.category || "") === category);

  const result = list.map((p) => buildPackagePayload(db, p));
  return sendJson(res, 200, result);
}

export async function getPackage(req, res, id) {
  const db = await loadDb();
  const pkg = (db.packages || []).find((p) => p.id === id);
  if (!pkg) return sendJson(res, 404, { error: "package_not_found" });
  return sendJson(res, 200, buildPackagePayload(db, pkg));
}

export async function createPackage(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  const errors = [];
  if (!input.name || !String(input.name).trim()) {
    errors.push("套餐名称必填");
  }
  if (!input.itemIds || !Array.isArray(input.itemIds) || input.itemIds.length === 0) {
    errors.push("请至少选择一件设备");
  }
  if (errors.length) {
    return sendJson(res, 400, { error: errors.join("；") });
  }

  const missing = findMissingItems(db, input.itemIds);
  if (missing.length) {
    return sendJson(res, 409, { error: `设备不存在：${missing.join("、")}` });
  }

  const pkg = {
    id: input.id?.trim() || genPackageId(),
    name: String(input.name).trim(),
    category: input.category?.trim() || "通用",
    description: input.description?.trim() || "",
    itemIds: [...new Set(input.itemIds.filter(Boolean))],
    depositOverrides: input.depositOverrides || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if ((db.packages || []).some((p) => p.id === pkg.id)) {
    return sendJson(res, 409, { error: `套餐编号 ${pkg.id} 已存在` });
  }

  if (!db.packages) db.packages = [];
  db.packages.unshift(pkg);
  await saveDb(db);
  return sendJson(res, 201, buildPackagePayload(db, pkg));
}

export async function updatePackage(req, res, id) {
  const db = await loadDb();
  const idx = (db.packages || []).findIndex((p) => p.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "package_not_found" });

  const input = await parseBody(req);
  const current = db.packages[idx];

  if (input.name !== undefined) {
    const trimmed = String(input.name).trim();
    if (!trimmed) return sendJson(res, 400, { error: "套餐名称不能为空" });
    current.name = trimmed;
  }
  if (input.category !== undefined) current.category = input.category?.trim() || "通用";
  if (input.description !== undefined) current.description = input.description?.trim() || "";
  if (input.itemIds !== undefined) {
    const itemIds = [...new Set(input.itemIds.filter(Boolean))];
    if (itemIds.length === 0) {
      return sendJson(res, 400, { error: "套餐至少需要一件设备" });
    }
    const missing = findMissingItems(db, itemIds);
    if (missing.length) {
      return sendJson(res, 409, { error: `设备不存在：${missing.join("、")}` });
    }
    current.itemIds = itemIds;
  }
  if (input.depositOverrides !== undefined) current.depositOverrides = input.depositOverrides || {};

  current.updatedAt = new Date().toISOString();
  db.packages[idx] = current;
  await saveDb(db);
  return sendJson(res, 200, buildPackagePayload(db, current));
}

export async function deletePackage(req, res, id) {
  const db = await loadDb();
  const idx = (db.packages || []).findIndex((p) => p.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "package_not_found" });

  db.packages.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}

export async function checkPackageAvailability(req, res, id) {
  const db = await loadDb();
  const pkg = (db.packages || []).find((p) => p.id === id);
  if (!pkg) return sendJson(res, 404, { error: "package_not_found" });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const exceptQuoteId = url.searchParams.get("exceptQuoteId") || null;

  const itemIds = pkg.itemIds || [];
  const missing = findMissingItems(db, itemIds);
  const repair = findRepairItems(db, itemIds);

  let conflicts = [];
  let quoteLocks = [];
  if (startDate && endDate) {
    const allConflicts = findConflictItems(db, itemIds, startDate, endDate, null, exceptQuoteId);
    conflicts = allConflicts.filter((c) => c.conflictType === "order");
    quoteLocks = allConflicts.filter((c) => c.conflictType === "quote_lock");
  }

  const issues = [];
  missing.forEach((id) => issues.push({ type: "missing", id, name: id }));
  repair.forEach((r) => issues.push({ type: "repair", id: r.id, name: r.name }));
  conflicts.forEach((c) => issues.push({
    type: "conflict",
    id: c.id,
    name: c.name,
    conflictOrderId: c.conflictOrderId,
    conflictOrderCustomer: c.conflictOrderCustomer,
    conflictRange: c.conflictRange
  }));
  quoteLocks.forEach((c) => issues.push({
    type: "quote_lock",
    id: c.id,
    name: c.name,
    conflictQuoteId: c.conflictQuoteId,
    conflictQuoteCustomer: c.conflictQuoteCustomer,
    conflictRange: c.conflictRange,
    lockEndAt: c.conflictQuoteLockEndAt
  }));

  return sendJson(res, 200, {
    packageId: pkg.id,
    packageName: pkg.name,
    totalItems: itemIds.length,
    available: missing.length + repair.length + conflicts.length + quoteLocks.length === 0,
    missing,
    repair,
    conflicts,
    quoteLocks,
    issues
  });
}

export async function previewPackageQuote(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);
  const packageIds = input.packageIds || [];
  const extraItemIds = input.extraItemIds || [];
  const startDate = input.startDate;
  const endDate = input.endDate;
  const discount = input.discount != null ? Number(input.discount) : 0;

  if (!startDate || !endDate) {
    return sendJson(res, 400, { error: "请填写完整租期" });
  }
  if (!packageIds.length && !extraItemIds.length) {
    return sendJson(res, 400, { error: "请至少选择一个套餐或一件设备" });
  }

  const allItemIds = new Set(extraItemIds);
  const allDepositOverrides = { ...(input.depositOverrides || {}) };
  const packagesUsed = [];

  for (const pid of packageIds) {
    const pkg = (db.packages || []).find((p) => p.id === pid);
    if (!pkg) continue;
    packagesUsed.push({
      id: pkg.id,
      name: pkg.name,
      category: pkg.category || "通用",
      itemCount: (pkg.itemIds || []).length
    });
    (pkg.itemIds || []).forEach((iid) => allItemIds.add(iid));
    if (pkg.depositOverrides) {
      for (const [iid, dep] of Object.entries(pkg.depositOverrides)) {
        if (!allDepositOverrides[iid]) {
          allDepositOverrides[iid] = { ...dep };
        }
      }
    }
  }

  const itemIdsArr = [...allItemIds];

  const { buildQuoteSummary } = await import("../lib/quoteCalculator.js");
  const summary = buildQuoteSummary(db.equipment, itemIdsArr, startDate, endDate, allDepositOverrides, discount);

  summary.packagesUsed = packagesUsed;
  summary.depositOverrides = allDepositOverrides;
  summary.itemIds = itemIdsArr;

  return sendJson(res, 200, summary);
}
