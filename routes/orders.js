import { loadDb, saveDb, occupiedItems, genHandoverId, genRepairId } from "../data/db.js";
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

export async function getOrder(req, res, id) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === id);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const eqMap = new Map(db.equipment.map((e) => [e.id, e]));
  const items = order.itemIds.map((iid) => {
    const eq = eqMap.get(iid);
    return {
      id: iid,
      name: eq ? eq.name : "（已删除）",
      spec: eq ? eq.spec : "",
      category: eq ? eq.category : ""
    };
  });

  const customer = (db.customers || []).find((c) => c.name === order.customer);
  const handovers = (db.handovers || []).filter((h) => h.orderId === id);

  return sendJson(res, 200, {
    id: order.id,
    customer: order.customer,
    customerContact: customer ? customer.contact : "",
    customerPhone: customer ? customer.phone : "",
    startDate: order.startDate,
    endDate: order.endDate,
    status: order.status,
    note: order.note || "",
    items,
    handovers
  });
}

export async function updateOrder(req, res, id) {
  const db = await loadDb();
  const order = db.orders.find((item) => item.id === id);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const input = await parseBody(req);

  if (input.status && !["待出库", "已出库", "待归还", "已归还", "已取消"].includes(input.status)) {
    return sendJson(res, 400, { error: "无效的订单状态" });
  }

  if (input.status) {
    const handovers = (db.handovers || []).filter((h) => h.orderId === id);
    const hasCheckout = handovers.some((h) => h.type === "checkout");
    const hasReturn = handovers.some((h) => h.type === "return");

    if (["已出库", "待归还"].includes(input.status) && !hasCheckout) {
      return sendJson(res, 400, { error: "请先填写出库交接记录，才能变更到此状态" });
    }
    if (input.status === "已归还" && !hasReturn) {
      return sendJson(res, 400, { error: "请先填写归还交接记录，才能变更为已归还" });
    }
    if (hasReturn && input.status !== "已归还" && input.status !== "已取消") {
      return sendJson(res, 400, { error: "已有归还交接记录，无法回退状态" });
    }
  }

  const { status, ...otherFields } = input;
  Object.assign(order, otherFields);
  if (status) {
    order.status = status;
  }
  await saveDb(db);
  return sendJson(res, 200, order);
}

export async function getHandover(req, res, orderId, handoverId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const handover = (db.handovers || []).find((h) => h.id === handoverId && h.orderId === orderId);
  if (!handover) return sendJson(res, 404, { error: "handover_not_found" });

  return sendJson(res, 200, handover);
}

export async function listHandovers(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const handovers = (db.handovers || []).filter((h) => h.orderId === orderId);
  return sendJson(res, 200, handovers);
}

export async function createHandover(req, res, orderId) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  const input = await parseBody(req);

  if (!input.type || !["checkout", "return"].includes(input.type)) {
    return sendJson(res, 400, { error: "交接类型必须为 checkout 或 return" });
  }

  if (input.type === "checkout") {
    if (order.status !== "待出库") {
      return sendJson(res, 400, { error: "只有「待出库」状态的订单才能进行出库交接" });
    }
    if (!input.handler) {
      return sendJson(res, 400, { error: "经手人必填" });
    }
    if (!input.actualTime) {
      return sendJson(res, 400, { error: "实际出库时间必填" });
    }
    if (!input.itemConfirmations || !Array.isArray(input.itemConfirmations) || input.itemConfirmations.length === 0) {
      return sendJson(res, 400, { error: "设备逐项确认结果必填" });
    }

    const validItemIds = new Set(order.itemIds);
    const allConfirmed = input.itemConfirmations.every(
      (c) => validItemIds.has(c.itemId) && c.confirmed
    );
    if (!allConfirmed) {
      return sendJson(res, 400, { error: "所有设备必须确认后才能出库" });
    }

    const handover = {
      id: genHandoverId(),
      orderId,
      type: "checkout",
      handler: input.handler,
      actualTime: input.actualTime,
      itemConfirmations: input.itemConfirmations.map((c) => ({
        itemId: c.itemId,
        itemName: c.itemName || "",
        confirmed: !!c.confirmed,
        remark: c.remark || ""
      })),
      remarks: input.remarks || "",
      createdAt: new Date().toISOString()
    };

    if (!db.handovers) db.handovers = [];
    db.handovers.unshift(handover);
    order.status = "已出库";
    order.checkoutTime = input.actualTime;

    for (const item of input.itemConfirmations) {
      const eq = db.equipment.find((e) => e.id === item.itemId);
      if (eq) {
        eq.condition = "rented";
      }
    }

    await saveDb(db);
    return sendJson(res, 201, handover);
  }

  if (input.type === "return") {
    if (!["已出库", "待归还"].includes(order.status)) {
      return sendJson(res, 400, { error: "只有「已出库」或「待归还」状态的订单才能进行归还交接" });
    }
    const handovers = (db.handovers || []).filter((h) => h.orderId === orderId);
    if (!handovers.some((h) => h.type === "checkout")) {
      return sendJson(res, 400, { error: "请先完成出库交接，再进行归还交接" });
    }
    if (!input.actualTime) {
      return sendJson(res, 400, { error: "实际归还时间必填" });
    }
    if (!input.itemStatuses || !Array.isArray(input.itemStatuses) || input.itemStatuses.length === 0) {
      return sendJson(res, 400, { error: "设备归还状态必填" });
    }

    const validItemIds = new Set(order.itemIds);
    const allHaveStatus = input.itemStatuses.every(
      (s) => validItemIds.has(s.itemId) && ["intact", "damaged", "missing"].includes(s.status)
    );
    if (!allHaveStatus) {
      return sendJson(res, 400, { error: "设备状态无效，必须为完好、损坏或缺失" });
    }

    const handover = {
      id: genHandoverId(),
      orderId,
      type: "return",
      handler: input.handler || "",
      actualTime: input.actualTime,
      itemStatuses: input.itemStatuses.map((s) => ({
        itemId: s.itemId,
        itemName: s.itemName || "",
        status: s.status,
        remark: s.remark || ""
      })),
      compensationNote: input.compensationNote || "",
      extraCharges: Number(input.extraCharges) || 0,
      remarks: input.remarks || "",
      createdAt: new Date().toISOString()
    };

    if (!db.handovers) db.handovers = [];
    db.handovers.unshift(handover);
    order.status = "已归还";
    order.returnTime = input.actualTime;

    for (const item of input.itemStatuses) {
      const eq = db.equipment.find((e) => e.id === item.itemId);
      if (eq) {
        if (item.status === "intact") {
          eq.condition = "available";
        } else if (item.status === "damaged") {
          eq.condition = "repair";

          const repair = {
            id: genRepairId(),
            equipmentId: item.itemId,
            equipmentName: item.itemName || eq.name,
            faultDescription: item.remark || "归还时发现损坏",
            sendTime: new Date().toISOString().split("T")[0],
            expectedReturn: "",
            repairCost: 0,
            status: "pending",
            note: `订单 ${order.id} 归还时发现损坏`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null
          };
          if (!db.repairs) db.repairs = [];
          db.repairs.unshift(repair);
        } else if (item.status === "missing") {
          eq.condition = "missing";
        }
      }
    }

    await saveDb(db);
    return sendJson(res, 201, handover);
  }
}
