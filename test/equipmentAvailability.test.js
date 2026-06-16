import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkEquipmentAvailability,
  CONFLICT_TYPES,
  validateForOrder,
  validateForQuotation
} from "../lib/equipmentAvailability.js";

function buildMockDb(overrides = {}) {
  return {
    equipment: overrides.equipment || [],
    orders: overrides.orders || [],
    quotations: overrides.quotations || [],
    repairs: overrides.repairs || [],
    customers: overrides.customers || []
  };
}

describe("equipmentAvailability - 缺失设备 MISSING", () => {
  it("状态为 missing 的设备应返回缺失冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓", condition: "missing" }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"]
    });

    assert.equal(result.available, false);
    assert.equal(result.conflictCount, 1);
    assert.equal(result.byType.missing.length, 1);
    assert.equal(result.byType.missing[0].type, CONFLICT_TYPES.MISSING);
    assert.equal(result.byType.missing[0].equipmentId, "E1");
    assert.equal(result.byType.missing[0].reason, "设备已标记为缺失");
  });

  it("状态为 available 的设备不应返回缺失冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓", condition: "available" }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"]
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.missing.length, 0);
  });

  it("多设备中部分缺失应正确识别", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓", condition: "missing" },
        { id: "E2", name: "MA控台", category: "控台", spec: "Command Wing", location: "控台柜", condition: "available" }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1", "E2"]
    });

    assert.equal(result.available, false);
    assert.equal(result.byType.missing.length, 1);
    assert.equal(result.byType.missing[0].equipmentId, "E1");
  });
});

describe("equipmentAvailability - 维修中 REPAIR", () => {
  it("状态为 repair 且有活跃维修单的设备应返回维修冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "repair" }
      ],
      repairs: [
        {
          id: "R1",
          equipmentId: "E1",
          equipmentName: "铝合金桁架",
          faultDescription: "桁架接口变形",
          status: "repairing",
          expectedReturn: "2026-06-20"
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"]
    });

    assert.equal(result.available, false);
    assert.equal(result.byType.repair.length, 1);
    assert.equal(result.byType.repair[0].type, CONFLICT_TYPES.REPAIR);
    assert.equal(result.byType.repair[0].equipmentId, "E1");
    assert.equal(result.byType.repair[0].repairId, "R1");
    assert.equal(result.byType.repair[0].repairStatus, "repairing");
  });

  it("状态为 repair 但无活跃维修单的设备默认也应返回维修冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "repair" }
      ],
      repairs: []
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"]
    });

    assert.equal(result.available, false);
    assert.equal(result.byType.repair.length, 1);
    assert.equal(result.byType.repair[0].reason, "设备状态为维修中");
  });

  it("维修单已完成的设备不应返回维修冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "available" }
      ],
      repairs: [
        {
          id: "R1",
          equipmentId: "E1",
          equipmentName: "铝合金桁架",
          faultDescription: "桁架接口变形",
          status: "completed",
          expectedReturn: "2026-06-20"
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"]
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.repair.length, 0);
  });
});

describe("equipmentAvailability - 订单租期冲突 ORDER_RENTAL", () => {
  it("完全重叠的租期应返回冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, false);
    assert.equal(result.byType.order_rental.length, 1);
    assert.equal(result.byType.order_rental[0].type, CONFLICT_TYPES.ORDER_RENTAL);
    assert.equal(result.byType.order_rental[0].orderId, "O1");
    assert.equal(result.byType.order_rental[0].conflictRange, "2026-06-18 ~ 2026-06-20");
  });

  it("部分重叠的租期应返回冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-19",
      endDate: "2026-06-21"
    });

    assert.equal(result.available, false);
    assert.equal(result.byType.order_rental.length, 1);
  });

  it("刚好衔接的租期不应返回冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-21",
      endDate: "2026-06-23"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.order_rental.length, 0);
  });

  it("已取消的订单不应产生租期冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已取消",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.order_rental.length, 0);
  });

  it("排除当前订单时应忽略自身租期", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      exceptOrderId: "O1"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.order_rental.length, 0);
  });

  it("不提供起止日期时不检查租期冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"]
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.order_rental.length, 0);
  });
});

describe("equipmentAvailability - 报价锁定冲突 QUOTE_LOCK", () => {
  it("锁定中的报价且租期重叠应返回冲突", () => {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    const lockEndAt = future.toISOString();

    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      quotations: [
        {
          id: "Q1",
          customer: "光影传媒",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已确认",
          itemIds: ["E1"],
          lockStartAt: new Date().toISOString(),
          lockEndAt: lockEndAt,
          lockedBy: "测试员"
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, false);
    assert.equal(result.byType.quote_lock.length, 1);
    assert.equal(result.byType.quote_lock[0].type, CONFLICT_TYPES.QUOTE_LOCK);
    assert.equal(result.byType.quote_lock[0].quoteId, "Q1");
    assert.equal(result.byType.quote_lock[0].lockedBy, "测试员");
  });

  it("已过期的报价锁定不应返回冲突", () => {
    const past = new Date();
    past.setHours(past.getHours() - 24);
    const lockEndAt = past.toISOString();

    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      quotations: [
        {
          id: "Q1",
          customer: "光影传媒",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已确认",
          itemIds: ["E1"],
          lockStartAt: past.toISOString(),
          lockEndAt: lockEndAt,
          lockedBy: "测试员"
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.quote_lock.length, 0);
  });

  it("已转订单的报价不应返回锁定冲突", () => {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    const lockEndAt = future.toISOString();

    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      quotations: [
        {
          id: "Q1",
          customer: "光影传媒",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已转订单",
          itemIds: ["E1"],
          lockStartAt: new Date().toISOString(),
          lockEndAt: lockEndAt,
          lockedBy: "测试员"
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.quote_lock.length, 0);
  });

  it("排除当前报价时应忽略自身锁定", () => {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    const lockEndAt = future.toISOString();

    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      quotations: [
        {
          id: "Q1",
          customer: "光影传媒",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已确认",
          itemIds: ["E1"],
          lockStartAt: new Date().toISOString(),
          lockEndAt: lockEndAt,
          lockedBy: "测试员"
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-18",
      endDate: "2026-06-20",
      exceptQuoteId: "Q1"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.quote_lock.length, 0);
  });

  it("未锁定的报价不应返回冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      quotations: [
        {
          id: "Q1",
          customer: "光影传媒",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已确认",
          itemIds: ["E1"]
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, true);
    assert.equal(result.byType.quote_lock.length, 0);
  });
});

describe("equipmentAvailability - validateForOrder", () => {
  it("空设备列表应返回无效", () => {
    const db = buildMockDb();
    const result = validateForOrder(db, [], "2026-06-16", "2026-06-18");
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["请至少选择一件设备"]);
  });

  it("设备缺失应返回无效并包含缺失信息", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓", condition: "missing" }
      ]
    });

    const result = validateForOrder(db, ["E1"], "2026-06-16", "2026-06-18");
    assert.equal(result.valid, false);
    assert.equal(result.missing.length, 1);
    assert.equal(result.conditionMissing.length, 1);
  });

  it("设备维修中应返回无效并包含维修信息", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "repair" }
      ],
      repairs: [
        { id: "R1", equipmentId: "E1", status: "repairing" }
      ]
    });

    const result = validateForOrder(db, ["E1"], "2026-06-16", "2026-06-18");
    assert.equal(result.valid, false);
    assert.equal(result.repair.length, 1);
    assert.equal(result.repair[0].id, "E1");
  });

  it("租期冲突应返回无效并包含冲突信息", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = validateForOrder(db, ["E1"], "2026-06-17", "2026-06-19");
    assert.equal(result.valid, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].conflictOrderId, "O1");
  });
});

describe("equipmentAvailability - validateForQuotation", () => {
  it("空设备列表应返回无效", () => {
    const db = buildMockDb();
    const result = validateForQuotation(db, [], "2026-06-16", "2026-06-18");
    assert.equal(result.valid, false);
  });

  it("报价验证不检查租赁中状态", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "rented" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-10",
          endDate: "2026-06-15",
          status: "已出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = validateForQuotation(db, ["E1"], "2026-06-16", "2026-06-18");
    assert.equal(result.valid, true);
    assert.equal(result.rented.length, 0);
  });

  it("报价验证检查租期冲突", () => {
    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E1"]
        }
      ]
    });

    const result = validateForQuotation(db, ["E1"], "2026-06-17", "2026-06-19");
    assert.equal(result.valid, false);
    assert.equal(result.conflicts.length, 1);
  });
});

describe("equipmentAvailability - 多冲突场景", () => {
  it("同时存在多种冲突应全部返回", () => {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    const lockEndAt = future.toISOString();

    const db = buildMockDb({
      equipment: [
        { id: "E1", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓", condition: "missing" },
        { id: "E2", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "repair" },
        { id: "E3", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" }
      ],
      orders: [
        {
          id: "O1",
          customer: "星桥活动",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "待出库",
          itemIds: ["E3"]
        }
      ],
      repairs: [
        { id: "R1", equipmentId: "E2", status: "repairing" }
      ],
      quotations: [
        {
          id: "Q1",
          customer: "光影传媒",
          startDate: "2026-06-18",
          endDate: "2026-06-20",
          status: "已确认",
          itemIds: ["E3"],
          lockStartAt: new Date().toISOString(),
          lockEndAt: lockEndAt
        }
      ]
    });

    const result = checkEquipmentAvailability(db, {
      itemIds: ["E1", "E2", "E3"],
      startDate: "2026-06-17",
      endDate: "2026-06-19"
    });

    assert.equal(result.available, false);
    assert.equal(result.conflictCount, 4);
    assert.equal(result.byType.missing.length, 1);
    assert.equal(result.byType.repair.length, 1);
    assert.equal(result.byType.order_rental.length, 1);
    assert.equal(result.byType.quote_lock.length, 1);
  });
});
