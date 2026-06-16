import { loadDb, saveDb, occupiedItems, genHandoverId, genRepairId, genHandoverDraftId, occupiedItemsWithLocks } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import { validateEquipmentForOrder, findRepairItems } from "../lib/equipmentValidator.js";
import {
  AUDIT_OBJECT_TYPES,
  AUDIT_ACTIONS,
  createAuditLogEntry,
  addAuditLog
} from "../lib/audit.js";

export async function listOrders(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const customer = url.searchParams.get("customer");

  let list = [...db.orders];
  if (customer) list = list.filter((o) => (o.customer || "") === customer);
  return sendJson(res, 200, list);
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

  const idSet = new Set(input.itemIds);
  const duplicates = input.itemIds.filter((id, i) => input.itemIds.indexOf(id) !== i);
  if (duplicates.length) {
    return sendJson(res, 409, { error: `设备不可用（重复选择: ${[...new Set(duplicates)].join("、")}）` });
  }

  const validation = validateEquipmentForOrder(db, input.itemIds, input.startDate, input.endDate, null, null);
  if (!validation.valid) {
    const details = {
      repair: validation.repair,
      conflicts: validation.conflicts,
      quoteLocks: validation.quoteLocks,
      missing: validation.missing,
      rented: validation.rented,
      conditionMissing: validation.conditionMissing
    };
    return sendJson(res, 409, {
      error: `设备不可用（${validation.errors.join("；")}）`,
      details
    });
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

  const newStartDate = input.startDate || order.startDate;
  const newEndDate = input.endDate || order.endDate;
  const newItemIds = input.itemIds || order.itemIds;

  if (new Date(newEndDate) < new Date(newStartDate)) {
    return sendJson(res, 400, { error: "结束日期不能早于开始日期" });
  }

  if (input.itemIds?.length === 0) {
    return sendJson(res, 400, { error: "请至少选择一件设备" });
  }

  if (input.itemIds) {
    const duplicates = input.itemIds.filter((id, i) => input.itemIds.indexOf(id) !== i);
    if (duplicates.length) {
      return sendJson(res, 409, { error: `设备不可用（重复选择: ${[...new Set(duplicates)].join("、")}）` });
    }

    const validation = validateEquipmentForOrder(db, input.itemIds, newStartDate, newEndDate, id, null);

    if (!validation.valid) {
      let filteredRented = validation.rented;
      if (["已出库", "待归还"].includes(order.status)) {
        filteredRented = validation.rented.filter((r) => r.orderId !== id);
      }
      const hasRentedIssue = filteredRented.length > 0;

      const hasRepair = validation.repair.length > 0;
      const hasConflict = validation.conflicts.length > 0;
      const hasQuoteLock = validation.quoteLocks.length > 0;
      const hasMissing = validation.missing.length > 0;

      if (hasRepair || hasConflict || hasQuoteLock || hasMissing || hasRentedIssue) {
        const details = {
          repair: validation.repair,
          conflicts: validation.conflicts,
          quoteLocks: validation.quoteLocks,
          missing: validation.missing,
          rented: filteredRented,
          conditionMissing: validation.conditionMissing
        };
        const errorMsgs = [...validation.errors];
        if (!hasRentedIssue && validation.rented.length > 0) {
          const idx = errorMsgs.findIndex((m) => m.startsWith("租赁中设备："));
          if (idx >= 0) errorMsgs.splice(idx, 1);
        }
        return sendJson(res, 409, {
          error: `设备不可用（${errorMsgs.join("；")}）`,
          details
        });
      }
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
    const inputItemIds = input.itemConfirmations.map((c) => c.itemId);
    const inputItemIdSet = new Set(inputItemIds);
    const duplicates = inputItemIds.filter((id, i) => inputItemIds.indexOf(id) !== i);
    const extraIds = inputItemIds.filter((id) => !validItemIds.has(id));
    const missingIds = order.itemIds.filter((id) => !inputItemIdSet.has(id));

    if (duplicates.length) {
      return sendJson(res, 400, { error: `设备重复: ${[...new Set(duplicates)].join("、")}` });
    }
    if (extraIds.length) {
      return sendJson(res, 400, { error: `不在订单中的设备: ${extraIds.join("、")}` });
    }
    if (missingIds.length) {
      return sendJson(res, 400, { error: `遗漏的设备: ${missingIds.join("、")}` });
    }

    const unconfirmed = input.itemConfirmations.filter((c) => !c.confirmed).map((c) => c.itemId);
    if (unconfirmed.length) {
      return sendJson(res, 400, { error: `未确认的设备: ${unconfirmed.join("、")}` });
    }

    const itemMap = new Map(db.equipment.map((e) => [e.id, e]));
    const notAvailable = input.itemConfirmations
      .filter((c) => {
        const eq = itemMap.get(c.itemId);
        return eq && eq.condition !== "available";
      })
      .map((c) => {
        const eq = itemMap.get(c.itemId);
        const statusText = { repair: "维修中", missing: "已缺失", rented: "租赁中", available: "在库" };
        return `${c.itemId}（${statusText[eq?.condition] || eq?.condition || "未知状态"}）`;
      });
    if (notAvailable.length) {
      return sendJson(res, 400, { error: `设备状态不可出库: ${notAvailable.join("、")}` });
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

    const auditEntry = createAuditLogEntry({
      objectType: AUDIT_OBJECT_TYPES.HANDOVER,
      objectId: handover.id,
      action: AUDIT_ACTIONS.CHECKOUT,
      summary: `订单 ${orderId} 出库交接`,
      detail: `经手人: ${input.handler}, 出库时间: ${input.actualTime}, 设备数: ${input.itemConfirmations.length}, 备注: ${input.remarks || "无"}`,
      after: handover,
      operator: input.handler || "user",
      reversible: false,
      extra: { orderId }
    });
    await addAuditLog(db, auditEntry);

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
    const validStatuses = ["intact", "damaged", "missing"];

    const inputItemIds = input.itemStatuses.map((s) => s.itemId);
    const inputItemIdSet = new Set(inputItemIds);
    const duplicates = inputItemIds.filter((id, i) => inputItemIds.indexOf(id) !== i);
    const extraIds = inputItemIds.filter((id) => !validItemIds.has(id));
    const missingIds = order.itemIds.filter((id) => !inputItemIdSet.has(id));
    const invalidStatus = input.itemStatuses.filter((s) => !validStatuses.includes(s.status)).map((s) => s.itemId);

    if (duplicates.length) {
      return sendJson(res, 400, { error: `设备重复: ${[...new Set(duplicates)].join("、")}` });
    }
    if (extraIds.length) {
      return sendJson(res, 400, { error: `不在订单中的设备: ${extraIds.join("、")}` });
    }
    if (missingIds.length) {
      return sendJson(res, 400, { error: `遗漏的设备: ${missingIds.join("、")}` });
    }
    if (invalidStatus.length) {
      return sendJson(res, 400, { error: `状态无效的设备: ${invalidStatus.join("、")}（必须为完好、损坏或缺失）` });
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
            actualRepairCost: 0,
            status: "pending",
            note: `订单 ${order.id} 归还时发现损坏`,
            source: "handover",
            sourceId: handover.id,
            orderId: order.id,
            liability: "customer",
            customerAmount: 0,
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

    const statusSummary = input.itemStatuses.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});
    const statusText = Object.entries(statusSummary).map(([k, v]) => {
      const label = { intact: "完好", damaged: "损坏", missing: "缺失" }[k] || k;
      return `${label}: ${v}`;
    }).join(", ");

    const auditEntry = createAuditLogEntry({
      objectType: AUDIT_OBJECT_TYPES.HANDOVER,
      objectId: handover.id,
      action: AUDIT_ACTIONS.RETURN,
      summary: `订单 ${orderId} 归还交接`,
      detail: `经手人: ${input.handler || "未指定"}, 归还时间: ${input.actualTime}, 设备情况: ${statusText}, 额外费用: ¥${input.extraCharges || 0}, 备注: ${input.remarks || "无"}`,
      after: handover,
      operator: input.handler || "user",
      reversible: false,
      extra: { orderId }
    });
    await addAuditLog(db, auditEntry);

    await saveDb(db);
    return sendJson(res, 201, handover);
  }
}

export async function getHandoverDraft(req, res, orderId, type) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (!type || !["checkout", "return"].includes(type)) {
    return sendJson(res, 400, { error: "交接类型必须为 checkout 或 return" });
  }

  const draft = (db.handoverDrafts || []).find((d) => d.orderId === orderId && d.type === type);
  if (!draft) return sendJson(res, 404, { error: "draft_not_found" });

  return sendJson(res, 200, draft);
}

export async function saveHandoverDraft(req, res, orderId, type) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (!type || !["checkout", "return"].includes(type)) {
    return sendJson(res, 400, { error: "交接类型必须为 checkout 或 return" });
  }

  const input = await parseBody(req);

  let draft = (db.handoverDrafts || []).find((d) => d.orderId === orderId && d.type === type);

  const now = new Date().toISOString();

  if (!draft) {
    draft = {
      id: genHandoverDraftId(),
      orderId,
      type,
      createdAt: now,
      updatedAt: now
    };
    if (!db.handoverDrafts) db.handoverDrafts = [];
    db.handoverDrafts.push(draft);
  }

  draft.updatedAt = now;

  if (type === "checkout") {
    draft.handler = input.handler || "";
    draft.actualTime = input.actualTime || "";
    draft.itemConfirmations = input.itemConfirmations || [];
    draft.remarks = input.remarks || "";
  } else if (type === "return") {
    draft.handler = input.handler || "";
    draft.actualTime = input.actualTime || "";
    draft.itemStatuses = input.itemStatuses || [];
    draft.compensationNote = input.compensationNote || "";
    draft.extraCharges = Number(input.extraCharges) || 0;
    draft.remarks = input.remarks || "";
  }

  await saveDb(db);
  return sendJson(res, 200, draft);
}

export async function deleteHandoverDraft(req, res, orderId, type) {
  const db = await loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return sendJson(res, 404, { error: "order_not_found" });

  if (!type || !["checkout", "return"].includes(type)) {
    return sendJson(res, 400, { error: "交接类型必须为 checkout 或 return" });
  }

  const draftIndex = (db.handoverDrafts || []).findIndex((d) => d.orderId === orderId && d.type === type);
  if (draftIndex === -1) return sendJson(res, 404, { error: "draft_not_found" });

  db.handoverDrafts.splice(draftIndex, 1);
  await saveDb(db);
  return sendJson(res, 200, { success: true });
}
