import { loadDb, saveDb, genRepairId, REPAIR_STATUSES, getActiveRepairByEquipmentId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

function buildRepairPayload(db, repair) {
  const equipment = db.equipment.find((e) => e.id === repair.equipmentId);
  return {
    ...repair,
    equipment: equipment
      ? {
          id: equipment.id,
          name: equipment.name,
          category: equipment.category,
          spec: equipment.spec,
          location: equipment.location,
          condition: equipment.condition
        }
      : null
  };
}

export async function listRepairs(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get("status");
  const equipmentId = url.searchParams.get("equipmentId");

  let list = [...db.repairs];
  if (status) list = list.filter((r) => r.status === status);
  if (equipmentId) list = list.filter((r) => r.equipmentId === equipmentId);

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const result = list.map((r) => buildRepairPayload(db, r));
  return sendJson(res, 200, result);
}

export async function getRepair(req, res, id) {
  const db = await loadDb();
  const repair = db.repairs.find((r) => r.id === id);
  if (!repair) return sendJson(res, 404, { error: "repair_not_found" });
  return sendJson(res, 200, buildRepairPayload(db, repair));
}

export async function createRepair(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.equipmentId) {
    return sendJson(res, 400, { error: "请选择维修设备" });
  }
  if (!input.faultDescription || !String(input.faultDescription).trim()) {
    return sendJson(res, 400, { error: "请填写故障描述" });
  }

  const equipment = db.equipment.find((e) => e.id === input.equipmentId);
  if (!equipment) {
    return sendJson(res, 404, { error: "设备不存在" });
  }

  const activeRepair = getActiveRepairByEquipmentId(db, input.equipmentId);
  if (activeRepair) {
    return sendJson(res, 409, { error: `该设备已有进行中的维修工单（${activeRepair.id}）` });
  }

  const status = REPAIR_STATUSES.includes(input.status) ? input.status : "pending";

  const repair = {
    id: input.id?.trim() || genRepairId(),
    equipmentId: input.equipmentId,
    equipmentName: equipment.name,
    faultDescription: String(input.faultDescription).trim(),
    sendTime: input.sendTime || new Date().toISOString().slice(0, 10),
    expectedReturn: input.expectedReturn || "",
    repairCost: input.repairCost != null ? Number(input.repairCost) || 0 : 0,
    status,
    note: input.note?.trim() || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };

  if (db.repairs.some((r) => r.id === repair.id)) {
    return sendJson(res, 409, { error: `维修工单编号 ${repair.id} 已存在` });
  }

  equipment.condition = "repair";
  if (["completed", "cancelled"].includes(status)) {
    equipment.condition = "available";
    if (status === "completed") repair.completedAt = new Date().toISOString();
  }

  db.repairs.unshift(repair);
  await saveDb(db);
  return sendJson(res, 201, buildRepairPayload(db, repair));
}

export async function updateRepair(req, res, id) {
  const db = await loadDb();
  const idx = db.repairs.findIndex((r) => r.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "repair_not_found" });

  const input = await parseBody(req);
  const current = db.repairs[idx];
  const equipment = db.equipment.find((e) => e.id === current.equipmentId);

  const merged = { ...current };

  if (input.faultDescription !== undefined) {
    merged.faultDescription = String(input.faultDescription).trim();
  }
  if (input.sendTime !== undefined) merged.sendTime = input.sendTime;
  if (input.expectedReturn !== undefined) merged.expectedReturn = input.expectedReturn;
  if (input.repairCost !== undefined) {
    merged.repairCost = Number(input.repairCost) || 0;
  }
  if (input.note !== undefined) merged.note = String(input.note || "").trim();

  if (input.status !== undefined) {
    if (!REPAIR_STATUSES.includes(input.status)) {
      return sendJson(res, 400, { error: "无效的维修状态" });
    }
    if (current.status === "completed" && input.status !== "completed") {
      return sendJson(res, 400, { error: "已完成的工单不能恢复为未完成状态" });
    }
    merged.status = input.status;

    if (equipment) {
      if (["pending", "repairing"].includes(input.status)) {
        equipment.condition = "repair";
      } else {
        equipment.condition = "available";
      }
    }

    if (input.status === "completed" && !merged.completedAt) {
      merged.completedAt = new Date().toISOString();
    }
    if (input.status !== "completed") {
      merged.completedAt = null;
    }
  }

  merged.updatedAt = new Date().toISOString();
  db.repairs[idx] = merged;
  await saveDb(db);
  return sendJson(res, 200, buildRepairPayload(db, merged));
}

export async function advanceRepairStatus(req, res, id) {
  const db = await loadDb();
  const idx = db.repairs.findIndex((r) => r.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "repair_not_found" });

  const current = db.repairs[idx];
  const flow = ["pending", "repairing", "completed"];
  const currentIdx = flow.indexOf(current.status);

  if (currentIdx === -1 || currentIdx >= flow.length - 1) {
    return sendJson(res, 400, { error: "当前状态无法继续推进" });
  }

  const nextStatus = flow[currentIdx + 1];
  const equipment = db.equipment.find((e) => e.id === current.equipmentId);

  current.status = nextStatus;
  current.updatedAt = new Date().toISOString();

  if (nextStatus === "completed") {
    current.completedAt = new Date().toISOString();
    if (equipment) equipment.condition = "available";
  } else if (equipment) {
    equipment.condition = "repair";
  }

  db.repairs[idx] = current;
  await saveDb(db);
  return sendJson(res, 200, buildRepairPayload(db, current));
}

export async function deleteRepair(req, res, id) {
  const db = await loadDb();
  const idx = db.repairs.findIndex((r) => r.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "repair_not_found" });

  const repair = db.repairs[idx];
  if (["pending", "repairing"].includes(repair.status)) {
    const equipment = db.equipment.find((e) => e.id === repair.equipmentId);
    if (equipment) equipment.condition = "available";
  }

  db.repairs.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}

export async function getEquipmentRepairs(req, res, equipmentId) {
  const db = await loadDb();
  const list = db.repairs
    .filter((r) => r.equipmentId === equipmentId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sendJson(res, 200, list.map((r) => buildRepairPayload(db, r)));
}
