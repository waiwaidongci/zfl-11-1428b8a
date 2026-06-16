import { loadDb } from "../data/db.js";
import { sendJson } from "../lib/http.js";
import { getEquipmentOccupancies } from "../lib/equipmentAvailability.js";

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

  const occupancies = getEquipmentOccupancies(db, {
    startDate,
    endDate,
    category,
    equipmentId,
    customer,
    includeOrders: true,
    includeQuotations: true,
    includeRepairs: true
  });

  const equipmentSchedule = occupancies.map((eq) => {
    const dailyStatus = {};

    for (const d of dates) {
      dailyStatus[d] = { available: true, statuses: [] };
    }

    for (const block of eq.blocks) {
      const blockDates = getDateRange(
        new Date(block.startDate) < new Date(startDate) ? startDate : block.startDate,
        new Date(block.endDate) > new Date(endDate) ? endDate : block.endDate
      );

      for (const d of blockDates) {
        if (dailyStatus[d]) {
          if (block.type === "order" || block.type === "repair" || (block.type === "quotation" && block.isLocked)) {
            dailyStatus[d].available = false;
          }
          dailyStatus[d].statuses.push({
            type: block.type,
            id: block.id,
            status: block.status,
            blockType: block.blockType,
            customer: block.customer,
            ...(block.type === "quotation" ? {
              isLocked: block.isLocked,
              isLockExpired: block.isLockExpired,
              lockStartAt: block.lockStartAt,
              lockEndAt: block.lockEndAt
            } : {})
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
      blocks: eq.blocks
    };
  });

  return sendJson(res, 200, {
    startDate,
    endDate,
    dates,
    equipment: equipmentSchedule
  });
}
