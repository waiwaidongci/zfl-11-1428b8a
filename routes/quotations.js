import { loadDb, saveDb, genQuotationId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import { buildQuoteSummary, calcRentalDays } from "../lib/quoteCalculator.js";
import { convertQuotationToOrder, isQuoteConvertible } from "../lib/quoteToOrder.js";
import { validateEquipmentForOrder, findRepairItems } from "../lib/equipmentValidator.js";

const QUOTE_STATUSES = ["草稿", "已确认", "已转订单", "已取消"];

function buildQuotationPayload(db, quote, withSummary = true) {
  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const customer = (db.customers || []).find((c) => c.name === quote.customer);

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
    customerActivity: customer ? customer.activityType : ""
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

export async function listQuotations(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");
  const customer = url.searchParams.get("customer");

  let list = [...db.quotations];
  if (status) list = list.filter((q) => q.status === status);
  if (customer) list = list.filter((q) => (q.customer || "").includes(customer));

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
  return errors;
}

export async function createQuotation(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  const errors = validateQuoteInput(input);
  if (errors.length) {
    return sendJson(res, 400, { error: errors.join("；") });
  }

  const status = QUOTE_STATUSES.includes(input.status) ? input.status : "草稿";

  const quotation = {
    id: input.id?.trim() || genQuotationId(),
    customer: String(input.customer).trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    rentalDays: calcRentalDays(input.startDate, input.endDate),
    itemIds: [...new Set(input.itemIds.filter(Boolean))],
    discount: input.discount != null ? Number(input.discount) : 0,
    depositOverride: input.depositOverride || {},
    status,
    note: input.note?.trim() || "",
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
  merged.updatedAt = new Date().toISOString();

  if (merged.startDate && merged.endDate && merged.itemIds?.length) {
    const errors = validateQuoteInput({
      customer: merged.customer,
      startDate: merged.startDate,
      endDate: merged.endDate,
      itemIds: merged.itemIds,
      discount: merged.discount
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

  db.quotations[idx] = merged;
  await saveDb(db);
  return sendJson(res, 200, buildQuotationPayload(db, merged, true));
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

  const summary = buildQuoteSummary(db.equipment, itemIds, startDate, endDate, depositOverride, discount);
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
    const validation = validateEquipmentForOrder(db, quote.itemIds, quote.startDate, quote.endDate);
    response.equipmentCheck = {
      valid: validation.valid,
      repair: validation.repair,
      conflicts: validation.conflicts,
      missing: validation.missing
    };
    if (!validation.valid) {
      response.convertible = false;
      response.reason = `转订单校验失败：${validation.errors.join("；")}`;
    }
  }

  return sendJson(res, 200, response);
}
