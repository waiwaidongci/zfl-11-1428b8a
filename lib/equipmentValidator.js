import {
  validateForOrder,
  validateForQuotation,
  checkEquipmentAvailability,
  formatConflictMessage,
  CONFLICT_TYPES
} from "./equipmentAvailability.js";

export function findRepairItems(db, itemIds) {
  const result = checkEquipmentAvailability(db, {
    itemIds,
    checkTypes: [CONFLICT_TYPES.REPAIR],
    includeEquipmentInfo: false
  });
  return result.byType.repair.map((c) => ({
    id: c.equipmentId,
    name: c.equipmentName
  }));
}

export function findConflictItems(db, itemIds, startDate, endDate, exceptOrderId, exceptQuoteId = null) {
  const result = checkEquipmentAvailability(db, {
    itemIds,
    startDate,
    endDate,
    exceptOrderId,
    exceptQuoteId,
    checkTypes: [CONFLICT_TYPES.ORDER_RENTAL, CONFLICT_TYPES.QUOTE_LOCK],
    includeEquipmentInfo: false
  });

  const orderConflicts = result.byType.order_rental.map((c) => ({
    id: c.equipmentId,
    name: c.equipmentName,
    conflictOrderId: c.orderId,
    conflictOrderCustomer: c.orderCustomer,
    conflictQuoteId: null,
    conflictQuoteCustomer: null,
    conflictQuoteLockEndAt: null,
    conflictRange: c.conflictRange,
    conflictType: "order"
  }));

  const quoteLockConflicts = result.byType.quote_lock.map((c) => ({
    id: c.equipmentId,
    name: c.equipmentName,
    conflictOrderId: null,
    conflictOrderCustomer: null,
    conflictQuoteId: c.quoteId,
    conflictQuoteCustomer: c.quoteCustomer,
    conflictQuoteLockEndAt: c.lockEndAt,
    conflictRange: c.conflictRange,
    conflictType: "quote_lock"
  }));

  return [...orderConflicts, ...quoteLockConflicts];
}

export function findMissingItems(db, itemIds) {
  const result = checkEquipmentAvailability(db, {
    itemIds,
    checkTypes: [CONFLICT_TYPES.NOT_FOUND],
    includeEquipmentInfo: false
  });
  return result.byType.not_found.map((c) => c.equipmentId);
}

export function validateEquipmentForOrder(db, itemIds, startDate, endDate, exceptOrderId = null, exceptQuoteId = null) {
  return validateForOrder(db, itemIds, startDate, endDate, exceptOrderId, exceptQuoteId);
}

export function validateEquipmentForQuotation(db, itemIds, startDate, endDate, exceptQuoteId = null) {
  return validateForQuotation(db, itemIds, startDate, endDate, exceptQuoteId);
}
