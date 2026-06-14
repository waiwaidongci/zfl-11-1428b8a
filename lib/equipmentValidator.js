import { overlaps, occupiedItems, findQuoteLockConflicts, occupiedItemsWithLocks } from "../data/db.js";

export function findRepairItems(db, itemIds) {
  return db.equipment
    .filter((item) => itemIds.includes(item.id) && item.condition === "repair")
    .map((item) => ({ id: item.id, name: item.name }));
}

export function findConflictItems(db, itemIds, startDate, endDate, exceptOrderId, exceptQuoteId = null) {
  const occupied = occupiedItemsWithLocks(db, startDate, endDate, exceptOrderId, exceptQuoteId);
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
    const conflictingQuote = db.quotations.find((q) =>
      q.id !== exceptQuoteId &&
      !["已转订单", "已取消"].includes(q.status) &&
      q.itemIds?.includes(id) &&
      overlaps(startDate, endDate, q.startDate, q.endDate) &&
      (() => {
        if (!q.lockEndAt) return false;
        const now = new Date();
        return now <= new Date(q.lockEndAt);
      })()
    );
    return {
      id,
      name: eq ? eq.name : id,
      conflictOrderId: conflictingOrder ? conflictingOrder.id : null,
      conflictOrderCustomer: conflictingOrder ? conflictingOrder.customer : null,
      conflictQuoteId: conflictingQuote ? conflictingQuote.id : null,
      conflictQuoteCustomer: conflictingQuote ? conflictingQuote.customer : null,
      conflictQuoteLockEndAt: conflictingQuote ? conflictingQuote.lockEndAt : null,
      conflictRange: conflictingOrder
        ? `${conflictingOrder.startDate} ~ ${conflictingOrder.endDate}`
        : conflictingQuote
          ? `${conflictingQuote.startDate} ~ ${conflictingQuote.endDate}`
          : null,
      conflictType: conflictingOrder ? "order" : (conflictingQuote ? "quote_lock" : "unknown")
    };
  });
}

export function findMissingItems(db, itemIds) {
  const eqIds = new Set(db.equipment.map((e) => e.id));
  return itemIds.filter((id) => !eqIds.has(id));
}

export function validateEquipmentForOrder(db, itemIds, startDate, endDate, exceptOrderId = null, exceptQuoteId = null) {
  const errors = [];

  if (!itemIds || !itemIds.length) {
    errors.push("请至少选择一件设备");
    return { valid: false, errors, repair: [], conflicts: [], quoteLocks: [], missing: [] };
  }

  const missing = findMissingItems(db, itemIds);
  if (missing.length) {
    errors.push(`设备不存在：${missing.join("、")}`);
  }

  const repair = findRepairItems(db, itemIds);
  if (repair.length) {
    errors.push(`维修中设备：${repair.map((r) => `${r.id} ${r.name}`).join("、")}`);
  }

  const allConflicts = findConflictItems(db, itemIds, startDate, endDate, exceptOrderId, exceptQuoteId);
  const orderConflicts = allConflicts.filter((c) => c.conflictType === "order");
  const quoteLockConflicts = allConflicts.filter((c) => c.conflictType === "quote_lock");

  if (orderConflicts.length) {
    errors.push(
      `租期冲突：${orderConflicts.map((c) => `${c.id} ${c.name}（${c.conflictOrderCustomer || c.conflictOrderId} ${c.conflictRange || ""}）`).join("；")}`
    );
  }

  if (quoteLockConflicts.length) {
    errors.push(
      `报价锁定冲突：${quoteLockConflicts.map((c) => {
        const lockEnd = c.conflictQuoteLockEndAt ? `，锁定至 ${c.conflictQuoteLockEndAt.replace("T", " ").slice(0, 16)}` : "";
        return `${c.id} ${c.name}（报价 ${c.conflictQuoteId} ${c.conflictQuoteCustomer || ""}${lockEnd}，租期 ${c.conflictRange || ""}）`;
      }).join("；")}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    repair,
    conflicts: orderConflicts,
    quoteLocks: quoteLockConflicts,
    missing
  };
}

export function validateEquipmentForQuotation(db, itemIds, startDate, endDate, exceptQuoteId = null) {
  return validateEquipmentForOrder(db, itemIds, startDate, endDate, null, exceptQuoteId);
}
