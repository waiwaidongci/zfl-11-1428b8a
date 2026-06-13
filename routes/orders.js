import { loadDb, saveDb, occupiedItems } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

export async function listOrders(req, res) {
  const db = await loadDb();
  return sendJson(res, 200, db.orders);
}

export async function createOrder(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.customer || !input.startDate || !input.endDate) {
    return sendJson(res, 400, { error: "客户和租期必填" });
  }
  if (!input.itemIds?.length) {
    return sendJson(res, 400, { error: "请至少选择一件设备" });
  }
  if (new Date(input.endDate) < new Date(input.startDate)) {
    return sendJson(res, 400, { error: "结束日期不能早于开始日期" });
  }

  const occupied = occupiedItems(db, input.startDate, input.endDate);
  const repair = db.equipment.filter((item) => input.itemIds.includes(item.id) && item.condition === "repair").map((item) => item.id);
  const conflict = input.itemIds.filter((id) => occupied.has(id));

  if (repair.length || conflict.length) {
    const reasons = [];
    if (repair.length) reasons.push(`维修中: ${repair.join("、")}`);
    if (conflict.length) reasons.push(`租期占用: ${conflict.join("、")}`);
    return sendJson(res, 409, { error: `设备不可用（${reasons.join("；")}）` });
  }

  const order = {
    id: `O-${Date.now()}`,
    customer: input.customer,
    startDate: input.startDate,
    endDate: input.endDate,
    status: "待出库",
    itemIds: input.itemIds,
    note: input.note || ""
  };

  db.orders.unshift(order);
  await saveDb(db);
  return sendJson(res, 201, order);
}

export async function updateOrder(req, res, id) {
  const db = await loadDb();
  const order = db.orders.find((item) => item.id === id);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const input = await parseBody(req);

  if (input.status && !["待出库", "已出库", "待归还", "已归还", "已取消"].includes(input.status)) {
    return sendJson(res, 400, { error: "无效的订单状态" });
  }

  Object.assign(order, input);
  await saveDb(db);
  return sendJson(res, 200, order);
}
