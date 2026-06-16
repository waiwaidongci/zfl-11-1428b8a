import { loadDb } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import {
  checkEquipmentAvailability,
  getAvailableEquipment,
  CONFLICT_TYPES,
  DEFAULT_CHECK_TYPES
} from "../lib/equipmentAvailability.js";

export async function checkAvailability(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  const itemIds = input.itemIds || [];
  const startDate = input.startDate || null;
  const endDate = input.endDate || null;
  const exceptOrderId = input.exceptOrderId || null;
  const exceptQuoteId = input.exceptQuoteId || null;
  const checkTypes = input.checkTypes || DEFAULT_CHECK_TYPES;

  if (!itemIds.length) {
    return sendJson(res, 400, { error: "请指定要检查的设备" });
  }

  const result = checkEquipmentAvailability(db, {
    itemIds,
    startDate,
    endDate,
    exceptOrderId,
    exceptQuoteId,
    checkTypes,
    includeEquipmentInfo: true
  });

  return sendJson(res, 200, result);
}

export async function listAvailable(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);

  const category = url.searchParams.get("category") || "";
  const startDate = url.searchParams.get("startDate") || null;
  const endDate = url.searchParams.get("endDate") || null;
  const exceptOrderId = url.searchParams.get("exceptOrderId") || null;
  const exceptQuoteId = url.searchParams.get("exceptQuoteId") || null;
  const excludeTypesParam = url.searchParams.get("excludeTypes") || "";

  const excludeTypes = excludeTypesParam
    ? excludeTypesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [CONFLICT_TYPES.RENTED, CONFLICT_TYPES.REPAIR];

  const equipment = getAvailableEquipment(db, {
    category,
    startDate,
    endDate,
    exceptOrderId,
    exceptQuoteId,
    excludeTypes
  });

  return sendJson(res, 200, {
    total: equipment.length,
    equipment
  });
}

export async function getConflictTypes(req, res) {
  return sendJson(res, 200, {
    types: CONFLICT_TYPES,
    labels: {
      not_found: "设备不存在",
      missing: "设备已缺失",
      repair: "维修中",
      rented: "租赁中",
      order_rental: "租期冲突",
      quote_lock: "报价锁定"
    }
  });
}
