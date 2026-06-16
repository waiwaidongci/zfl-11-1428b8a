import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcRentalDays,
  calcItemDailyPrice,
  calcTotalDeposit,
  applyDiscount,
  buildQuoteSummary,
  CATEGORY_DAILY_RATES,
  CATEGORY_DEPOSIT_RATES
} from "../lib/quoteCalculator.js";

describe("quoteCalculator - 租期天数 calcRentalDays", () => {
  it("相同日期应返回 1 天", () => {
    assert.equal(calcRentalDays("2026-06-16", "2026-06-16"), 1);
  });

  it("跨天应正确计算", () => {
    assert.equal(calcRentalDays("2026-06-16", "2026-06-18"), 3);
  });

  it("结束日期早于开始日期应返回 0", () => {
    assert.equal(calcRentalDays("2026-06-18", "2026-06-16"), 0);
  });

  it("跨月应正确计算", () => {
    assert.equal(calcRentalDays("2026-06-30", "2026-07-02"), 3);
  });

  it("闰年 2 月应正确计算", () => {
    assert.equal(calcRentalDays("2024-02-28", "2024-03-01"), 3);
  });
});

describe("quoteCalculator - 分类租金 calcItemDailyPrice", () => {
  it("灯具类日租金应为 120", () => {
    assert.equal(calcItemDailyPrice("灯具"), CATEGORY_DAILY_RATES.灯具);
  });

  it("控台类日租金应为 300", () => {
    assert.equal(calcItemDailyPrice("控台"), CATEGORY_DAILY_RATES.控台);
  });

  it("桁架类日租金应为 60", () => {
    assert.equal(calcItemDailyPrice("桁架"), CATEGORY_DAILY_RATES.桁架);
  });

  it("线缆类日租金应为 20", () => {
    assert.equal(calcItemDailyPrice("线缆"), CATEGORY_DAILY_RATES.线缆);
  });

  it("未知分类应使用其他类租金 50", () => {
    assert.equal(calcItemDailyPrice("不存在的分类"), CATEGORY_DAILY_RATES.其他);
  });
});

describe("quoteCalculator - 押金覆盖 calcTotalDeposit", () => {
  const mockEquipment = [
    { id: "E1", name: "设备1", category: "灯具", spec: "spec1" },
    { id: "E2", name: "设备2", category: "控台", spec: "spec2" },
    { id: "E3", name: "设备3", category: "桁架", spec: "spec3" }
  ];
  const equipmentMap = new Map(mockEquipment.map((e) => [e.id, e]));

  it("单设备押金应正确计算", () => {
    const result = calcTotalDeposit(equipmentMap, ["E1"]);
    assert.equal(result, CATEGORY_DEPOSIT_RATES.灯具);
  });

  it("多设备押金应累加", () => {
    const result = calcTotalDeposit(equipmentMap, ["E1", "E2", "E3"]);
    const expected = CATEGORY_DEPOSIT_RATES.灯具 + CATEGORY_DEPOSIT_RATES.控台 + CATEGORY_DEPOSIT_RATES.桁架;
    assert.equal(result, expected);
  });

  it("支持单设备押金覆盖", () => {
    const override = { E1: { deposit: 1000 } };
    const result = calcTotalDeposit(equipmentMap, ["E1", "E2"], override);
    const expected = 1000 + CATEGORY_DEPOSIT_RATES.控台;
    assert.equal(result, expected);
  });

  it("支持多设备押金覆盖", () => {
    const override = {
      E1: { deposit: 1000 },
      E2: { deposit: 3000 }
    };
    const result = calcTotalDeposit(equipmentMap, ["E1", "E2", "E3"], override);
    const expected = 1000 + 3000 + CATEGORY_DEPOSIT_RATES.桁架;
    assert.equal(result, expected);
  });

  it("不存在的设备 ID 应忽略", () => {
    const result = calcTotalDeposit(equipmentMap, ["E1", "NON_EXIST"]);
    assert.equal(result, CATEGORY_DEPOSIT_RATES.灯具);
  });

  it("空设备列表应返回 0", () => {
    const result = calcTotalDeposit(equipmentMap, []);
    assert.equal(result, 0);
  });
});

describe("quoteCalculator - 折扣金额 applyDiscount", () => {
  it("无折扣应返回原价", () => {
    assert.equal(applyDiscount(1000, 0), 1000);
  });

  it("百分比折扣（<=1）应按比例计算", () => {
    assert.equal(applyDiscount(1000, 0.1), 900);
  });

  it("八折应返回 800", () => {
    assert.equal(applyDiscount(1000, 0.2), 800);
  });

  it("固定金额折扣（>1）应直接扣减", () => {
    assert.equal(applyDiscount(1000, 100), 900);
  });

  it("折扣后不应为负数", () => {
    assert.equal(applyDiscount(100, 200), 0);
  });

  it("负折扣应忽略并返回原价", () => {
    assert.equal(applyDiscount(1000, -0.1), 1000);
  });

  it("无效折扣值应返回原价", () => {
    assert.equal(applyDiscount(1000, "invalid"), 1000);
  });

  it("结果应保留两位小数", () => {
    assert.equal(applyDiscount(100, 0.3333), 66.67);
  });
});

describe("quoteCalculator - 完整报价 buildQuoteSummary", () => {
  const mockEquipment = [
    { id: "E1", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼" },
    { id: "E2", name: "MA控台", category: "控台", spec: "Command Wing" },
    { id: "E3", name: "铝合金桁架", category: "桁架", spec: "300mm 2m" }
  ];

  it("完整报价应包含所有字段", () => {
    const result = buildQuoteSummary(
      mockEquipment,
      ["E1", "E2"],
      "2026-06-16",
      "2026-06-18"
    );

    assert.equal(result.rentalDays, 3);
    assert.equal(result.subtotal, (120 + 300) * 3);
    assert.equal(result.discountAmount, 0);
    assert.equal(result.discounted, result.subtotal);
    assert.equal(result.totalDeposit, 500 + 2000);
    assert.equal(result.grandTotal, result.discounted + result.totalDeposit);
    assert.equal(result.itemBreakdown.length, 2);
  });

  it("带折扣的完整报价应正确计算", () => {
    const result = buildQuoteSummary(
      mockEquipment,
      ["E1", "E2"],
      "2026-06-16",
      "2026-06-18",
      {},
      0.1
    );

    const subtotal = (120 + 300) * 3;
    const discounted = subtotal * 0.9;
    assert.equal(result.subtotal, subtotal);
    assert.equal(result.discountAmount, Math.round((subtotal - discounted) * 100) / 100);
    assert.equal(result.discounted, Math.round(discounted * 100) / 100);
  });

  it("带押金覆盖的完整报价应正确计算", () => {
    const depositOverride = { E1: { deposit: 800 } };
    const result = buildQuoteSummary(
      mockEquipment,
      ["E1", "E2"],
      "2026-06-16",
      "2026-06-18",
      depositOverride
    );

    assert.equal(result.totalDeposit, 800 + 2000);
    assert.equal(result.itemBreakdown[0].deposit, 800);
    assert.equal(result.itemBreakdown[1].deposit, 2000);
  });

  it("itemBreakdown 应包含正确的明细", () => {
    const result = buildQuoteSummary(
      mockEquipment,
      ["E1"],
      "2026-06-16",
      "2026-06-16"
    );

    assert.equal(result.itemBreakdown[0].id, "E1");
    assert.equal(result.itemBreakdown[0].name, "摇头染色灯");
    assert.equal(result.itemBreakdown[0].category, "灯具");
    assert.equal(result.itemBreakdown[0].spec, "19颗蜂眼");
    assert.equal(result.itemBreakdown[0].daily, 120);
    assert.equal(result.itemBreakdown[0].subtotal, 120 * 1);
    assert.equal(result.itemBreakdown[0].deposit, 500);
  });

  it("不存在的设备 ID 应被过滤", () => {
    const result = buildQuoteSummary(
      mockEquipment,
      ["E1", "NON_EXIST"],
      "2026-06-16",
      "2026-06-16"
    );

    assert.equal(result.itemBreakdown.length, 1);
    assert.equal(result.itemBreakdown[0].id, "E1");
  });
});
