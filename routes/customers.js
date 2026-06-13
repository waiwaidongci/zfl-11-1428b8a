import { loadDb, saveDb, genCustomerId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

export async function listCustomers(req, res) {
  const db = await loadDb();
  return sendJson(res, 200, db.customers || []);
}

export async function getCustomer(req, res, id) {
  const db = await loadDb();
  const customer = (db.customers || []).find((c) => c.id === id);
  if (!customer) return sendJson(res, 404, { error: "customer_not_found" });
  return sendJson(res, 200, customer);
}

export async function createCustomer(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.name || !input.name.trim()) {
    return sendJson(res, 400, { error: "客户名称必填" });
  }

  const name = input.name.trim();
  if ((db.customers || []).some((c) => c.name === name)) {
    return sendJson(res, 409, { error: `客户「${name}」已存在` });
  }

  const customer = {
    id: input.id?.trim() || genCustomerId(),
    name,
    contact: input.contact?.trim() || "",
    phone: input.phone?.trim() || "",
    activityType: input.activityType?.trim() || "",
    note: input.note?.trim() || ""
  };

  db.customers = db.customers || [];
  db.customers.unshift(customer);
  await saveDb(db);
  return sendJson(res, 201, customer);
}

export async function updateCustomer(req, res, id) {
  const db = await loadDb();
  db.customers = db.customers || [];
  const idx = db.customers.findIndex((c) => c.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "customer_not_found" });

  const input = await parseBody(req);
  const current = db.customers[idx];

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      return sendJson(res, 400, { error: "客户名称必填" });
    }
    if (db.customers.some((c, i) => i !== idx && c.name === name)) {
      return sendJson(res, 409, { error: `客户名称「${name}」已存在` });
    }
    input.name = name;
  }
  if (input.contact !== undefined) input.contact = input.contact.trim();
  if (input.phone !== undefined) input.phone = input.phone.trim();
  if (input.activityType !== undefined) input.activityType = input.activityType.trim();
  if (input.note !== undefined) input.note = input.note.trim();

  db.customers[idx] = { ...current, ...input };
  await saveDb(db);
  return sendJson(res, 200, db.customers[idx]);
}

export async function deleteCustomer(req, res, id) {
  const db = await loadDb();
  db.customers = db.customers || [];
  const idx = db.customers.findIndex((c) => c.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "customer_not_found" });

  const customer = db.customers[idx];
  const usedInOrder = db.orders.some(
    (o) => !["已取消", "已归还"].includes(o.status) && o.customer === customer.name
  );
  if (usedInOrder) {
    return sendJson(res, 409, { error: "该客户存在进行中的订单，无法删除" });
  }

  db.customers.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}
