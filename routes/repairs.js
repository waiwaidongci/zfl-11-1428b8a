import {
  loadDb,
  saveDb,
  genRepairId,
  REPAIR_STATUSES,
  REPAIR_STATUS_LABELS,
  REPAIR_SOURCE_TYPES,
  REPAIR_LIABILITY_TYPES,
  getActiveRepairByEquipmentId,
  genSettlementFeeId
} from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import {
  AUDIT_OBJECT_TYPES,
  AUDIT_ACTIONS,
  createAuditLogEntry,
  addAuditLog,
  listAuditLogs,
  buildAuditPayload
} from "../lib/audit.js";

function buildRepairPayload(db, repair) {
  const equipment = db.equipment.find((e) => e.id === repair.equipmentId);
  return {
    ...repair,
    equipment: equipment
      ? {
          id: equipment.id,
          name: equipment.name,
          category: equipment.category,
          spec: equipment.spec,
          location: equipment.location,
          condition: equipment.condition
        }
      : null
  };
}

function ensureSettlement(db, orderId) {
  let settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  const isNew = !settlement;

  if (isNew) {
    settlement = {
      id: null,
      orderId,
      quotationId: null,
      status: "draft",
      fees: [],
      note: "",
      createdAt: null,
      updatedAt: null
    };
  }

  if (!settlement.fees) settlement.fees = [];

  return { settlement, isNew };
}

function normalizeOptionalAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  return Number(value) || 0;
}

function getRepairCustomerAmount(repair) {
  const customerAmount = normalizeOptionalAmount(repair.customerAmount);
  if (customerAmount !== null) return customerAmount;
  return Number(repair.actualRepairCost || repair.repairCost || 0);
}

function syncRepairFeeToSettlement(db, repair) {
  if (!repair.orderId) return null;
  if (repair.liability !== "customer") return null;

  const amount = getRepairCustomerAmount(repair);
  if (amount <= 0) {
    removeRepairFeeFromSettlement(db, repair);
    return null;
  }

  const { settlement, isNew } = ensureSettlement(db, repair.orderId);
  if (isNew) {
    settlement.id = `S-${Date.now().toString().slice(-6)}`;
    settlement.createdAt = new Date().toISOString();
    if (!db.settlements) db.settlements = [];
    db.settlements.unshift(settlement);
  }

  const existing = (settlement.fees || []).find(
    (f) => f.type === "compensation" && f.source === "repair" && f.sourceId === repair.id
  );

  const description = `维修赔偿 - ${repair.equipmentName}（工单 ${repair.id}）`;

  if (existing) {
    existing.amount = amount;
    existing.description = description;
    existing.updatedAt = new Date().toISOString();
  } else {
    settlement.fees.push({
      id: genSettlementFeeId(),
      type: "compensation",
      amount,
      description,
      source: "repair",
      sourceId: repair.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  settlement.updatedAt = new Date().toISOString();
  return settlement;
}

function removeRepairFeeFromSettlement(db, repair) {
  if (!repair.orderId) return;

  const settlement = (db.settlements || []).find((s) => s.orderId === repair.orderId);
  if (!settlement) return;

  const beforeLen = settlement.fees?.length || 0;
  settlement.fees = (settlement.fees || []).filter(
    (f) => !(f.type === "compensation" && f.source === "repair" && f.sourceId === repair.id)
  );

  if (settlement.fees.length !== beforeLen) {
    settlement.updatedAt = new Date().toISOString();
  }
}

export async function listRepairs(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");
  const equipmentId = url.searchParams.get("equipmentId");
  const orderId = url.searchParams.get("orderId");

  let list = [...db.repairs];
  if (status) list = list.filter((r) => r.status === status);
  if (equipmentId) list = list.filter((r) => r.equipmentId === equipmentId);
  if (orderId) list = list.filter((r) => r.orderId === orderId);

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const result = list.map((r) => buildRepairPayload(db, r));
  return sendJson(res, 200, result);
}

export async function getRepair(req, res, id) {
  const db = await loadDb();
  const repair = db.repairs.find((r) => r.id === id);
  if (!repair) return sendJson(res, 404, { error: "repair_not_found" });
  return sendJson(res, 200, buildRepairPayload(db, repair));
}

export async function createRepair(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.equipmentId) {
    return sendJson(res, 400, { error: "请选择维修设备" });
  }
  if (!input.faultDescription || !String(input.faultDescription).trim()) {
    return sendJson(res, 400, { error: "请填写故障描述" });
  }

  const equipment = db.equipment.find((e) => e.id === input.equipmentId);
  if (!equipment) {
    return sendJson(res, 404, { error: "设备不存在" });
  }

  const activeRepair = getActiveRepairByEquipmentId(db, input.equipmentId);
  if (activeRepair) {
    return sendJson(res, 409, { error: `该设备已有进行中的维修工单（${activeRepair.id}）` });
  }

  const status = REPAIR_STATUSES.includes(input.status) ? input.status : "pending";
  const source = REPAIR_SOURCE_TYPES.includes(input.source) ? input.source : "manual";
  const liability = REPAIR_LIABILITY_TYPES.includes(input.liability) ? input.liability : "company";

  const repair = {
    id: input.id?.trim() || genRepairId(),
    equipmentId: input.equipmentId,
    equipmentName: equipment.name,
    faultDescription: String(input.faultDescription).trim(),
    sendTime: input.sendTime || new Date().toISOString().slice(0, 10),
    expectedReturn: input.expectedReturn || "",
    repairCost: input.repairCost != null ? Number(input.repairCost) || 0 : 0,
    actualRepairCost: input.actualRepairCost != null ? Number(input.actualRepairCost) || 0 : 0,
    status,
    note: input.note?.trim() || "",
    source,
    sourceId: input.sourceId?.trim() || null,
    orderId: input.orderId?.trim() || null,
    liability,
    customerAmount: normalizeOptionalAmount(input.customerAmount),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };

  if (db.repairs.some((r) => r.id === repair.id)) {
    return sendJson(res, 409, { error: `维修工单编号 ${repair.id} 已存在` });
  }

  equipment.condition = "repair";
  if (["completed", "cancelled"].includes(status)) {
    equipment.condition = "available";
    if (status === "completed") repair.completedAt = new Date().toISOString();
  }

  db.repairs.unshift(repair);

  if (status === "completed" && repair.orderId && repair.liability === "customer") {
    syncRepairFeeToSettlement(db, repair);
  }

  await saveDb(db);
  return sendJson(res, 201, buildRepairPayload(db, repair));
}

export async function updateRepair(req, res, id) {
  const db = await loadDb();
  const idx = db.repairs.findIndex((r) => r.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "repair_not_found" });

  const input = await parseBody(req);
  const current = db.repairs[idx];
  const equipment = db.equipment.find((e) => e.id === current.equipmentId);

  const merged = { ...current };

  if (input.faultDescription !== undefined) {
    merged.faultDescription = String(input.faultDescription).trim();
  }
  if (input.sendTime !== undefined) merged.sendTime = input.sendTime;
  if (input.expectedReturn !== undefined) merged.expectedReturn = input.expectedReturn;
  if (input.repairCost !== undefined) {
    merged.repairCost = Number(input.repairCost) || 0;
  }
  if (input.actualRepairCost !== undefined) {
    merged.actualRepairCost = Number(input.actualRepairCost) || 0;
  }
  if (input.note !== undefined) merged.note = String(input.note || "").trim();
  if (input.source !== undefined) {
    if (REPAIR_SOURCE_TYPES.includes(input.source)) {
      merged.source = input.source;
    }
  }
  if (input.sourceId !== undefined) {
    merged.sourceId = input.sourceId?.trim() || null;
  }
  if (input.orderId !== undefined) {
    merged.orderId = input.orderId?.trim() || null;
  }
  if (input.liability !== undefined) {
    if (REPAIR_LIABILITY_TYPES.includes(input.liability)) {
      merged.liability = input.liability;
    }
  }
  if (input.customerAmount !== undefined) {
    merged.customerAmount = normalizeOptionalAmount(input.customerAmount);
  }

  let statusChanged = false;
  if (input.status !== undefined) {
    if (!REPAIR_STATUSES.includes(input.status)) {
      return sendJson(res, 400, { error: "无效的维修状态" });
    }
    if (current.status === "completed" && input.status !== "completed") {
      return sendJson(res, 400, { error: "已完成的工单不能恢复为未完成状态" });
    }
    if (current.status !== input.status) {
      statusChanged = true;
    }
    merged.status = input.status;

    if (equipment) {
      if (["pending", "repairing"].includes(input.status)) {
        equipment.condition = "repair";
      } else {
        equipment.condition = "available";
      }
    }

    if (input.status === "completed" && !merged.completedAt) {
      merged.completedAt = new Date().toISOString();
    }
    if (input.status !== "completed") {
      merged.completedAt = null;
    }
  }

  const liabilityChanged =
    input.liability !== undefined && input.liability !== current.liability;
  const customerAmountChanged =
    input.customerAmount !== undefined &&
    normalizeOptionalAmount(input.customerAmount) !== normalizeOptionalAmount(current.customerAmount);
  const actualCostChanged =
    input.actualRepairCost !== undefined &&
    Number(input.actualRepairCost || 0) !== Number(current.actualRepairCost || 0);
  const orderIdChanged =
    input.orderId !== undefined &&
    (input.orderId || null) !== (current.orderId || null);

  const needSyncSettlement =
    statusChanged || liabilityChanged || customerAmountChanged || actualCostChanged || orderIdChanged;

  if (needSyncSettlement) {
    const oldOrderId = current.orderId;
    const newOrderId = merged.orderId;

    if (oldOrderId && oldOrderId !== newOrderId) {
      removeRepairFeeFromSettlement(db, current);
    }

    if (merged.status === "completed" && merged.liability === "customer" && merged.orderId) {
      syncRepairFeeToSettlement(db, merged);
    } else if (
      merged.status !== "completed" ||
      merged.liability !== "customer" ||
      !merged.orderId
    ) {
      removeRepairFeeFromSettlement(db, merged);
    }
  }

  merged.updatedAt = new Date().toISOString();
  db.repairs[idx] = merged;
  await saveDb(db);
  return sendJson(res, 200, buildRepairPayload(db, merged));
}

export async function advanceRepairStatus(req, res, id) {
  const db = await loadDb();
  const idx = db.repairs.findIndex((r) => r.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "repair_not_found" });

  const current = db.repairs[idx];
  const flow = ["pending", "repairing", "completed"];
  const currentIdx = flow.indexOf(current.status);

  if (currentIdx === -1 || currentIdx >= flow.length - 1) {
    return sendJson(res, 400, { error: "当前状态无法继续推进" });
  }

  const beforeStatus = current.status;
  const beforeCompletedAt = current.completedAt;
  const equipment = db.equipment.find((e) => e.id === current.equipmentId);
  const beforeEquipmentCondition = equipment ? equipment.condition : null;

  const nextStatus = flow[currentIdx + 1];
  current.status = nextStatus;
  current.updatedAt = new Date().toISOString();

  let settlementFeeId = null;
  if (nextStatus === "completed") {
    current.completedAt = new Date().toISOString();
    if (equipment) equipment.condition = "available";

    if (current.orderId && current.liability === "customer") {
      const settlement = syncRepairFeeToSettlement(db, current);
      if (settlement) {
        const fee = (settlement.fees || []).find(
          (f) => f.type === "compensation" && f.source === "repair" && f.sourceId === current.id
        );
        if (fee) settlementFeeId = fee.id;
      }
    }
  } else if (equipment) {
    equipment.condition = "repair";
  }

  const auditEntry = createAuditLogEntry({
    objectType: AUDIT_OBJECT_TYPES.REPAIR,
    objectId: id,
    action: AUDIT_ACTIONS.STATUS_ADVANCE,
    summary: `维修工单 ${id} 状态推进: ${REPAIR_STATUS_LABELS[beforeStatus] || beforeStatus} → ${REPAIR_STATUS_LABELS[nextStatus] || nextStatus}`,
    detail: `设备: ${current.equipmentName} (${current.equipmentId}), 原状态: ${beforeStatus}, 新状态: ${nextStatus}`,
    before: {
      status: beforeStatus,
      completedAt: beforeCompletedAt,
      equipmentCondition: beforeEquipmentCondition
    },
    after: {
      status: nextStatus,
      completedAt: current.completedAt,
      equipmentCondition: equipment ? equipment.condition : null
    },
    changedFields: {
      status: { before: beforeStatus, after: nextStatus }
    },
    operator: "user",
    reversible: true,
    extra: {
      settlementFeeId,
      equipmentId: current.equipmentId,
      orderId: current.orderId
    }
  });
  await addAuditLog(db, auditEntry);

  db.repairs[idx] = current;
  await saveDb(db);
  return sendJson(res, 200, buildRepairPayload(db, current));
}

export async function deleteRepair(req, res, id) {
  const db = await loadDb();
  const idx = db.repairs.findIndex((r) => r.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "repair_not_found" });

  const repair = db.repairs[idx];
  if (["pending", "repairing"].includes(repair.status)) {
    const equipment = db.equipment.find((e) => e.id === repair.equipmentId);
    if (equipment) equipment.condition = "available";
  }

  removeRepairFeeFromSettlement(db, repair);

  db.repairs.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}

export async function getEquipmentRepairs(req, res, equipmentId) {
  const db = await loadDb();
  const list = db.repairs
    .filter((r) => r.equipmentId === equipmentId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sendJson(res, 200, list.map((r) => buildRepairPayload(db, r)));
}
