import { loadDb, saveDb } from "../data/db.js";

export const AUDIT_OBJECT_TYPES = {
  EQUIPMENT: "equipment",
  QUOTATION: "quotation",
  QUOTATION_VERSION: "quotation_version",
  ORDER: "order",
  HANDOVER: "handover",
  REPAIR: "repair",
  SETTLEMENT: "settlement",
  SETTLEMENT_FEE: "settlement_fee",
  PAYMENT: "payment",
  STOCKTAKE: "stocktake",
  STOCKTAKE_ITEM: "stocktake_item"
};

export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  APPROVE: "approve",
  REJECT: "reject",
  RESTORE: "restore",
  CONVERT_TO_ORDER: "convert_to_order",
  STATUS_ADVANCE: "status_advance",
  STATUS_REVERT: "status_revert",
  CHECKOUT: "checkout",
  RETURN: "return",
  ADD_FEE: "add_fee",
  UPDATE_FEE: "update_fee",
  DELETE_FEE: "delete_fee",
  ADD_PAYMENT: "add_payment",
  UPDATE_PAYMENT: "update_payment",
  DELETE_PAYMENT: "delete_payment",
  PROCESS_DAMAGED: "process_damaged",
  PROCESS_MISSING: "process_missing",
  PROCESS_MISMATCH: "process_mismatch",
  MARK_PROCESSED: "mark_processed",
  REVERT: "revert"
};

export const AUDIT_ACTION_LABELS = {
  create: "创建",
  update: "修改",
  delete: "删除",
  approve: "审批通过",
  reject: "审批驳回",
  restore: "恢复版本",
  convert_to_order: "转订单",
  status_advance: "状态推进",
  status_revert: "状态回退",
  checkout: "出库交接",
  return: "归还交接",
  add_fee: "添加费用",
  update_fee: "修改费用",
  delete_fee: "删除费用",
  add_payment: "添加收款",
  update_payment: "修改收款",
  delete_payment: "删除收款",
  process_damaged: "处理损坏",
  process_missing: "处理丢失",
  process_mismatch: "处理位置不符",
  mark_processed: "标记已处理",
  revert: "撤销操作"
};

export const REVERSIBLE_ACTIONS = new Set([
  AUDIT_ACTIONS.DELETE_FEE,
  AUDIT_ACTIONS.STATUS_ADVANCE,
  AUDIT_ACTIONS.PROCESS_DAMAGED,
  AUDIT_ACTIONS.PROCESS_MISSING,
  AUDIT_ACTIONS.PROCESS_MISMATCH
]);

function genAuditLogId() {
  return `AUD-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6)}`;
}

function deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function getChangedFields(before, after, fields = null) {
  const changes = {};
  const keys = fields || new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const oldVal = before ? before[key] : undefined;
    const newVal = after ? after[key] : undefined;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { before: oldVal, after: newVal };
    }
  }
  return changes;
}

export function createAuditLogEntry({
  objectType,
  objectId,
  action,
  summary = "",
  detail = "",
  before = null,
  after = null,
  changedFields = null,
  operator = "user",
  reversible = false,
  extra = {}
}) {
  return {
    id: genAuditLogId(),
    timestamp: new Date().toISOString(),
    objectType,
    objectId,
    action,
    actionLabel: AUDIT_ACTION_LABELS[action] || action,
    summary,
    detail,
    before: before ? deepClone(before) : null,
    after: after ? deepClone(after) : null,
    changedFields: changedFields || (before && after ? getChangedFields(before, after) : null),
    operator,
    reversible: reversible && REVERSIBLE_ACTIONS.has(action),
    reverted: false,
    revertedAt: null,
    revertedBy: null,
    ...extra
  };
}

export async function addAuditLog(db, entry) {
  if (!db.auditLogs) db.auditLogs = [];
  db.auditLogs.unshift(entry);
  return entry;
}

export async function listAuditLogs(db, { objectType = null, objectId = null, objectIdPrefix = null, action = null, orderId = null, limit = 100 } = {}) {
  let logs = db.auditLogs || [];
  if (objectType) logs = logs.filter((l) => l.objectType === objectType);
  if (objectId || objectIdPrefix) {
    logs = logs.filter((l) => (
      (objectId && l.objectId === objectId)
      || (objectIdPrefix && String(l.objectId || "").startsWith(objectIdPrefix))
    ));
  }
  if (action) logs = logs.filter((l) => l.action === action);
  if (orderId) logs = logs.filter((l) => l.orderId === orderId || l.extra?.orderId === orderId);
  if (limit) logs = logs.slice(0, limit);
  return logs;
}

export async function getAuditLog(db, logId) {
  return (db.auditLogs || []).find((l) => l.id === logId);
}

export async function markAuditLogReverted(db, logId, operator = "user") {
  const log = (db.auditLogs || []).find((l) => l.id === logId);
  if (log) {
    log.reverted = true;
    log.revertedAt = new Date().toISOString();
    log.revertedBy = operator;
  }
  return log;
}

export async function revertAuditLog(logId, operator = "user") {
  const db = await loadDb();
  const log = await getAuditLog(db, logId);

  if (!log) {
    return { success: false, error: "audit_log_not_found" };
  }

  if (log.reverted) {
    return { success: false, error: "该操作已被撤销" };
  }

  if (!log.reversible || !REVERSIBLE_ACTIONS.has(log.action)) {
    return { success: false, error: "该操作不支持撤销" };
  }

  let result = { success: false };

  switch (log.action) {
    case AUDIT_ACTIONS.DELETE_FEE:
      result = await revertDeleteFee(db, log);
      break;
    case AUDIT_ACTIONS.STATUS_ADVANCE:
      result = await revertStatusAdvance(db, log);
      break;
    case AUDIT_ACTIONS.PROCESS_DAMAGED:
      result = await revertProcessDamaged(db, log);
      break;
    case AUDIT_ACTIONS.PROCESS_MISSING:
      result = await revertProcessMissing(db, log);
      break;
    case AUDIT_ACTIONS.PROCESS_MISMATCH:
      result = await revertProcessMismatch(db, log);
      break;
    default:
      result = { success: false, error: "不支持撤销的操作类型" };
  }

  if (result.success) {
    await markAuditLogReverted(db, logId, operator);
    const revertEntry = createAuditLogEntry({
      objectType: log.objectType,
      objectId: log.objectId,
      action: AUDIT_ACTIONS.REVERT,
      summary: `撤销操作：${log.actionLabel} - ${log.summary}`,
      detail: `撤销了 ${log.timestamp} 的操作，原操作ID: ${logId}`,
      operator,
      reversible: false,
      extra: { revertedLogId: logId }
    });
    await addAuditLog(db, revertEntry);
    await saveDb(db);
  }

  return result;
}

async function revertDeleteFee(db, log) {
  if (!log.before) {
    return { success: false, error: "缺少撤销所需的原始数据" };
  }

  const orderId = log.orderId;
  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (!settlement) {
    return { success: false, error: "结算记录不存在" };
  }

  if (!settlement.fees) settlement.fees = [];

  const existing = settlement.fees.find((f) => f.id === log.before.id);
  if (existing) {
    return { success: false, error: "该费用已存在" };
  }

  settlement.fees.push(deepClone(log.before));
  settlement.updatedAt = new Date().toISOString();

  return { success: true, message: "已恢复被删除的费用" };
}

async function revertStatusAdvance(db, log) {
  if (log.objectType !== AUDIT_OBJECT_TYPES.REPAIR) {
    return { success: false, error: "仅支持撤销维修状态推进" };
  }

  if (!log.before) {
    return { success: false, error: "缺少撤销所需的原始数据" };
  }

  const repairIdx = db.repairs.findIndex((r) => r.id === log.objectId);
  if (repairIdx === -1) {
    return { success: false, error: "维修工单不存在" };
  }

  const repair = db.repairs[repairIdx];
  const prevStatus = log.before.status;

  if (!["pending", "repairing"].includes(prevStatus)) {
    return { success: false, error: "无法撤销到该状态" };
  }

  repair.status = prevStatus;
  repair.updatedAt = new Date().toISOString();

  if (prevStatus !== "completed") {
    repair.completedAt = null;
  }

  const equipment = db.equipment.find((e) => e.id === repair.equipmentId);
  if (equipment) {
    if (["pending", "repairing"].includes(prevStatus)) {
      equipment.condition = "repair";
    }
  }

  if (log.extra && log.extra.settlementFeeId) {
    const orderId = repair.orderId;
    const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
    if (settlement) {
      settlement.fees = (settlement.fees || []).filter(
        (f) => !(f.type === "compensation" && f.source === "repair" && f.sourceId === repair.id)
      );
      settlement.updatedAt = new Date().toISOString();
    }
  }

  return { success: true, message: "已撤销维修状态推进" };
}

async function revertProcessDamaged(db, log) {
  if (!log.extra || !log.extra.stocktakeId || !log.extra.equipmentId) {
    return { success: false, error: "缺少撤销所需的关联数据" };
  }

  const { stocktakeId, equipmentId, repairId } = log.extra;

  const stocktake = (db.stocktakes || []).find((s) => s.id === stocktakeId);
  if (!stocktake) {
    return { success: false, error: "盘点任务不存在" };
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) {
    return { success: false, error: "盘点项不存在" };
  }

  if (repairId) {
    const repairIdx = db.repairs.findIndex((r) => r.id === repairId);
    if (repairIdx !== -1) {
      const repair = db.repairs[repairIdx];
      if (["pending", "repairing"].includes(repair.status)) {
        const equipment = db.equipment.find((e) => e.id === equipmentId);
        if (equipment && equipment.condition === "repair") {
          equipment.condition = "available";
        }
        db.repairs.splice(repairIdx, 1);
      } else {
        return { success: false, error: "关联的维修工单已完成或取消，无法撤销" };
      }
    }
  }

  item.processed = false;
  item.linkedRepairId = null;

  const equipment = db.equipment.find((e) => e.id === equipmentId);
  if (equipment && equipment.condition === "repair") {
    equipment.condition = "available";
  }

  return { success: true, message: "已撤销损坏处理" };
}

async function revertProcessMissing(db, log) {
  if (!log.extra || !log.extra.stocktakeId || !log.extra.equipmentId) {
    return { success: false, error: "缺少撤销所需的关联数据" };
  }

  const { stocktakeId, equipmentId } = log.extra;

  const stocktake = (db.stocktakes || []).find((s) => s.id === stocktakeId);
  if (!stocktake) {
    return { success: false, error: "盘点任务不存在" };
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) {
    return { success: false, error: "盘点项不存在" };
  }

  item.processed = false;

  const equipment = db.equipment.find((e) => e.id === equipmentId);
  if (equipment) {
    equipment.condition = log.before ? log.before.equipmentCondition : "available";
  }

  return { success: true, message: "已撤销丢失处理" };
}

async function revertProcessMismatch(db, log) {
  if (!log.extra || !log.extra.stocktakeId || !log.extra.equipmentId) {
    return { success: false, error: "缺少撤销所需的关联数据" };
  }

  const { stocktakeId, equipmentId } = log.extra;

  const stocktake = (db.stocktakes || []).find((s) => s.id === stocktakeId);
  if (!stocktake) {
    return { success: false, error: "盘点任务不存在" };
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) {
    return { success: false, error: "盘点项不存在" };
  }

  item.processed = false;

  if (log.before && log.before.equipmentLocation !== undefined) {
    const equipment = db.equipment.find((e) => e.id === equipmentId);
    if (equipment) {
      equipment.location = log.before.equipmentLocation;
    }
  }

  return { success: true, message: "已撤销位置不符处理" };
}

export function buildAuditPayload(log) {
  return {
    id: log.id,
    timestamp: log.timestamp,
    objectType: log.objectType,
    objectId: log.objectId,
    action: log.action,
    actionLabel: log.actionLabel,
    summary: log.summary,
    detail: log.detail,
    changedFields: log.changedFields,
    operator: log.operator,
    reversible: log.reversible,
    reverted: log.reverted,
    revertedAt: log.revertedAt,
    revertedBy: log.revertedBy,
    orderId: log.orderId || null
  };
}
