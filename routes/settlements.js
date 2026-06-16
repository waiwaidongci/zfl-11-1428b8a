import {
  loadDb,
  saveDb,
  genSettlementId,
  genSettlementFeeId,
  genPaymentId,
  genPaymentPlanId,
  SETTLEMENT_STATUS_LABELS,
  FEE_TYPE_LABELS,
  FEE_SOURCE_TYPES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  PAYMENT_PLAN_NODE_TYPES,
  PAYMENT_PLAN_NODE_TYPE_LABELS,
  PAYMENT_PLAN_NODE_STATUSES,
  PAYMENT_PLAN_NODE_STATUS_LABELS
} from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import { buildQuoteSummary } from "../lib/quoteCalculator.js";
import {
  AUDIT_OBJECT_TYPES,
  AUDIT_ACTIONS,
  createAuditLogEntry,
  addAuditLog
} from "../lib/audit.js";

function getOrderSettlement(db, orderId) {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return null;

  let settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (!settlement) {
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

  return settlement;
}

function getQuoteForOrder(db, orderId) {
  return db.quotations.find((q) => q.convertedOrderId === orderId);
}

function getHandoverCompensation(db, orderId) {
  const handovers = (db.handovers || []).filter(
    (h) => h.orderId === orderId && h.type === "return"
  );
  let total = 0;
  const items = [];
  for (const h of handovers) {
    if (h.extraCharges) {
      total += Number(h.extraCharges) || 0;
      items.push({
        handoverId: h.id,
        description: h.compensationNote || "归还交接赔偿",
        amount: Number(h.extraCharges) || 0
      });
    }
  }
  return { total, items, handoverIds: handovers.map((h) => h.id) };
}

function calcSettlementSummary(db, settlement, order) {
  const fees = settlement.fees || [];

  const rentalFee = fees
    .filter((f) => f.type === "rental")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const depositFee = fees
    .filter((f) => f.type === "deposit")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const transportFee = fees
    .filter((f) => f.type === "transport")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const laborFee = fees
    .filter((f) => f.type === "labor")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const setupFee = fees
    .filter((f) => f.type === "setup")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const compensationFee = fees
    .filter((f) => f.type === "compensation")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const discountFee = fees
    .filter((f) => f.type === "discount")
    .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

  const receivableTotal =
    rentalFee + transportFee + laborFee + setupFee + compensationFee - discountFee;

  const payments = (db.payments || []).filter((p) => p.settlementId === settlement.id);
  const totalPaid = payments
    .filter((p) => p.type === "payment" || p.type === "deposit_deduction")
    .reduce((sum, p) => sum + Number(p.amount) || 0, 0);

  const depositReturned = payments
    .filter((p) => p.type === "deposit_return")
    .reduce((sum, p) => sum + Number(p.amount) || 0, 0);

  const depositDeducted = payments
    .filter((p) => p.type === "deposit_deduction")
    .reduce((sum, p) => sum + Number(p.amount) || 0, 0);

  const remainingDeposit = depositFee - depositReturned - depositDeducted;
  const balanceDue = receivableTotal - totalPaid;

  let status = settlement.status || "draft";
  if (order && order.status === "已取消") {
    status = "cancelled";
  } else if (status !== "cancelled") {
    if (totalPaid <= 0 && remainingDeposit === depositFee && depositDeducted === 0) {
      status = "draft";
    } else if (balanceDue <= 0.01 && remainingDeposit <= 0.01) {
      status = "settled";
    } else if (totalPaid > 0 || depositDeducted > 0) {
      status = "partial";
    }
  }

  return {
    rentalFee,
    depositFee,
    transportFee,
    laborFee,
    setupFee,
    compensationFee,
    discountFee,
    receivableTotal,
    totalPaid,
    depositReturned,
    depositDeducted,
    remainingDeposit,
    balanceDue,
    status,
    statusLabel: SETTLEMENT_STATUS_LABELS[status] || status
  };
}

function buildSettlementPayload(db, settlement, order) {
  const summary = calcSettlementSummary(db, settlement, order);
  const payments = (db.payments || [])
    .filter((p) => p.settlementId === settlement.id)
    .sort((a, b) => new Date(b.paymentDate || b.createdAt) - new Date(a.paymentDate || a.createdAt));

  const plans = (db.paymentPlans || [])
    .filter((p) => p.settlementId === settlement.id)
    .sort((a, b) => new Date(a.dueDate || a.createdAt) - new Date(b.dueDate || b.createdAt));

  const plansWithStatus = plans.map((p) => buildPlanPayload(db, p, payments));
  const planStatus = calcPlanOverallStatus(db, settlement, plans);

  const planMap = new Map(plans.map((p) => [p.id, p]));

  const feesWithLabels = (settlement.fees || []).map((f) => ({
    ...f,
    typeLabel: FEE_TYPE_LABELS[f.type] || f.type
  }));

  const paymentsWithLabels = payments.map((p) => {
    const linkedPlan = p.planId ? planMap.get(p.planId) : null;
    return {
      ...p,
      methodLabel: PAYMENT_METHOD_LABELS[p.method] || p.method,
      typeLabel: PAYMENT_TYPE_LABELS[p.type] || p.type,
      planName: linkedPlan ? linkedPlan.name : null,
      planId: p.planId || null
    };
  });

  const customer = (db.customers || []).find((c) => c.name === order.customer);

  return {
    id: settlement.id,
    orderId: settlement.orderId,
    quotationId: settlement.quotationId,
    status: summary.status,
    statusLabel: summary.statusLabel,
    note: settlement.note || "",
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    fees: feesWithLabels,
    payments: paymentsWithLabels,
    paymentPlans: plansWithStatus,
    planStatus,
    availablePlans: plansWithStatus.map((p) => ({ id: p.id, name: p.name, type: p.type, remainingAmount: p.remainingAmount })),
    summary,
    order: {
      id: order.id,
      customer: order.customer,
      customerContact: customer ? customer.contact : "",
      customerPhone: customer ? customer.phone : "",
      startDate: order.startDate,
      endDate: order.endDate,
      status: order.status,
      note: order.note || ""
    }
  };
}

function ensureSettlement(db, orderId) {
  let settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  const isNew = !settlement;

  if (isNew) {
    const quote = getQuoteForOrder(db, orderId);
    settlement = {
      id: genSettlementId(),
      orderId,
      quotationId: quote ? quote.id : null,
      status: "draft",
      fees: [],
      note: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!db.settlements) db.settlements = [];
    db.settlements.unshift(settlement);
  }

  if (!settlement.fees) settlement.fees = [];

  return { settlement, isNew };
}

function syncQuoteFeesToSettlement(db, settlement, quote) {
  const quoteSummary = buildQuoteSummary(
    db.equipment,
    quote.itemIds,
    quote.startDate,
    quote.endDate,
    quote.depositOverride || {},
    quote.discount || 0
  );

  const existingRental = (settlement.fees || []).find(
    (f) => f.type === "rental" && f.source === "quotation" && f.sourceId === quote.id
  );
  if (existingRental) {
    existingRental.amount = quoteSummary.subtotal;
    existingRental.description = `报价单 ${quote.id} 租金`;
    existingRental.updatedAt = new Date().toISOString();
  } else {
    settlement.fees.push({
      id: genSettlementFeeId(),
      type: "rental",
      amount: quoteSummary.subtotal,
      description: `报价单 ${quote.id} 租金`,
      source: "quotation",
      sourceId: quote.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  const existingDeposit = (settlement.fees || []).find(
    (f) => f.type === "deposit" && f.source === "quotation" && f.sourceId === quote.id
  );
  if (existingDeposit) {
    existingDeposit.amount = quoteSummary.totalDeposit;
    existingDeposit.description = `报价单 ${quote.id} 押金`;
    existingDeposit.updatedAt = new Date().toISOString();
  } else {
    settlement.fees.push({
      id: genSettlementFeeId(),
      type: "deposit",
      amount: quoteSummary.totalDeposit,
      description: `报价单 ${quote.id} 押金`,
      source: "quotation",
      sourceId: quote.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  if (quoteSummary.discountAmount > 0) {
    const existingDiscount = (settlement.fees || []).find(
      (f) => f.type === "discount" && f.source === "quotation" && f.sourceId === quote.id
    );
    if (existingDiscount) {
      existingDiscount.amount = quoteSummary.discountAmount;
      existingDiscount.description = `报价单 ${quote.id} 优惠`;
      existingDiscount.updatedAt = new Date().toISOString();
    } else {
      settlement.fees.push({
        id: genSettlementFeeId(),
        type: "discount",
        amount: quoteSummary.discountAmount,
        description: `报价单 ${quote.id} 优惠`,
        source: "quotation",
        sourceId: quote.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  } else {
    settlement.fees = (settlement.fees || []).filter(
      (f) => !(f.type === "discount" && f.source === "quotation" && f.sourceId === quote.id)
    );
  }

  settlement.quotationId = quote.id;
  return quoteSummary;
}

function syncHandoverFeesToSettlement(db, settlement, orderId) {
  const handoverComp = getHandoverCompensation(db, orderId);
  for (const item of handoverComp.items) {
    const existing = (settlement.fees || []).find(
      (f) => f.type === "compensation" && f.source === "handover" && f.sourceId === item.handoverId
    );
    if (existing) {
      existing.amount = item.amount;
      existing.description = item.description;
      existing.updatedAt = new Date().toISOString();
    } else {
      settlement.fees.push({
        id: genSettlementFeeId(),
        type: "compensation",
        amount: item.amount,
        description: item.description,
        source: "handover",
        sourceId: item.handoverId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }
  return handoverComp;
}

function getOrderRepairCompensation(db, orderId) {
  const repairs = (db.repairs || []).filter(
    (r) => r.orderId === orderId && r.status === "completed" && r.liability === "customer"
  );
  let total = 0;
  const items = [];
  for (const r of repairs) {
    const customerAmount =
      r.customerAmount === undefined || r.customerAmount === null || r.customerAmount === ""
        ? null
        : Number(r.customerAmount) || 0;
    const amount =
      customerAmount !== null ? customerAmount : Number(r.actualRepairCost || r.repairCost || 0);
    if (amount > 0) {
      total += amount;
      items.push({
        repairId: r.id,
        equipmentName: r.equipmentName,
        equipmentId: r.equipmentId,
        description: `维修赔偿 - ${r.equipmentName}（工单 ${r.id}）`,
        amount
      });
    }
  }
  return { total, items, repairIds: repairs.map((r) => r.id) };
}

function syncRepairFeesToSettlement(db, settlement, orderId) {
  const repairComp = getOrderRepairCompensation(db, orderId);
  const existingRepairIds = new Set(
    (settlement.fees || [])
      .filter((f) => f.type === "compensation" && f.source === "repair")
      .map((f) => f.sourceId)
  );

  const currentRepairIds = new Set(repairComp.items.map((i) => i.repairId));

  for (const item of repairComp.items) {
    const existing = (settlement.fees || []).find(
      (f) => f.type === "compensation" && f.source === "repair" && f.sourceId === item.repairId
    );
    if (existing) {
      existing.amount = item.amount;
      existing.description = item.description;
      existing.updatedAt = new Date().toISOString();
    } else {
      settlement.fees.push({
        id: genSettlementFeeId(),
        type: "compensation",
        amount: item.amount,
        description: item.description,
        source: "repair",
        sourceId: item.repairId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  for (const existingId of existingRepairIds) {
    if (!currentRepairIds.has(existingId)) {
      settlement.fees = (settlement.fees || []).filter(
        (f) => !(f.type === "compensation" && f.source === "repair" && f.sourceId === existingId)
      );
    }
  }

  return repairComp;
}

export async function getSettlement(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const { settlement, isNew } = ensureSettlement(db, orderId);

  const quote = getQuoteForOrder(db, orderId);
  let hasChanges = isNew;

  if (quote && isNew) {
    syncQuoteFeesToSettlement(db, settlement, quote);
    hasChanges = true;
  }

  const handoverComp = getHandoverCompensation(db, orderId);
  if (handoverComp.items.length > 0 && isNew) {
    syncHandoverFeesToSettlement(db, settlement, orderId);
    hasChanges = true;
  }

  const repairComp = getOrderRepairCompensation(db, orderId);
  if (repairComp.items.length > 0 && isNew) {
    syncRepairFeesToSettlement(db, settlement, orderId);
    hasChanges = true;
  }

  if (order.status === "已取消" && settlement.status !== "cancelled") {
    settlement.status = "cancelled";
    hasChanges = true;
  }

  if (hasChanges) {
    settlement.updatedAt = new Date().toISOString();
    await saveDb(db);
  }

  const payload = buildSettlementPayload(db, settlement, order);

  if (quote) {
    payload.quotationId = quote.id;
    const quoteSummary = buildQuoteSummary(
      db.equipment,
      quote.itemIds,
      quote.startDate,
      quote.endDate,
      quote.depositOverride || {},
      quote.discount || 0
    );
    payload.quoteSummary = quoteSummary;
  }

  payload.handoverCompensation = handoverComp;
  payload.repairCompensation = repairComp;
  return sendJson(res, 200, payload);
}

export async function updateSettlement(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法修改结算" });
  }

  const { settlement } = ensureSettlement(db, orderId);

  const input = await parseBody(req);

  if (input.note !== undefined) {
    settlement.note = String(input.note || "").trim();
  }

  if (input.status !== undefined) {
    if (!["draft", "partial", "settled", "cancelled"].includes(input.status)) {
      return sendJson(res, 400, { error: "无效的结算状态" });
    }
    settlement.status = input.status;
  }

  settlement.updatedAt = new Date().toISOString();
  await saveDb(db);

  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function addFee(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法添加费用" });
  }

  const { settlement } = ensureSettlement(db, orderId);

  const input = await parseBody(req);

  if (!input.type || !Object.keys(FEE_TYPE_LABELS).includes(input.type)) {
    return sendJson(res, 400, { error: "请选择有效的费用类型" });
  }

  const amount = Number(input.amount);
  if (Number.isNaN(amount) || amount < 0) {
    return sendJson(res, 400, { error: "请输入有效的金额" });
  }

  const source = input.source || "manual";
  if (!FEE_SOURCE_TYPES.includes(source)) {
    return sendJson(res, 400, { error: "无效的费用来源" });
  }

  if (source !== "manual") {
    const existing = (settlement.fees || []).find(
      (f) => f.source === source && f.sourceId === input.sourceId && f.type === input.type
    );
    if (existing) {
      existing.amount = amount;
      existing.description = input.description || existing.description;
      existing.updatedAt = new Date().toISOString();
      settlement.updatedAt = new Date().toISOString();
      await saveDb(db);
      const payload = buildSettlementPayload(db, settlement, order);
      return sendJson(res, 200, payload);
    }
  }

  const fee = {
    id: genSettlementFeeId(),
    type: input.type,
    amount,
    description: String(input.description || "").trim(),
    source,
    sourceId: input.sourceId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!settlement.fees) settlement.fees = [];
  settlement.fees.push(fee);
  settlement.updatedAt = new Date().toISOString();

  const auditEntry = createAuditLogEntry({
    objectType: AUDIT_OBJECT_TYPES.SETTLEMENT_FEE,
    objectId: fee.id,
    action: AUDIT_ACTIONS.ADD_FEE,
    summary: `添加费用: ${FEE_TYPE_LABELS[fee.type] || fee.type} ¥${fee.amount}`,
    detail: `订单: ${orderId}, 费用类型: ${FEE_TYPE_LABELS[fee.type] || fee.type}, 金额: ¥${fee.amount}, 描述: ${fee.description || "无"}, 来源: ${fee.source}`,
    after: fee,
    operator: "user",
    reversible: false,
    extra: { orderId, settlementId: settlement.id }
  });
  await addAuditLog(db, auditEntry);

  await saveDb(db);
  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 201, payload);
}

export async function updateFee(req, res, orderId, feeId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法修改费用" });
  }

  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (!settlement) return sendJson(res, 404, { error: "settlement_not_found" });

  const fee = (settlement.fees || []).find((f) => f.id === feeId);
  if (!fee) return sendJson(res, 404, { error: "fee_not_found" });

  const input = await parseBody(req);
  const before = { ...fee };
  const changedFields = {};

  if (input.type !== undefined) {
    if (!Object.keys(FEE_TYPE_LABELS).includes(input.type)) {
      return sendJson(res, 400, { error: "无效的费用类型" });
    }
    if (fee.type !== input.type) {
      changedFields.type = { before: fee.type, after: input.type };
    }
    fee.type = input.type;
  }

  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (Number.isNaN(amount) || amount < 0) {
      return sendJson(res, 400, { error: "请输入有效的金额" });
    }
    if (fee.amount !== amount) {
      changedFields.amount = { before: fee.amount, after: amount };
    }
    fee.amount = amount;
  }

  if (input.description !== undefined) {
    const desc = String(input.description || "").trim();
    if (fee.description !== desc) {
      changedFields.description = { before: fee.description, after: desc };
    }
    fee.description = desc;
  }

  fee.updatedAt = new Date().toISOString();
  settlement.updatedAt = new Date().toISOString();

  if (Object.keys(changedFields).length > 0) {
    const changeSummary = Object.entries(changedFields)
      .map(([k, v]) => {
        const label = k === "type" ? "类型" : k === "amount" ? "金额" : "描述";
        return `${label}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`;
      })
      .join(", ");
    const auditEntry = createAuditLogEntry({
      objectType: AUDIT_OBJECT_TYPES.SETTLEMENT_FEE,
      objectId: feeId,
      action: AUDIT_ACTIONS.UPDATE_FEE,
      summary: `修改费用 ${feeId}`,
      detail: `订单: ${orderId}, ${changeSummary}`,
      before,
      after: { ...fee },
      changedFields,
      operator: "user",
      reversible: false,
      extra: { orderId, settlementId: settlement.id }
    });
    await addAuditLog(db, auditEntry);
  }

  await saveDb(db);
  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function deleteFee(req, res, orderId, feeId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法删除费用" });
  }

  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (!settlement) return sendJson(res, 404, { error: "settlement_not_found" });

  const idx = (settlement.fees || []).findIndex((f) => f.id === feeId);
  if (idx === -1) return sendJson(res, 404, { error: "fee_not_found" });

  const deletedFee = { ...settlement.fees[idx] };
  settlement.fees.splice(idx, 1);
  settlement.updatedAt = new Date().toISOString();

  const auditEntry = createAuditLogEntry({
    objectType: AUDIT_OBJECT_TYPES.SETTLEMENT_FEE,
    objectId: feeId,
    action: AUDIT_ACTIONS.DELETE_FEE,
    summary: `删除费用: ${FEE_TYPE_LABELS[deletedFee.type] || deletedFee.type} ¥${deletedFee.amount}`,
    detail: `订单: ${orderId}, 费用类型: ${FEE_TYPE_LABELS[deletedFee.type] || deletedFee.type}, 金额: ¥${deletedFee.amount}, 描述: ${deletedFee.description || "无"}`,
    before: deletedFee,
    operator: "user",
    reversible: true,
    extra: { orderId, settlementId: settlement.id }
  });
  await addAuditLog(db, auditEntry);

  await saveDb(db);
  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function syncQuoteFees(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法同步报价单" });
  }

  const quote = getQuoteForOrder(db, orderId);
  if (!quote) {
    return sendJson(res, 400, { error: "该订单没有关联的报价单" });
  }

  const { settlement } = ensureSettlement(db, orderId);

  syncQuoteFeesToSettlement(db, settlement, quote);

  settlement.updatedAt = new Date().toISOString();
  await saveDb(db);

  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function syncHandoverFees(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法同步交接费用" });
  }

  const { settlement } = ensureSettlement(db, orderId);

  syncHandoverFeesToSettlement(db, settlement, orderId);

  settlement.updatedAt = new Date().toISOString();
  await saveDb(db);

  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function syncRepairFees(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法同步维修赔偿费用" });
  }

  const { settlement } = ensureSettlement(db, orderId);

  syncRepairFeesToSettlement(db, settlement, orderId);

  settlement.updatedAt = new Date().toISOString();
  await saveDb(db);

  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function addPayment(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法添加收款" });
  }

  const { settlement } = ensureSettlement(db, orderId);

  const input = await parseBody(req);

  const amount = Number(input.amount);
  if (Number.isNaN(amount) || amount <= 0) {
    return sendJson(res, 400, { error: "请输入有效的收款金额" });
  }

  const type = input.type || "payment";
  if (!["payment", "deposit_deduction", "deposit_return"].includes(type)) {
    return sendJson(res, 400, { error: "无效的收款类型" });
  }

  const method = input.method || "cash";
  if (!Object.keys(PAYMENT_METHOD_LABELS).includes(method)) {
    return sendJson(res, 400, { error: "无效的支付方式" });
  }

  if (type === "deposit_return" || type === "deposit_deduction") {
    const summary = calcSettlementSummary(db, settlement, order);
    if (type === "deposit_return" && amount > summary.remainingDeposit + 0.01) {
      return sendJson(res, 400, {
        error: `退还金额不能超过剩余押金 ¥${summary.remainingDeposit.toFixed(2)}`
      });
    }
    if (type === "deposit_deduction" && amount > summary.remainingDeposit + 0.01) {
      return sendJson(res, 400, {
        error: `抵扣金额不能超过剩余押金 ¥${summary.remainingDeposit.toFixed(2)}`
      });
    }
  }

  let planId = input.planId || null;
  if (planId) {
    const plan = (db.paymentPlans || []).find((p) => p.id === planId && p.orderId === orderId);
    if (!plan) {
      return sendJson(res, 400, { error: "关联的收款计划不存在" });
    }
    if (plan.type === "deposit_return" && type !== "deposit_return") {
      return sendJson(res, 400, { error: "押金退还计划节点只能关联押金退还类型的收款" });
    }
    if (plan.type !== "deposit_return" && type === "deposit_return") {
      return sendJson(res, 400, { error: "非押金退还计划节点不能关联押金退还类型的收款" });
    }
  }

  const payment = {
    id: genPaymentId(),
    settlementId: settlement.id,
    orderId,
    amount,
    type,
    method,
    planId,
    paymentDate: input.paymentDate || new Date().toISOString().split("T")[0],
    remark: String(input.remark || "").trim(),
    createdAt: new Date().toISOString()
  };

  if (!db.payments) db.payments = [];
  db.payments.unshift(payment);
  settlement.updatedAt = new Date().toISOString();

  const newSummary = calcSettlementSummary(db, settlement, order);
  settlement.status = newSummary.status;

  const auditEntry = createAuditLogEntry({
    objectType: AUDIT_OBJECT_TYPES.PAYMENT,
    objectId: payment.id,
    action: AUDIT_ACTIONS.ADD_PAYMENT,
    summary: `添加收款: ${PAYMENT_TYPE_LABELS[type] || type} ¥${amount} (${PAYMENT_METHOD_LABELS[method] || method})`,
    detail: `订单: ${orderId}, 收款类型: ${PAYMENT_TYPE_LABELS[type] || type}, 金额: ¥${amount}, 方式: ${PAYMENT_METHOD_LABELS[method] || method}, 日期: ${payment.paymentDate}, 备注: ${payment.remark || "无"}`,
    after: payment,
    operator: "user",
    reversible: false,
    extra: { orderId, settlementId: settlement.id }
  });
  await addAuditLog(db, auditEntry);

  await saveDb(db);
  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 201, payload);
}

export async function updatePayment(req, res, orderId, paymentId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法修改收款" });
  }

  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (!settlement) return sendJson(res, 404, { error: "settlement_not_found" });

  const payment = (db.payments || []).find((p) => p.id === paymentId);
  if (!payment) return sendJson(res, 404, { error: "payment_not_found" });

  const input = await parseBody(req);
  const before = { ...payment };
  const changedFields = {};

  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      return sendJson(res, 400, { error: "请输入有效的金额" });
    }
    if (payment.amount !== amount) {
      changedFields.amount = { before: payment.amount, after: amount };
    }
    payment.amount = amount;
  }

  if (input.type !== undefined) {
    if (!["payment", "deposit_deduction", "deposit_return"].includes(input.type)) {
      return sendJson(res, 400, { error: "无效的收款类型" });
    }
    if (payment.type !== input.type) {
      changedFields.type = { before: payment.type, after: input.type };
    }
    payment.type = input.type;
  }

  if (input.method !== undefined) {
    if (!Object.keys(PAYMENT_METHOD_LABELS).includes(input.method)) {
      return sendJson(res, 400, { error: "无效的支付方式" });
    }
    if (payment.method !== input.method) {
      changedFields.method = { before: payment.method, after: input.method };
    }
    payment.method = input.method;
  }

  if (input.paymentDate !== undefined) {
    if (payment.paymentDate !== input.paymentDate) {
      changedFields.paymentDate = { before: payment.paymentDate, after: input.paymentDate };
    }
    payment.paymentDate = input.paymentDate;
  }

  if (input.remark !== undefined) {
    const remark = String(input.remark || "").trim();
    if (payment.remark !== remark) {
      changedFields.remark = { before: payment.remark, after: remark };
    }
    payment.remark = remark;
  }

  if (input.planId !== undefined) {
    let planId = input.planId || null;
    if (planId) {
      const plan = (db.paymentPlans || []).find((p) => p.id === planId && p.orderId === orderId);
      if (!plan) {
        return sendJson(res, 400, { error: "关联的收款计划不存在" });
      }
      const checkType = input.type !== undefined ? input.type : payment.type;
      if (plan.type === "deposit_return" && checkType !== "deposit_return") {
        return sendJson(res, 400, { error: "押金退还计划节点只能关联押金退还类型的收款" });
      }
      if (plan.type !== "deposit_return" && checkType === "deposit_return") {
        return sendJson(res, 400, { error: "非押金退还计划节点不能关联押金退还类型的收款" });
      }
    }
    if (payment.planId !== planId) {
      changedFields.planId = { before: payment.planId, after: planId };
    }
    payment.planId = planId;
  }

  settlement.updatedAt = new Date().toISOString();
  const newSummary = calcSettlementSummary(db, settlement, order);
  settlement.status = newSummary.status;

  if (Object.keys(changedFields).length > 0) {
    const fieldLabels = {
      amount: "金额",
      type: "类型",
      method: "支付方式",
      paymentDate: "收款日期",
      remark: "备注",
      planId: "收款计划"
    };
    const changeSummary = Object.entries(changedFields)
      .map(([k, v]) => `${fieldLabels[k] || k}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`)
      .join(", ");
    const auditEntry = createAuditLogEntry({
      objectType: AUDIT_OBJECT_TYPES.PAYMENT,
      objectId: paymentId,
      action: AUDIT_ACTIONS.UPDATE_PAYMENT,
      summary: `修改收款 ${paymentId}`,
      detail: `订单: ${orderId}, ${changeSummary}`,
      before,
      after: { ...payment },
      changedFields,
      operator: "user",
      reversible: false,
      extra: { orderId, settlementId: settlement.id }
    });
    await addAuditLog(db, auditEntry);
  }

  await saveDb(db);
  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function deletePayment(req, res, orderId, paymentId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法删除收款" });
  }

  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (!settlement) return sendJson(res, 404, { error: "settlement_not_found" });

  const idx = (db.payments || []).findIndex((p) => p.id === paymentId);
  if (idx === -1) return sendJson(res, 404, { error: "payment_not_found" });

  const deletedPayment = { ...db.payments[idx] };
  db.payments.splice(idx, 1);
  settlement.updatedAt = new Date().toISOString();

  const newSummary = calcSettlementSummary(db, settlement, order);
  settlement.status = newSummary.status;

  const auditEntry = createAuditLogEntry({
    objectType: AUDIT_OBJECT_TYPES.PAYMENT,
    objectId: paymentId,
    action: AUDIT_ACTIONS.DELETE_PAYMENT,
    summary: `删除收款: ${PAYMENT_TYPE_LABELS[deletedPayment.type] || deletedPayment.type} ¥${deletedPayment.amount}`,
    detail: `订单: ${orderId}, 收款类型: ${PAYMENT_TYPE_LABELS[deletedPayment.type] || deletedPayment.type}, 金额: ¥${deletedPayment.amount}, 方式: ${PAYMENT_METHOD_LABELS[deletedPayment.method] || deletedPayment.method}, 日期: ${deletedPayment.paymentDate}`,
    before: deletedPayment,
    operator: "user",
    reversible: false,
    extra: { orderId, settlementId: settlement.id }
  });
  await addAuditLog(db, auditEntry);

  await saveDb(db);
  const payload = buildSettlementPayload(db, settlement, order);
  return sendJson(res, 200, payload);
}

export async function listSettlements(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");
  const customer = url.searchParams.get("customer");

  let list = [...(db.settlements || [])];

  if (status) {
    list = list.filter((s) => s.status === status);
  }

  if (customer) {
    const orderIds = db.orders
      .filter((o) => (o.customer || "") === customer)
      .map((o) => o.id);
    list = list.filter((s) => orderIds.includes(s.orderId));
  }

  const result = list.map((s) => {
    const order = db.orders.find((o) => o.id === s.orderId);
    const summary = calcSettlementSummary(db, s, order);
    const payments = (db.payments || []).filter((p) => p.settlementId === s.id);
    const plans = (db.paymentPlans || []).filter((p) => p.settlementId === s.id);
    const planStatus = calcPlanOverallStatus(db, s, plans);
    return {
      id: s.id,
      orderId: s.orderId,
      quotationId: s.quotationId,
      status: summary.status,
      statusLabel: summary.statusLabel,
      customer: order ? order.customer : "",
      startDate: order ? order.startDate : "",
      endDate: order ? order.endDate : "",
      receivableTotal: summary.receivableTotal,
      totalPaid: summary.totalPaid,
      balanceDue: summary.balanceDue,
      paymentCount: payments.length,
      planCount: plans.length,
      planStatus: planStatus.status,
      planStatusLabel: planStatus.statusLabel,
      hasOverduePlan: planStatus.hasOverdue,
      updatedAt: s.updatedAt
    };
  });

  return sendJson(res, 200, result);
}

function calcPlanNodeStatus(db, plan, allPayments) {
  const nodePayments = allPayments.filter((p) => p.planId === plan.id);
  const paidAmount = nodePayments
    .filter((p) => p.type === "payment" || p.type === "deposit_deduction")
    .reduce((sum, p) => sum + Number(p.amount) || 0, 0);

  const returnedAmount = nodePayments
    .filter((p) => p.type === "deposit_return")
    .reduce((sum, p) => sum + Number(p.amount) || 0, 0);

  const effectivePaid = plan.type === "deposit_return" ? returnedAmount : paidAmount;
  const amount = Number(plan.amount) || 0;

  const today = new Date().toISOString().split("T")[0];
  const isOverdue = plan.dueDate && plan.dueDate < today;

  let status;
  if (effectivePaid >= amount - 0.01 && amount > 0) {
    status = "completed";
  } else if (isOverdue) {
    status = "overdue";
  } else if (effectivePaid > 0.01) {
    status = "partial";
  } else {
    status = "pending";
  }

  return {
    status,
    statusLabel: PAYMENT_PLAN_NODE_STATUS_LABELS[status] || status,
    paidAmount: effectivePaid,
    remainingAmount: Math.max(0, amount - effectivePaid),
    progress: amount > 0 ? Math.min(100, (effectivePaid / amount) * 100) : 0
  };
}

function calcPlanOverallStatus(db, settlement, plans) {
  if (!plans || plans.length === 0) {
    return { status: null, statusLabel: "无计划", hasOverdue: false, allCompleted: false };
  }

  const allPayments = (db.payments || []).filter((p) => p.settlementId === settlement.id);
  let hasOverdue = false;
  let hasPartial = false;
  let hasPending = false;
  let allCompleted = true;

  for (const plan of plans) {
    const s = calcPlanNodeStatus(db, plan, allPayments);
    if (s.status === "overdue") {
      hasOverdue = true;
      allCompleted = false;
    } else if (s.status === "partial") {
      hasPartial = true;
      allCompleted = false;
    } else if (s.status === "pending") {
      hasPending = true;
      allCompleted = false;
    }
    if (s.paidAmount > 0.01 && s.status !== "completed") {
      hasPartial = true;
    }
  }

  let status, statusLabel;
  if (allCompleted) {
    status = "completed";
    statusLabel = "计划全部完成";
  } else if (hasOverdue) {
    status = "overdue";
    statusLabel = hasPartial ? "有计划逾期（部分完成）" : "有计划逾期";
  } else if (hasPartial) {
    status = "partial";
    statusLabel = "部分计划完成";
  } else {
    status = "pending";
    statusLabel = "计划待执行";
  }

  return { status, statusLabel, hasOverdue, allCompleted };
}

function buildPlanPayload(db, plan, allPayments) {
  const statusInfo = calcPlanNodeStatus(db, plan, allPayments);
  return {
    ...plan,
    typeLabel: PAYMENT_PLAN_NODE_TYPE_LABELS[plan.type] || plan.type,
    ...statusInfo
  };
}

export async function listPaymentPlans(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const { settlement } = ensureSettlement(db, orderId);
  const plans = (db.paymentPlans || [])
    .filter((p) => p.settlementId === settlement.id)
    .sort((a, b) => new Date(a.dueDate || a.createdAt) - new Date(b.dueDate || b.createdAt));
  const allPayments = (db.payments || []).filter((p) => p.settlementId === settlement.id);

  const result = plans.map((p) => buildPlanPayload(db, p, allPayments));
  return sendJson(res, 200, result);
}

export async function addPaymentPlan(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法添加收款计划" });
  }

  const { settlement } = ensureSettlement(db, orderId);
  const input = await parseBody(req);

  const type = input.type || "custom";
  if (!PAYMENT_PLAN_NODE_TYPES.includes(type)) {
    return sendJson(res, 400, { error: "无效的计划类型" });
  }

  const amount = Number(input.amount);
  if (Number.isNaN(amount) || amount <= 0) {
    return sendJson(res, 400, { error: "请输入有效的计划金额" });
  }

  if (!input.dueDate) {
    return sendJson(res, 400, { error: "请选择应收日期" });
  }

  const plan = {
    id: genPaymentPlanId(),
    settlementId: settlement.id,
    orderId,
    type,
    name: input.name || PAYMENT_PLAN_NODE_TYPE_LABELS[type] || "自定义节点",
    amount,
    dueDate: input.dueDate,
    remark: String(input.remark || "").trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!db.paymentPlans) db.paymentPlans = [];
  db.paymentPlans.unshift(plan);
  settlement.updatedAt = new Date().toISOString();

  await saveDb(db);
  const allPayments = (db.payments || []).filter((p) => p.settlementId === settlement.id);
  return sendJson(res, 201, buildPlanPayload(db, plan, allPayments));
}

export async function updatePaymentPlan(req, res, orderId, planId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法修改收款计划" });
  }

  const plan = (db.paymentPlans || []).find((p) => p.id === planId && p.orderId === orderId);
  if (!plan) return sendJson(res, 404, { error: "plan_not_found" });

  const input = await parseBody(req);

  if (input.type !== undefined) {
    if (!PAYMENT_PLAN_NODE_TYPES.includes(input.type)) {
      return sendJson(res, 400, { error: "无效的计划类型" });
    }
    plan.type = input.type;
  }

  if (input.name !== undefined) {
    plan.name = String(input.name || "").trim() || plan.name;
  }

  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      return sendJson(res, 400, { error: "请输入有效的计划金额" });
    }
    plan.amount = amount;
  }

  if (input.dueDate !== undefined) {
    if (!input.dueDate) {
      return sendJson(res, 400, { error: "应收日期不能为空" });
    }
    plan.dueDate = input.dueDate;
  }

  if (input.remark !== undefined) {
    plan.remark = String(input.remark || "").trim();
  }

  plan.updatedAt = new Date().toISOString();

  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (settlement) settlement.updatedAt = new Date().toISOString();

  await saveDb(db);
  const allPayments = (db.payments || []).filter((p) => p.settlementId === plan.settlementId);
  return sendJson(res, 200, buildPlanPayload(db, plan, allPayments));
}

export async function deletePaymentPlan(req, res, orderId, planId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (order.status === "已取消") {
    return sendJson(res, 400, { error: "已取消订单无法删除收款计划" });
  }

  const idx = (db.paymentPlans || []).findIndex((p) => p.id === planId && p.orderId === orderId);
  if (idx === -1) return sendJson(res, 404, { error: "plan_not_found" });

  const plan = db.paymentPlans[idx];

  const linkedPayments = (db.payments || []).filter((p) => p.planId === planId);
  for (const payment of linkedPayments) {
    payment.planId = null;
  }

  db.paymentPlans.splice(idx, 1);

  const settlement = (db.settlements || []).find((s) => s.orderId === orderId);
  if (settlement) settlement.updatedAt = new Date().toISOString();

  await saveDb(db);
  return sendJson(res, 200, { success: true, removedPlanId: planId });
}
