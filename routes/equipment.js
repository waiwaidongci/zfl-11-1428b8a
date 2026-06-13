import { loadDb, saveDb, genEquipmentId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

export async function listEquipment(req, res) {
  const db = await loadDb();
  return sendJson(res, 200, db.equipment);
}

export async function createEquipment(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.name || !input.category) {
    return sendJson(res, 400, { error: "设备名称和类别必填" });
  }

  const id = input.id?.trim() || genEquipmentId(input.category);
  if (db.equipment.some((e) => e.id === id)) {
    return sendJson(res, 409, { error: `设备编号 ${id} 已存在` });
  }

  const equipment = {
    id,
    name: input.name.trim(),
    category: input.category.trim(),
    spec: input.spec?.trim() || "",
    location: input.location?.trim() || "未指定",
    condition: input.condition === "repair" ? "repair" : "available"
  };

  db.equipment.unshift(equipment);
  await saveDb(db);
  return sendJson(res, 201, equipment);
}

export async function updateEquipment(req, res, id) {
  const db = await loadDb();
  const idx = db.equipment.findIndex((e) => e.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "equipment_not_found" });

  const input = await parseBody(req);
  const current = db.equipment[idx];

  if (input.name !== undefined) input.name = input.name.trim();
  if (input.category !== undefined) input.category = input.category.trim();
  if (input.spec !== undefined) input.spec = input.spec.trim();
  if (input.location !== undefined) input.location = input.location.trim();
  if (input.condition !== undefined) {
    input.condition = input.condition === "repair" ? "repair" : "available";
  }

  db.equipment[idx] = { ...current, ...input };
  await saveDb(db);
  return sendJson(res, 200, db.equipment[idx]);
}

export async function patchCondition(req, res, id) {
  const db = await loadDb();
  const equipment = db.equipment.find((e) => e.id === id);
  if (!equipment) return sendJson(res, 404, { error: "equipment_not_found" });

  const input = await parseBody(req);
  equipment.condition = input.condition === "repair" ? "repair" : "available";
  await saveDb(db);
  return sendJson(res, 200, equipment);
}

export async function deleteEquipment(req, res, id) {
  const db = await loadDb();
  const idx = db.equipment.findIndex((e) => e.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "equipment_not_found" });

  const usedInOrder = db.orders.some(
    (o) => !["已取消", "已归还"].includes(o.status) && o.itemIds.includes(id)
  );
  if (usedInOrder) {
    return sendJson(res, 409, { error: "该设备存在进行中的订单，无法删除" });
  }

  db.equipment.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}
