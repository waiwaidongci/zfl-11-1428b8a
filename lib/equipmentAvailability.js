import { overlaps, getQuoteLockStatus, getActiveRepairByEquipmentId } from "../data/db.js";

export const CONFLICT_TYPES = {
  NOT_FOUND: "not_found",
  MISSING: "missing",
  REPAIR: "repair",
  RENTED: "rented",
  ORDER_RENTAL: "order_rental",
  QUOTE_LOCK: "quote_lock"
};

export const CONFLICT_TYPE_LABELS = {
  not_found: "设备不存在",
  missing: "设备已缺失",
  repair: "维修中",
  rented: "租赁中",
  order_rental: "租期冲突",
  quote_lock: "报价锁定"
};

export const DEFAULT_CHECK_TYPES = [
  CONFLICT_TYPES.NOT_FOUND,
  CONFLICT_TYPES.MISSING,
  CONFLICT_TYPES.REPAIR,
  CONFLICT_TYPES.RENTED,
  CONFLICT_TYPES.ORDER_RENTAL,
  CONFLICT_TYPES.QUOTE_LOCK
];

export const ORDER_CHECK_TYPES = [
  CONFLICT_TYPES.NOT_FOUND,
  CONFLICT_TYPES.MISSING,
  CONFLICT_TYPES.REPAIR,
  CONFLICT_TYPES.RENTED,
  CONFLICT_TYPES.ORDER_RENTAL,
  CONFLICT_TYPES.QUOTE_LOCK
];

export const QUOTATION_CHECK_TYPES = [
  CONFLICT_TYPES.NOT_FOUND,
  CONFLICT_TYPES.MISSING,
  CONFLICT_TYPES.REPAIR,
  CONFLICT_TYPES.ORDER_RENTAL,
  CONFLICT_TYPES.QUOTE_LOCK
];

export const STOCKTAKE_EXCLUDE_TYPES = [
  CONFLICT_TYPES.RENTED,
  CONFLICT_TYPES.REPAIR
];

function buildEquipmentMap(db) {
  return new Map(db.equipment.map((e) => [e.id, e]));
}

function findConflictsForEquipment(db, equipmentId, options, eqMap) {
  const conflicts = [];
  const eq = eqMap.get(equipmentId);

  const {
    startDate,
    endDate,
    exceptOrderId = null,
    exceptQuoteId = null,
    checkTypes = DEFAULT_CHECK_TYPES
  } = options;

  if (checkTypes.includes(CONFLICT_TYPES.NOT_FOUND) && !eq) {
    conflicts.push({
      type: CONFLICT_TYPES.NOT_FOUND,
      equipmentId,
      equipmentName: equipmentId,
      reason: "设备不存在"
    });
    return conflicts;
  }

  if (!eq) return conflicts;

  if (checkTypes.includes(CONFLICT_TYPES.MISSING) && eq.condition === "missing") {
    conflicts.push({
      type: CONFLICT_TYPES.MISSING,
      equipmentId,
      equipmentName: eq.name,
      equipmentCategory: eq.category,
      equipmentSpec: eq.spec,
      reason: "设备已标记为缺失"
    });
  }

  if (checkTypes.includes(CONFLICT_TYPES.REPAIR) && eq.condition === "repair") {
    const activeRepair = getActiveRepairByEquipmentId(db, equipmentId);
    if (!options.repairRequiresActiveTicket || activeRepair) {
      conflicts.push({
        type: CONFLICT_TYPES.REPAIR,
        equipmentId,
        equipmentName: eq.name,
        equipmentCategory: eq.category,
        equipmentSpec: eq.spec,
        repairId: activeRepair ? activeRepair.id : null,
        repairStatus: activeRepair ? activeRepair.status : null,
        faultDescription: activeRepair ? activeRepair.faultDescription : null,
        expectedReturn: activeRepair ? activeRepair.expectedReturn : null,
        reason: activeRepair ? `维修中：${activeRepair.faultDescription || "未填写故障描述"}` : "设备状态为维修中"
      });
    }
  }

  if (checkTypes.includes(CONFLICT_TYPES.RENTED) && eq.condition === "rented") {
    const rentedOrder = db.orders.find(
      (o) =>
        !["已取消", "已归还"].includes(o.status) &&
        o.itemIds.includes(equipmentId)
    );
    if (!options.rentedRequiresActiveOrder || rentedOrder) {
      conflicts.push({
        type: CONFLICT_TYPES.RENTED,
        equipmentId,
        equipmentName: eq.name,
        equipmentCategory: eq.category,
        equipmentSpec: eq.spec,
        orderId: rentedOrder ? rentedOrder.id : null,
        orderCustomer: rentedOrder ? rentedOrder.customer : null,
        orderStatus: rentedOrder ? rentedOrder.status : null,
        reason: rentedOrder ? `租赁中：${rentedOrder.customer || rentedOrder.id}` : "设备状态为租赁中"
      });
    }
  }

  if (checkTypes.includes(CONFLICT_TYPES.ORDER_RENTAL) && startDate && endDate) {
    const conflictingOrders = db.orders.filter(
      (o) =>
        o.id !== exceptOrderId &&
        !["已取消", "已归还"].includes(o.status) &&
        o.itemIds.includes(equipmentId) &&
        overlaps(startDate, endDate, o.startDate, o.endDate)
    );

    for (const order of conflictingOrders) {
      conflicts.push({
        type: CONFLICT_TYPES.ORDER_RENTAL,
        equipmentId,
        equipmentName: eq.name,
        equipmentCategory: eq.category,
        equipmentSpec: eq.spec,
        orderId: order.id,
        orderCustomer: order.customer,
        orderStatus: order.status,
        conflictStartDate: order.startDate,
        conflictEndDate: order.endDate,
        conflictRange: `${order.startDate} ~ ${order.endDate}`,
        reason: `租期冲突：${order.customer || order.id}（${order.startDate} ~ ${order.endDate}）`
      });
    }
  }

  if (checkTypes.includes(CONFLICT_TYPES.QUOTE_LOCK) && startDate && endDate) {
    const conflictingQuotes = db.quotations.filter(
      (q) =>
        q.id !== exceptQuoteId &&
        !["已转订单", "已取消"].includes(q.status) &&
        q.itemIds?.includes(equipmentId) &&
        overlaps(startDate, endDate, q.startDate, q.endDate) &&
        getQuoteLockStatus(q).locked
    );

    for (const quote of conflictingQuotes) {
      const lockStatus = getQuoteLockStatus(quote);
      conflicts.push({
        type: CONFLICT_TYPES.QUOTE_LOCK,
        equipmentId,
        equipmentName: eq.name,
        equipmentCategory: eq.category,
        equipmentSpec: eq.spec,
        quoteId: quote.id,
        quoteCustomer: quote.customer,
        quoteStatus: quote.status,
        conflictStartDate: quote.startDate,
        conflictEndDate: quote.endDate,
        conflictRange: `${quote.startDate} ~ ${quote.endDate}`,
        lockStartAt: quote.lockStartAt,
        lockEndAt: quote.lockEndAt,
        lockedBy: quote.lockedBy || null,
        lockRemainingMs: lockStatus.locked ? lockStatus.remainingMs : null,
        reason: `报价锁定：${quote.customer || quote.id}（租期 ${quote.startDate} ~ ${quote.endDate}，锁定至 ${quote.lockEndAt?.replace("T", " ").slice(0, 16) || ""}）`
      });
    }
  }

  return conflicts;
}

export function checkEquipmentAvailability(db, options) {
  const {
    itemIds = [],
    startDate = null,
    endDate = null,
    exceptOrderId = null,
    exceptQuoteId = null,
    checkTypes = DEFAULT_CHECK_TYPES,
    includeEquipmentInfo = true
  } = options;

  const eqMap = buildEquipmentMap(db);
  const allConflicts = [];

  for (const equipmentId of itemIds) {
    const conflicts = findConflictsForEquipment(
      db,
      equipmentId,
      { startDate, endDate, exceptOrderId, exceptQuoteId, checkTypes },
      eqMap
    );
    allConflicts.push(...conflicts);
  }

  const byType = {};
  for (const type of Object.values(CONFLICT_TYPES)) {
    byType[type] = allConflicts.filter((c) => c.type === type);
  }

  const available = allConflicts.length === 0;

  const result = {
    available,
    totalChecked: itemIds.length,
    conflictCount: allConflicts.length,
    conflicts: allConflicts,
    byType
  };

  if (includeEquipmentInfo) {
    result.equipment = itemIds.map((id) => {
      const eq = eqMap.get(id);
      const itemConflicts = allConflicts.filter((c) => c.equipmentId === id);
      return {
        id,
        exists: !!eq,
        available: itemConflicts.length === 0,
        name: eq ? eq.name : "（已删除）",
        category: eq ? eq.category : "",
        spec: eq ? eq.spec : "",
        location: eq ? eq.location : "",
        condition: eq ? eq.condition : "unknown",
        conflicts: itemConflicts
      };
    });
  }

  return result;
}

export function getAvailableEquipment(db, options = {}) {
  const {
    category = "",
    startDate = null,
    endDate = null,
    exceptOrderId = null,
    exceptQuoteId = null,
    excludeTypes = STOCKTAKE_EXCLUDE_TYPES,
    rentedRequiresActiveOrder = false,
    repairRequiresActiveTicket = false
  } = options;

  let equipmentList = [...db.equipment];
  if (category) {
    equipmentList = equipmentList.filter((e) => e.category === category);
  }

  const checkTypes = excludeTypes;

  const result = [];
  for (const eq of equipmentList) {
    const conflicts = findConflictsForEquipment(
      db,
      eq.id,
      { startDate, endDate, exceptOrderId, exceptQuoteId, checkTypes, rentedRequiresActiveOrder, repairRequiresActiveTicket },
      new Map(equipmentList.map((e) => [e.id, e]))
    );
    if (conflicts.length === 0) {
      result.push(eq);
    }
  }

  return result;
}

export function getStocktakeableEquipment(db, category = "") {
  return getAvailableEquipment(db, {
    category,
    excludeTypes: [CONFLICT_TYPES.RENTED, CONFLICT_TYPES.REPAIR],
    rentedRequiresActiveOrder: true,
    repairRequiresActiveTicket: true
  });
}

export function formatConflictMessage(conflicts) {
  if (!conflicts.length) return "";

  const byType = {};
  for (const c of conflicts) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push(c);
  }

  const messages = [];

  if (byType.not_found?.length) {
    const ids = byType.not_found.map((c) => c.equipmentId).join("、");
    messages.push(`设备不存在：${ids}`);
  }

  if (byType.missing?.length) {
    const items = byType.missing.map((c) => `${c.equipmentId} ${c.equipmentName}`).join("、");
    messages.push(`缺失设备：${items}`);
  }

  if (byType.repair?.length) {
    const items = byType.repair.map((c) => `${c.equipmentId} ${c.equipmentName}`).join("、");
    messages.push(`维修中设备：${items}`);
  }

  if (byType.rented?.length) {
    const items = byType.rented.map((c) => `${c.equipmentId} ${c.equipmentName}`).join("、");
    messages.push(`租赁中设备：${items}`);
  }

  if (byType.order_rental?.length) {
    const items = byType.order_rental
      .map((c) => `${c.equipmentId} ${c.equipmentName}（${c.orderCustomer || c.orderId} ${c.conflictRange || ""}）`)
      .join("；");
    messages.push(`租期冲突：${items}`);
  }

  if (byType.quote_lock?.length) {
    const items = byType.quote_lock
      .map((c) => {
        const lockEnd = c.lockEndAt ? `，锁定至 ${c.lockEndAt.replace("T", " ").slice(0, 16)}` : "";
        return `${c.equipmentId} ${c.equipmentName}（报价 ${c.quoteId} ${c.quoteCustomer || ""}${lockEnd}，租期 ${c.conflictRange || ""}）`;
      })
      .join("；");
    messages.push(`报价锁定冲突：${items}`);
  }

  return messages.join("；");
}

function buildValidationErrors(byType) {
  const errors = [];

  if (byType.not_found?.length) {
    const ids = byType.not_found.map((c) => c.equipmentId).join("、");
    errors.push(`设备不存在：${ids}`);
  }

  if (byType.missing?.length) {
    const items = byType.missing.map((c) => `${c.equipmentId} ${c.equipmentName}`).join("、");
    errors.push(`缺失设备：${items}`);
  }

  if (byType.repair?.length) {
    const items = byType.repair.map((c) => `${c.equipmentId} ${c.equipmentName}`).join("、");
    errors.push(`维修中设备：${items}`);
  }

  if (byType.rented?.length) {
    const items = byType.rented.map((c) => `${c.equipmentId} ${c.equipmentName}`).join("、");
    errors.push(`租赁中设备：${items}`);
  }

  if (byType.order_rental?.length) {
    const items = byType.order_rental
      .map((c) => `${c.equipmentId} ${c.equipmentName}（${c.orderCustomer || c.orderId} ${c.conflictRange || ""}）`)
      .join("；");
    errors.push(`租期冲突：${items}`);
  }

  if (byType.quote_lock?.length) {
    const items = byType.quote_lock
      .map((c) => {
        const lockEnd = c.lockEndAt ? `，锁定至 ${c.lockEndAt.replace("T", " ").slice(0, 16)}` : "";
        return `${c.equipmentId} ${c.equipmentName}（报价 ${c.quoteId} ${c.quoteCustomer || ""}${lockEnd}，租期 ${c.conflictRange || ""}）`;
      })
      .join("；");
    errors.push(`报价锁定冲突：${items}`);
  }

  return errors;
}

export function validateForOrder(db, itemIds, startDate, endDate, exceptOrderId = null, exceptQuoteId = null) {
  if (!itemIds || !itemIds.length) {
    return {
      valid: false,
      errors: ["请至少选择一件设备"],
      repair: [],
      conflicts: [],
      quoteLocks: [],
      missing: [],
      rented: [],
      conditionMissing: []
    };
  }

  const result = checkEquipmentAvailability(db, {
    itemIds,
    startDate,
    endDate,
    exceptOrderId,
    exceptQuoteId,
    checkTypes: ORDER_CHECK_TYPES,
    includeEquipmentInfo: false
  });

  const errors = buildValidationErrors(result.byType);

  const missingIds = [
    ...result.byType.not_found.map((c) => c.equipmentId),
    ...result.byType.missing.map((c) => c.equipmentId)
  ];

  return {
    valid: errors.length === 0,
    errors,
    repair: result.byType.repair.map((c) => ({ id: c.equipmentId, name: c.equipmentName })),
    conflicts: result.byType.order_rental.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName,
      conflictOrderId: c.orderId,
      conflictOrderCustomer: c.orderCustomer,
      conflictRange: c.conflictRange,
      conflictType: "order"
    })),
    quoteLocks: result.byType.quote_lock.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName,
      conflictQuoteId: c.quoteId,
      conflictQuoteCustomer: c.quoteCustomer,
      conflictQuoteLockEndAt: c.lockEndAt,
      conflictRange: c.conflictRange,
      conflictType: "quote_lock"
    })),
    rented: result.byType.rented.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName,
      orderId: c.orderId,
      orderCustomer: c.orderCustomer,
      orderStatus: c.orderStatus
    })),
    missing: missingIds,
    conditionMissing: result.byType.missing.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName
    }))
  };
}

export function validateForQuotation(db, itemIds, startDate, endDate, exceptQuoteId = null) {
  if (!itemIds || !itemIds.length) {
    return {
      valid: false,
      errors: ["请至少选择一件设备"],
      repair: [],
      conflicts: [],
      quoteLocks: [],
      missing: [],
      rented: [],
      conditionMissing: []
    };
  }

  const result = checkEquipmentAvailability(db, {
    itemIds,
    startDate,
    endDate,
    exceptQuoteId,
    checkTypes: QUOTATION_CHECK_TYPES,
    includeEquipmentInfo: false
  });

  const errors = buildValidationErrors(result.byType);
  const missingIds = [
    ...result.byType.not_found.map((c) => c.equipmentId),
    ...result.byType.missing.map((c) => c.equipmentId)
  ];

  return {
    valid: errors.length === 0,
    errors,
    repair: result.byType.repair.map((c) => ({ id: c.equipmentId, name: c.equipmentName })),
    conflicts: result.byType.order_rental.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName,
      conflictOrderId: c.orderId,
      conflictOrderCustomer: c.orderCustomer,
      conflictRange: c.conflictRange,
      conflictType: "order"
    })),
    quoteLocks: result.byType.quote_lock.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName,
      conflictQuoteId: c.quoteId,
      conflictQuoteCustomer: c.quoteCustomer,
      conflictQuoteLockEndAt: c.lockEndAt,
      conflictRange: c.conflictRange,
      conflictType: "quote_lock"
    })),
    rented: [],
    missing: missingIds,
    conditionMissing: result.byType.missing.map((c) => ({
      id: c.equipmentId,
      name: c.equipmentName
    }))
  };
}

export function getEquipmentOccupancies(db, options = {}) {
  const {
    startDate,
    endDate,
    category = "",
    equipmentId = "",
    customer = "",
    includeOrders = true,
    includeQuotations = true,
    includeRepairs = true
  } = options;

  let equipmentList = [...db.equipment];
  if (category) equipmentList = equipmentList.filter((e) => e.category === category);
  if (equipmentId) equipmentList = equipmentList.filter((e) => e.id === equipmentId);

  const activeOrders = db.orders.filter((o) => !["已取消", "已归还"].includes(o.status));
  const allQuotations = db.quotations.filter((q) => ["已确认", "草稿"].includes(q.status));
  const activeRepairs = db.repairs.filter((r) => ["pending", "repairing"].includes(r.status));

  const filteredOrders = customer
    ? activeOrders.filter((o) => (o.customer || "") === customer)
    : activeOrders;
  const filteredQuotations = customer
    ? allQuotations.filter((q) => (q.customer || "") === customer)
    : allQuotations;

  const result = [];
  const eqMap = new Map(equipmentList.map((e) => [e.id, e]));

  for (const eq of equipmentList) {
    const blocks = [];

    if (includeOrders) {
      const eqOrders = filteredOrders.filter((o) => o.itemIds.includes(eq.id));
      for (const order of eqOrders) {
        if (!overlaps(startDate, endDate, order.startDate, order.endDate)) continue;
        let blockType = "occupied";
        if (order.status === "待出库") blockType = "pending_out";
        else if (order.status === "已出库") blockType = "occupied";
        else if (order.status === "待归还") blockType = "pending_return";

        blocks.push({
          type: "order",
          id: order.id,
          status: order.status,
          blockType,
          startDate: order.startDate,
          endDate: order.endDate,
          customer: order.customer,
          note: order.note || ""
        });
      }
    }

    if (includeQuotations) {
      const eqQuotes = filteredQuotations.filter((q) => q.itemIds?.includes(eq.id));
      for (const quote of eqQuotes) {
        if (!overlaps(startDate, endDate, quote.startDate, quote.endDate)) continue;
        const lockStatus = getQuoteLockStatus(quote);
        const isLocked = lockStatus.locked;
        const wasLocked = !lockStatus.neverLocked;
        const blockType = isLocked ? "quote_locked" : (wasLocked ? "quote_lock_expired" : "quotation");

        blocks.push({
          type: "quotation",
          id: quote.id,
          status: quote.status,
          blockType,
          isLocked,
          isLockExpired: wasLocked && !isLocked,
          lockStartAt: quote.lockStartAt,
          lockEndAt: quote.lockEndAt,
          lockRemainingMs: lockStatus.locked ? lockStatus.remainingMs : null,
          lockExpiredMs: lockStatus.expired ? lockStatus.expiredMs : null,
          startDate: quote.startDate,
          endDate: quote.endDate,
          customer: quote.customer,
          note: quote.note || ""
        });
      }
    }

    if (includeRepairs) {
      const eqRepairs = activeRepairs.filter((r) => r.equipmentId === eq.id);
      for (const repair of eqRepairs) {
        const repairStart = repair.sendTime || startDate;
        const repairEnd = repair.expectedReturn || endDate;
        if (!overlaps(startDate, endDate, repairStart, repairEnd)) continue;

        blocks.push({
          type: "repair",
          id: repair.id,
          status: repair.status,
          blockType: "repairing",
          startDate: repairStart,
          endDate: repairEnd,
          customer: "维修中",
          note: repair.faultDescription || ""
        });
      }
    }

    result.push({
      id: eq.id,
      name: eq.name,
      category: eq.category,
      spec: eq.spec,
      location: eq.location,
      condition: eq.condition,
      blocks
    });
  }

  return result;
}
