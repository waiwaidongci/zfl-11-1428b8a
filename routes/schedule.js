import { loadDb, overlaps, getQuoteLockStatus } from "../data/db.js";
import { sendJson } from "../lib/http.js";

function parseDate(str) {
  const d = new Date(str);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDateRange(startDate, endDate) {
  const dates = [];
  let cur = parseDate(startDate);
  const end = parseDate(endDate);
  while (cur <= end) {
    dates.push(formatDate(cur));
    cur = addDays(cur, 1);
  }
  return dates;
}

export async function getSchedule(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultStart = formatDate(addDays(today, -7));
  const defaultEnd = formatDate(addDays(today, 30));

  const startDate = url.searchParams.get("startDate") || defaultStart;
  const endDate = url.searchParams.get("endDate") || defaultEnd;
  const category = url.searchParams.get("category") || "";
  const equipmentId = url.searchParams.get("equipmentId") || "";
  const customer = url.searchParams.get("customer") || "";

  if (new Date(endDate) < new Date(startDate)) {
    return sendJson(res, 400, { error: "结束日期不能早于开始日期" });
  }

  const dates = getDateRange(startDate, endDate);

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

  const equipmentSchedule = equipmentList.map((eq) => {
    const dailyStatus = {};
    const blocks = [];

    for (const d of dates) {
      dailyStatus[d] = { available: true, statuses: [] };
    }

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

      const orderDates = getDateRange(
        new Date(order.startDate) < new Date(startDate) ? startDate : order.startDate,
        new Date(order.endDate) > new Date(endDate) ? endDate : order.endDate
      );
      for (const d of orderDates) {
        if (dailyStatus[d]) {
          dailyStatus[d].available = false;
          dailyStatus[d].statuses.push({
            type: "order",
            id: order.id,
            status: order.status,
            blockType,
            customer: order.customer
          });
        }
      }
    }

    const eqQuotes = filteredQuotations.filter((q) => q.itemIds.includes(eq.id));
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

      const quoteDates = getDateRange(
        new Date(quote.startDate) < new Date(startDate) ? startDate : quote.startDate,
        new Date(quote.endDate) > new Date(endDate) ? endDate : quote.endDate
      );
      for (const d of quoteDates) {
        if (dailyStatus[d]) {
          if (isLocked) {
            dailyStatus[d].available = false;
          }
          dailyStatus[d].statuses.push({
            type: "quotation",
            id: quote.id,
            status: quote.status,
            blockType,
            isLocked,
            isLockExpired: wasLocked && !isLocked,
            lockStartAt: quote.lockStartAt,
            lockEndAt: quote.lockEndAt,
            customer: quote.customer
          });
        }
      }
    }

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

      const repairDates = getDateRange(
        new Date(repairStart) < new Date(startDate) ? startDate : repairStart,
        new Date(repairEnd) > new Date(endDate) ? endDate : repairEnd
      );
      for (const d of repairDates) {
        if (dailyStatus[d]) {
          dailyStatus[d].available = false;
          dailyStatus[d].statuses.push({
            type: "repair",
            id: repair.id,
            status: repair.status,
            blockType: "repairing"
          });
        }
      }
    }

    return {
      id: eq.id,
      name: eq.name,
      category: eq.category,
      spec: eq.spec,
      location: eq.location,
      condition: eq.condition,
      dailyStatus,
      blocks
    };
  });

  return sendJson(res, 200, {
    startDate,
    endDate,
    dates,
    equipment: equipmentSchedule
  });
}
