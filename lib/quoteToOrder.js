import { loadDb, saveDb } from "../data/db.js";
import { validateEquipmentForOrder } from "./equipmentValidator.js";

const QUOTE_FINAL_STATUSES = ["已转订单", "已取消"];

export function isQuoteConvertible(quote) {
  if (!quote) return { ok: false, reason: "报价单不存在" };
  if (QUOTE_FINAL_STATUSES.includes(quote.status)) {
    return { ok: false, reason: `报价单状态为「${quote.status}」，不能转订单` };
  }
  if (quote.status !== "已确认") {
    return { ok: false, reason: `只有「已确认」状态的报价单才能转订单（当前为「${quote.status || "未设置"}」）` };
  }

  const currentVersion = (quote.versions || []).find((v) => v.versionId === quote.currentVersionId);
  const hasApprovedVersion = quote.approvedVersionId != null &&
    currentVersion &&
    currentVersion.versionId === quote.approvedVersionId &&
    currentVersion.approvalStatus === "approved";

  const isLegacyQuote = !quote.versions || quote.versions.length === 0 ||
    (quote.versions.length === 1 && quote.versions[0].createdBy === "system");

  if (!hasApprovedVersion && !isLegacyQuote) {
    return { ok: false, reason: "当前报价版本未审批通过，请先审批当前版本" };
  }

  if (!quote.itemIds || !quote.itemIds.length) {
    return { ok: false, reason: "报价单中没有设备，无法转订单" };
  }
  if (!quote.startDate || !quote.endDate) {
    return { ok: false, reason: "报价单租期不完整" };
  }
  if (!quote.customer) {
    return { ok: false, reason: "报价单未指定客户" };
  }
  return { ok: true };
}

export async function convertQuotationToOrder(quotationId) {
  const db = await loadDb();
  const quote = db.quotations.find((q) => q.id === quotationId);

  const convertible = isQuoteConvertible(quote);
  if (!convertible.ok) {
    return { success: false, status: 400, error: convertible.reason };
  }

  const validation = validateEquipmentForOrder(
    db,
    quote.itemIds,
    quote.startDate,
    quote.endDate,
    null
  );
  if (!validation.valid) {
    return {
      success: false,
      status: 409,
      error: `转订单校验失败：${validation.errors.join("；")}`,
      details: {
        repair: validation.repair,
        conflicts: validation.conflicts,
        missing: validation.missing
      }
    };
  }

  const order = {
    id: `O-${Date.now()}`,
    customer: quote.customer,
    startDate: quote.startDate,
    endDate: quote.endDate,
    status: "待出库",
    itemIds: [...quote.itemIds],
    note: quote.note ? `【源自报价单 ${quote.id}】${quote.note}` : `【源自报价单 ${quote.id}】`
  };

  db.orders.unshift(order);

  quote.status = "已转订单";
  quote.convertedOrderId = order.id;
  quote.convertedAt = new Date().toISOString();

  await saveDb(db);
  return { success: true, status: 201, order, quote };
}
