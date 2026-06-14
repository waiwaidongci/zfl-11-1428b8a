import {
  loadDb,
  saveDb,
  genSettlementId,
  genSettlementFeeId,
  genPaymentId,
  SETTLEMENT_STATUS_LABELS,
  FEE_TYPE_LABELS,
  FEE_SOURCE_TYPES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS
} from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import { buildQuoteSummary } from "../lib/quoteCalculator.js";

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

  const feesWithLabels = (settlement.fees || []).map((f) => ({
    ...f,
    typeLabel: FEE_TYPE_LABELS[f.type] || f.type
  }));

  const paymentsWithLabels = payments.map((p) => ({
    ...p,
    methodLabel: PAYMENT_METHOD_LABELS[p.method] || p.method,
    typeLabel: PAYMENT_TYPE_LABELS[p.type] || p.type
  }));

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

  if (input.type !== undefined) {
    if (!Object.keys(FEE_TYPE_LABELS).includes(input.type)) {
      return sendJson(res, 400, { error: "无效的费用类型" });
    }
    fee.type = input.type;
  }

  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (Number.isNaN(amount) || amount < 0) {
      return sendJson(res, 400, { error: "请输入有效的金额" });
    }
    fee.amount = amount;
  }

  if (input.description !== undefined) {
    fee.description = String(input.description || "").trim();
  }

  fee.updatedAt = new Date().toISOString();
  settlement.updatedAt = new Date().toISOString();

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

  settlement.fees.splice(idx, 1);
  settlement.updatedAt = new Date().toISOString();

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

  const payment = {
    id: genPaymentId(),
    settlementId: settlement.id,
    orderId,
    amount,
    type,
    method,
    paymentDate: input.paymentDate || new Date().toISOString().split("T")[0],
    remark: String(input.remark || "").trim(),
    createdAt: new Date().toISOString()
  };

  if (!db.payments) db.payments = [];
  db.payments.unshift(payment);
  settlement.updatedAt = new Date().toISOString();

  const newSummary = calcSettlementSummary(db, settlement, order);
  settlement.status = newSummary.status;

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

  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      return sendJson(res, 400, { error: "请输入有效的金额" });
    }
    payment.amount = amount;
  }

  if (input.type !== undefined) {
    if (!["payment", "deposit_deduction", "deposit_return"].includes(input.type)) {
      return sendJson(res, 400, { error: "无效的收款类型" });
    }
    payment.type = input.type;
  }

  if (input.method !== undefined) {
    if (!Object.keys(PAYMENT_METHOD_LABELS).includes(input.method)) {
      return sendJson(res, 400, { error: "无效的支付方式" });
    }
    payment.method = input.method;
  }

  if (input.paymentDate !== undefined) {
    payment.paymentDate = input.paymentDate;
  }

  if (input.remark !== undefined) {
    payment.remark = String(input.remark || "").trim();
  }

  settlement.updatedAt = new Date().toISOString();
  const newSummary = calcSettlementSummary(db, settlement, order);
  settlement.status = newSummary.status;

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

  db.payments.splice(idx, 1);
  settlement.updatedAt = new Date().toISOString();

  const newSummary = calcSettlementSummary(db, settlement, order);
  settlement.status = newSummary.status;

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
      updatedAt: s.updatedAt
    };
  });

  return sendJson(res, 200, result);
}
