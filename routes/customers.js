import { loadDb, saveDb, genCustomerId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

function calcCustomerOverview(db, customer) {
  const customerName = customer.name;

  const quotations = (db.quotations || []).filter(
    (q) => (q.customer || "") === customerName
  );
  const quotationCount = quotations.length;
  const convertedQuotationCount = quotations.filter(
    (q) => q.status === "已转订单"
  ).length;

  const orders = (db.orders || []).filter(
    (o) => (o.customer || "") === customerName
  );
  const orderCount = orders.length;

  let lastRentalDate = "";
  if (orders.length) {
    const allDates = orders
      .flatMap((o) => [o.startDate, o.endDate, o.returnTime, o.checkoutTime])
      .filter(Boolean)
      .sort();
    if (allDates.length) {
      lastRentalDate = allDates[allDates.length - 1].split("T")[0];
    }
  }

  let unsettledAmount = 0;
  const settlements = db.settlements || [];
  const payments = db.payments || [];
  for (const s of settlements) {
    const order = db.orders.find((o) => o.id === s.orderId);
    if (!order || order.customer !== customerName) continue;
    if (order.status === "已取消") continue;

    const fees = s.fees || [];
    const rentalFee = fees
      .filter((f) => f.type === "rental")
      .reduce((sum, f) => sum + Number(f.amount) || 0, 0);
    const transportFee = fees
      .filter((f) => f.type === "transport")
      .reduce((sum, f) => sum + Number(f.amount) || 0, 0);
    const laborFee = fees
      .filter((f) => f.type === "labor")
      .reduce((sum, f) => sum + Number(f.amount) || 0, 0);
    const setupFee = fees
      .filter((f) => f.type === "setup")
      .reduce((sum, f) => sum + Number(f.amount) || 0, 0);
    const compensationFee = fees
      .filter((f) => f.type === "compensation")
      .reduce((sum, f) => sum + Number(f.amount) || 0, 0);
    const discountFee = fees
      .filter((f) => f.type === "discount")
      .reduce((sum, f) => sum + Number(f.amount) || 0, 0);

    const receivableTotal =
      rentalFee + transportFee + laborFee + setupFee + compensationFee - discountFee;

    const totalPaid = payments
      .filter(
        (p) =>
          p.settlementId === s.id &&
          (p.type === "payment" || p.type === "deposit_deduction")
      )
      .reduce((sum, p) => sum + Number(p.amount) || 0, 0);

    const balanceDue = receivableTotal - totalPaid;
    if (balanceDue > 0.01) {
      unsettledAmount += balanceDue;
    }
  }

  return {
    quotationCount,
    convertedQuotationCount,
    orderCount,
    lastRentalDate,
    unsettledAmount: Math.round(unsettledAmount * 100) / 100
  };
}

function buildCustomerPayload(db, customer) {
  return {
    ...customer,
    overview: calcCustomerOverview(db, customer)
  };
}

export async function listCustomers(req, res) {
  const db = await loadDb();
  const list = (db.customers || []).map((c) => buildCustomerPayload(db, c));
  return sendJson(res, 200, list);
}

export async function getCustomer(req, res, id) {
  const db = await loadDb();
  const customer = (db.customers || []).find((c) => c.id === id);
  if (!customer) return sendJson(res, 404, { error: "customer_not_found" });
  return sendJson(res, 200, buildCustomerPayload(db, customer));
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
  return sendJson(res, 201, buildCustomerPayload(db, customer));
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
  return sendJson(res, 200, buildCustomerPayload(db, db.customers[idx]));
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
