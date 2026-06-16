import { loadDb, saveDb, getQuoteLockStatus, addQuoteLockHistory } from "../data/db.js";
import { validateEquipmentForOrder } from "./equipmentValidator.js";
import {
  AUDIT_OBJECT_TYPES,
  AUDIT_ACTIONS,
  createAuditLogEntry,
  addAuditLog
} from "./audit.js";

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

  const lockStatus = getQuoteLockStatus(quote);
  if (lockStatus.locked) {
    const remainingHours = Math.ceil(lockStatus.remainingMs / (1000 * 60 * 60));
    const note = remainingHours > 48
      ? `（当前报价锁定至 ${quote.lockEndAt?.replace("T", " ").slice(0, 16) || ""}，剩余约 ${remainingHours} 小时，转订单后锁定将自动解除）`
      : "";
  }

  const validation = validateEquipmentForOrder(
    db,
    quote.itemIds,
    quote.startDate,
    quote.endDate,
    null,
    quote.id
  );
  if (!validation.valid) {
    return {
      success: false,
      status: 409,
      error: `转订单校验失败：${validation.errors.join("；")}`,
      details: {
        repair: validation.repair,
        conflicts: validation.conflicts,
        quoteLocks: validation.quoteLocks,
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
    packageIds: quote.packageIds ? [...quote.packageIds] : [],
    sourceQuoteId: quote.id,
    note: quote.note ? `【源自报价单 ${quote.id}】${quote.note}` : `【源自报价单 ${quote.id}】`
  };

  db.orders.unshift(order);

  quote.status = "已转订单";
  quote.convertedOrderId = order.id;
  quote.convertedAt = new Date().toISOString();

  addQuoteLockHistory(quote, "convert", {
    orderId: order.id,
    lockStartAt: quote.lockStartAt,
    lockEndAt: quote.lockEndAt,
    lockedBy: quote.lockedBy
  });

  quote.lockReleasedAt = new Date().toISOString();
  quote.lockReleaseReason = "converted_to_order";

  const auditEntry = createAuditLogEntry({
    objectType: AUDIT_OBJECT_TYPES.QUOTATION,
    objectId: quotationId,
    action: AUDIT_ACTIONS.CONVERT_TO_ORDER,
    summary: `报价单 ${quotationId} 转订单 ${order.id}`,
    detail: `客户: ${quote.customer}, 租期: ${quote.startDate} ~ ${quote.endDate}, 设备数: ${quote.itemIds?.length || 0}`,
    before: { status: quote.status === "已转订单" ? "已确认" : quote.status },
    after: { status: "已转订单", convertedOrderId: order.id },
    operator: "user",
    reversible: false,
    extra: { orderId: order.id }
  });
  await addAuditLog(db, auditEntry);

  await saveDb(db);
  return { success: true, status: 201, order, quote };
}
