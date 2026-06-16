import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync } from "node:fs";
import { setupTestEnv, setupTestEnvSync, cleanupTestEnv, createTestDb, testDbPath } from "./test-helper.js";

setupTestEnvSync();

import { loadDb, saveDb, getDbPath } from "../data/db.js";

describe("db - 数据隔离测试", () => {
  before(async () => {
    await setupTestEnv();
  });

  after(async () => {
    await cleanupTestEnv();
  });

  it("测试环境应使用独立的数据库路径", () => {
    const dbPath = getDbPath();
    assert.ok(dbPath.includes("test"), `数据库路径应包含 test 目录: ${dbPath}`);
    assert.equal(dbPath, testDbPath);
  });

  it("应能正确加载和保存测试数据库", async () => {
    await createTestDb();

    const db = await loadDb();
    assert.ok(Array.isArray(db.equipment));
    assert.ok(Array.isArray(db.orders));
    assert.ok(Array.isArray(db.customers));

    const testEquipment = {
      id: "INTEG-TEST-001",
      name: "集成测试设备",
      category: "灯具",
      spec: "测试规格",
      location: "测试位置",
      condition: "available"
    };

    db.equipment.push(testEquipment);
    await saveDb(db);

    const db2 = await loadDb();
    const found = db2.equipment.find(e => e.id === "INTEG-TEST-001");
    assert.ok(found, "保存的数据应能被重新加载");
    assert.equal(found.name, "集成测试设备");
  });

  it("测试数据库不应影响生产数据库", async () => {
    const { readFile } = await import("node:fs/promises");
    const prodDbPath = testDbPath.replace("/test/", "/").replace(".test.json", ".json");
    if (existsSync(prodDbPath)) {
      const prodContent = await readFile(prodDbPath, "utf8");
      const prodData = JSON.parse(prodContent);
      const testHasTestData = prodData.equipment.some(e => e.id === "INTEG-TEST-001");
      assert.equal(testHasTestData, false, "生产数据不应包含测试数据");
    }
  });
});

describe("db - 数据迁移和默认值", () => {
  before(async () => {
    await setupTestEnv();
  });

  after(async () => {
    await cleanupTestEnv();
  });

  it("缺失的集合应自动初始化为空数组", async () => {
    const minimalData = {
      equipment: [{ id: "E1", name: "测试", category: "灯具", spec: "spec", location: "loc", condition: "available" }],
      orders: [],
      customers: []
    };

    await createTestDb(minimalData);
    const db = await loadDb();

    assert.ok(Array.isArray(db.quotations));
    assert.ok(Array.isArray(db.repairs));
    assert.ok(Array.isArray(db.handovers));
    assert.ok(Array.isArray(db.settlements));
    assert.ok(Array.isArray(db.payments));
    assert.ok(Array.isArray(db.paymentPlans));
    assert.ok(Array.isArray(db.stocktakes));
    assert.ok(Array.isArray(db.handoverDrafts));
    assert.ok(Array.isArray(db.packages));
    assert.ok(Array.isArray(db.auditLogs));
  });

  it("空数据库应自动创建种子数据", async () => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    const db = await loadDb();
    assert.ok(db.equipment.length > 0, "应自动创建设备种子数据");
    assert.ok(db.customers.length > 0, "应自动创建客户种子数据");
  });
});
