import { overlaps, occupiedItems } from "../data/db.js";

export function findRepairItems(db, itemIds) {
  return db.equipment
    .filter((item) => itemIds.includes(item.id) && item.condition === "repair")
    .map((item) => ({ id: item.id, name: item.name }));
}

export function findConflictItems(db, itemIds, startDate, endDate, exceptOrderId) {
  const occupied = occupiedItems(db, startDate, endDate, exceptOrderId);
  const conflicts = itemIds.filter((id) => occupied.has(id));
  if (!conflicts.length) return [];

  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  return conflicts.map((id) => {
    const eq = eqMap.get(id);
    const conflictingOrder = db.orders.find((o) =>
      o.id !== exceptOrderId &&
      !["已取消", "已归还"].includes(o.status) &&
      o.itemIds.includes(id) &&
      overlaps(startDate, endDate, o.startDate, o.endDate)
    );
    return {
      id,
      name: eq ? eq.name : id,
      conflictOrderId: conflictingOrder ? conflictingOrder.id : null,
      conflictOrderCustomer: conflictingOrder ? conflictingOrder.customer : null,
      conflictRange: conflictingOrder ? `${conflictingOrder.startDate} ~ ${conflictingOrder.endDate}` : null
    };
  });
}

export function findMissingItems(db, itemIds) {
  const eqIds = new Set(db.equipment.map((e) => e.id));
  return itemIds.filter((id) => !eqIds.has(id));
}

export function validateEquipmentForOrder(db, itemIds, startDate, endDate, exceptOrderId = null) {
  const errors = [];

  if (!itemIds || !itemIds.length) {
    errors.push("请至少选择一件设备");
    return { valid: false, errors, repair: [], conflicts: [], missing: [] };
  }

  const missing = findMissingItems(db, itemIds);
  if (missing.length) {
    errors.push(`设备不存在：${missing.join("、")}`);
  }

  const repair = findRepairItems(db, itemIds);
  if (repair.length) {
    errors.push(`维修中设备：${repair.map((r) => `${r.id} ${r.name}`).join("、")}`);
  }

  const conflicts = findConflictItems(db, itemIds, startDate, endDate, exceptOrderId);
  if (conflicts.length) {
    errors.push(
      `租期冲突：${conflicts.map((c) => `${c.id} ${c.name}（${c.conflictOrderCustomer || c.conflictOrderId} ${c.conflictRange || ""}）`).join("；")}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    repair,
    conflicts,
    missing
  };
}
