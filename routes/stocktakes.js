import {
  loadDb,
  saveDb,
  genStocktakeId,
  genRepairId,
  STOCKTAKE_STATUSES,
  STOCKTAKE_STATUS_LABELS,
  STOCKTAKE_RESULT_TYPES,
  STOCKTAKE_RESULT_LABELS,
  getActiveRepairByEquipmentId
} from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

function getStocktakeableEquipment(db, category) {
  const rentedInOrders = new Set(
    db.orders
      .filter((o) => !["已取消", "已归还"].includes(o.status))
      .flatMap((o) => o.itemIds)
  );

  return db.equipment.filter((e) => {
    if (category && e.category !== category) return false;
    if (e.condition === "rented" && rentedInOrders.has(e.id)) return false;
    if (e.condition === "repair") {
      const activeRepair = getActiveRepairByEquipmentId(db, e.id);
      if (activeRepair) return false;
    }
    return true;
  });
}

function buildStocktakePayload(db, stocktake) {
  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const items = stocktake.items.map((item) => {
    const eq = eqMap.get(item.equipmentId);
    return {
      ...item,
      equipment: eq
        ? {
            id: eq.id,
            name: eq.name,
            category: eq.category,
            spec: eq.spec,
            location: eq.location,
            condition: eq.condition
          }
        : null,
      resultLabel: STOCKTAKE_RESULT_LABELS[item.result] || item.result
    };
  });

  const stats = {
    total: items.length,
    normal: items.filter((i) => i.result === "normal").length,
    missing: items.filter((i) => i.result === "missing").length,
    damaged: items.filter((i) => i.result === "damaged").length,
    mismatch: items.filter((i) => i.result === "mismatch").length,
    pending: items.filter((i) => i.result && !i.processed && i.result !== "normal").length
  };

  return {
    ...stocktake,
    items,
    stats,
    statusLabel: STOCKTAKE_STATUS_LABELS[stocktake.status] || stocktake.status
  };
}

export async function listStocktakes(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");

  let list = [...(db.stocktakes || [])];
  if (status) list = list.filter((s) => s.status === status);

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const result = list.map((s) => buildStocktakePayload(db, s));
  return sendJson(res, 200, result);
}

export async function getStocktake(req, res, id) {
  const db = await loadDb();
  const stocktake = (db.stocktakes || []).find((s) => s.id === id);
  if (!stocktake) return sendJson(res, 404, { error: "stocktake_not_found" });
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function createStocktake(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.name || !String(input.name).trim()) {
    return sendJson(res, 400, { error: "请填写盘点任务名称" });
  }

  const category = input.category?.trim() || "";
  const stocktakeable = getStocktakeableEquipment(db, category);

  if (stocktakeable.length === 0) {
    return sendJson(res, 400, { error: category ? `「${category}」类别下无可盘点设备` : "当前无可盘点设备" });
  }

  const items = stocktakeable.map((e) => ({
    equipmentId: e.id,
    equipmentName: e.name,
    category: e.category,
    spec: e.spec,
    expectedLocation: e.location,
    actualLocation: "",
    result: "",
    remark: "",
    processed: false,
    linkedRepairId: null
  }));

  const stocktake = {
    id: genStocktakeId(),
    name: String(input.name).trim(),
    category,
    status: "processing",
    note: input.note?.trim() || "",
    items,
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  if (!db.stocktakes) db.stocktakes = [];
  db.stocktakes.unshift(stocktake);
  await saveDb(db);

  return sendJson(res, 201, buildStocktakePayload(db, stocktake));
}

export async function updateStocktake(req, res, id) {
  const db = await loadDb();
  const idx = (db.stocktakes || []).findIndex((s) => s.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "stocktake_not_found" });

  const stocktake = db.stocktakes[idx];
  if (stocktake.status === "completed" || stocktake.status === "cancelled") {
    return sendJson(res, 400, { error: "该盘点任务已完成或已取消，无法修改" });
  }

  const input = await parseBody(req);

  if (input.name !== undefined) {
    stocktake.name = String(input.name).trim();
  }
  if (input.note !== undefined) {
    stocktake.note = String(input.note || "").trim();
  }
  if (input.items !== undefined && Array.isArray(input.items)) {
    const validResults = new Set([...STOCKTAKE_RESULT_TYPES, ""]);
    for (const inputItem of input.items) {
      const item = stocktake.items.find((i) => i.equipmentId === inputItem.equipmentId);
      if (!item) continue;

      if (inputItem.actualLocation !== undefined) {
        item.actualLocation = String(inputItem.actualLocation || "").trim();
      }
      if (inputItem.result !== undefined) {
        if (!validResults.has(inputItem.result)) {
          return sendJson(res, 400, { error: `无效的盘点结果: ${inputItem.result}` });
        }
        item.result = inputItem.result;
        if (item.result === "normal") {
          item.processed = true;
        }
      }
      if (inputItem.remark !== undefined) {
        item.remark = String(inputItem.remark || "").trim();
      }
    }
  }

  await saveDb(db);
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function scanStocktakeItem(req, res, id) {
  const db = await loadDb();
  const stocktake = (db.stocktakes || []).find((s) => s.id === id);
  if (!stocktake) return sendJson(res, 404, { error: "stocktake_not_found" });
  if (stocktake.status === "completed" || stocktake.status === "cancelled") {
    return sendJson(res, 400, { error: "该盘点任务已完成或已取消，无法修改" });
  }

  const input = await parseBody(req);
  const equipmentId = String(input.equipmentId || "").trim();
  const result = input.result || "normal";
  const actualLocation = String(input.actualLocation || "").trim();
  const remark = String(input.remark || "").trim();

  if (!equipmentId) {
    return sendJson(res, 400, { error: "请输入设备编号", code: "empty_id" });
  }

  const validResults = new Set([...STOCKTAKE_RESULT_TYPES]);
  if (!validResults.has(result)) {
    return sendJson(res, 400, { error: `无效的盘点结果: ${result}`, code: "invalid_result" });
  }

  if (result === "mismatch" && !actualLocation) {
    return sendJson(res, 400, { error: "库位不符必须填写实际位置", code: "missing_location" });
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) {
    const allEquipment = db.equipment.find((e) => e.id === equipmentId);
    if (allEquipment) {
      return sendJson(res, 400, {
        error: `设备「${allEquipment.name} (${equipmentId})」不在本次盘点范围内`,
        code: "not_in_stocktake",
        equipment: { id: allEquipment.id, name: allEquipment.name, category: allEquipment.category }
      });
    } else {
      return sendJson(res, 400, {
        error: `设备编号「${equipmentId}」不存在`,
        code: "equipment_not_found"
      });
    }
  }

  const isDuplicate = !!item.result;
  const isProcessedDiff = item.processed && item.result !== "normal";

  if (isProcessedDiff) {
    return sendJson(res, 400, {
      error: `设备「${item.equipmentName} (${equipmentId})」的差异已处理，无法重新扫码`,
      code: "diff_already_processed",
      item: {
        equipmentId: item.equipmentId,
        equipmentName: item.equipmentName,
        category: item.category,
        result: item.result,
        resultLabel: STOCKTAKE_RESULT_LABELS[item.result] || item.result
      }
    });
  }

  const previousResult = item.result;
  item.result = result;
  item.actualLocation = actualLocation;
  if (remark) item.remark = remark;
  if (result === "normal") {
    item.processed = true;
  } else {
    item.processed = false;
  }

  await saveDb(db);

  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const eq = eqMap.get(item.equipmentId);
  const itemWithEquipment = {
    ...item,
    equipment: eq
      ? {
          id: eq.id,
          name: eq.name,
          category: eq.category,
          spec: eq.spec,
          location: eq.location,
          condition: eq.condition
        }
      : null,
    resultLabel: STOCKTAKE_RESULT_LABELS[item.result] || item.result
  };

  return sendJson(res, 200, {
    ok: true,
    isDuplicate,
    previousResult,
    previousResultLabel: previousResult ? STOCKTAKE_RESULT_LABELS[previousResult] || previousResult : null,
    item: itemWithEquipment,
    stocktake: buildStocktakePayload(db, stocktake)
  });
}

export async function submitStocktake(req, res, id) {
  const db = await loadDb();
  const idx = (db.stocktakes || []).findIndex((s) => s.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "stocktake_not_found" });

  const stocktake = db.stocktakes[idx];
  if (stocktake.status === "completed" || stocktake.status === "cancelled") {
    return sendJson(res, 400, { error: "该盘点任务已完成或已取消" });
  }

  const unmarked = stocktake.items.filter((i) => !i.result);
  if (unmarked.length > 0) {
    const names = unmarked.slice(0, 5).map((i) => `${i.equipmentName} (${i.equipmentId})`).join("、");
    const more = unmarked.length > 5 ? ` 等 ${unmarked.length} 台` : "";
    return sendJson(res, 400, { error: `还有设备未完成盘点：${names}${more}` });
  }

  stocktake.status = "completed";
  stocktake.completedAt = new Date().toISOString();

  for (const item of stocktake.items) {
    if (item.result === "normal") {
      item.processed = true;
    }
  }

  await saveDb(db);
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function processDamaged(req, res, id, equipmentId) {
  const db = await loadDb();
  const stocktake = (db.stocktakes || []).find((s) => s.id === id);
  if (!stocktake) return sendJson(res, 404, { error: "stocktake_not_found" });
  if (stocktake.status !== "completed") {
    return sendJson(res, 400, { error: "只有已提交的盘点才能处理差异" });
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return sendJson(res, 404, { error: "item_not_found" });
  if (item.result !== "damaged") {
    return sendJson(res, 400, { error: "该设备盘点结果不是损坏" });
  }
  if (item.processed) {
    return sendJson(res, 400, { error: "该设备已处理过" });
  }

  const equipment = db.equipment.find((e) => e.id === equipmentId);
  if (!equipment) return sendJson(res, 404, { error: "equipment_not_found" });

  if (equipment.condition === "rented") {
    return sendJson(res, 409, { error: "该设备当前在租，无法标记为维修" });
  }

  const activeRepair = getActiveRepairByEquipmentId(db, equipmentId);
  if (activeRepair) {
    return sendJson(res, 409, { error: `该设备已有进行中的维修工单（${activeRepair.id}）` });
  }

  const input = await parseBody(req);
  const faultDescription = input.faultDescription?.trim() || item.remark || "盘点时发现损坏";

  const repair = {
    id: genRepairId(),
    equipmentId,
    equipmentName: equipment.name,
    faultDescription,
    sendTime: new Date().toISOString().split("T")[0],
    expectedReturn: input.expectedReturn || "",
    repairCost: Number(input.repairCost) || 0,
    actualRepairCost: 0,
    status: "pending",
    note: `盘点任务 ${stocktake.id} 发现损坏，${item.remark || ""}`,
    source: "stocktake",
    sourceId: stocktake.id,
    orderId: null,
    liability: "company",
    customerAmount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };

  if (!db.repairs) db.repairs = [];
  db.repairs.unshift(repair);

  equipment.condition = "repair";

  item.processed = true;
  item.linkedRepairId = repair.id;

  await saveDb(db);
  return sendJson(res, 200, {
    repair,
    stocktake: buildStocktakePayload(db, stocktake)
  });
}

export async function processMissing(req, res, id, equipmentId) {
  const db = await loadDb();
  const stocktake = (db.stocktakes || []).find((s) => s.id === id);
  if (!stocktake) return sendJson(res, 404, { error: "stocktake_not_found" });
  if (stocktake.status !== "completed") {
    return sendJson(res, 400, { error: "只有已提交的盘点才能处理差异" });
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return sendJson(res, 404, { error: "item_not_found" });
  if (item.result !== "missing") {
    return sendJson(res, 400, { error: "该设备盘点结果不是丢失" });
  }
  if (item.processed) {
    return sendJson(res, 400, { error: "该设备已处理过" });
  }

  const equipment = db.equipment.find((e) => e.id === equipmentId);
  if (!equipment) return sendJson(res, 404, { error: "equipment_not_found" });

  if (equipment.condition === "rented") {
    return sendJson(res, 409, { error: "该设备当前在租，请先与客户确认归还情况" });
  }

  equipment.condition = "missing";

  item.processed = true;

  await saveDb(db);
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function processMismatch(req, res, id, equipmentId) {
  const db = await loadDb();
  const stocktake = (db.stocktakes || []).find((s) => s.id === id);
  if (!stocktake) return sendJson(res, 404, { error: "stocktake_not_found" });
  if (stocktake.status !== "completed") {
    return sendJson(res, 400, { error: "只有已提交的盘点才能处理差异" });
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return sendJson(res, 404, { error: "item_not_found" });
  if (item.result !== "mismatch") {
    return sendJson(res, 400, { error: "该设备盘点结果不是位置不符" });
  }
  if (item.processed) {
    return sendJson(res, 400, { error: "该设备已处理过" });
  }

  const equipment = db.equipment.find((e) => e.id === equipmentId);
  if (!equipment) return sendJson(res, 404, { error: "equipment_not_found" });

  const newLocation = item.actualLocation?.trim();
  if (!newLocation) {
    return sendJson(res, 400, { error: "请填写实际存放位置" });
  }

  equipment.location = newLocation;

  item.processed = true;

  await saveDb(db);
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function markItemProcessed(req, res, id, equipmentId) {
  const db = await loadDb();
  const stocktake = (db.stocktakes || []).find((s) => s.id === id);
  if (!stocktake) return sendJson(res, 404, { error: "stocktake_not_found" });
  if (stocktake.status !== "processing") {
    return sendJson(res, 400, { error: "只能在进行中的盘点任务中标记" });
  }

  const item = stocktake.items.find((i) => i.equipmentId === equipmentId);
  if (!item) return sendJson(res, 404, { error: "item_not_found" });
  if (!item.result || item.result === "normal") {
    return sendJson(res, 400, { error: "该设备无待处理的差异" });
  }
  if (item.processed) {
    return sendJson(res, 400, { error: "该设备已标记为已处理" });
  }

  item.processed = true;
  item.manuallyProcessed = true;

  await saveDb(db);
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function cancelStocktake(req, res, id) {
  const db = await loadDb();
  const idx = (db.stocktakes || []).findIndex((s) => s.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "stocktake_not_found" });

  const stocktake = db.stocktakes[idx];
  if (stocktake.status === "completed") {
    return sendJson(res, 400, { error: "已完成的盘点任务无法取消" });
  }

  stocktake.status = "cancelled";
  await saveDb(db);
  return sendJson(res, 200, buildStocktakePayload(db, stocktake));
}

export async function deleteStocktake(req, res, id) {
  const db = await loadDb();
  const idx = (db.stocktakes || []).findIndex((s) => s.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "stocktake_not_found" });

  const stocktake = db.stocktakes[idx];
  if (stocktake.status === "processing") {
    return sendJson(res, 400, { error: "进行中的盘点任务请先取消再删除" });
  }

  db.stocktakes.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}
