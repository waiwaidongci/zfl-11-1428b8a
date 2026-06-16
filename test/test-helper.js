import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const testDataDir = join(projectRoot, "data", "test");

export const testDbPath = join(testDataDir, "rental.test.json");

export function setupTestEnvSync() {
  process.env.NODE_ENV = "test";
  process.env.RENTAL_DB_PATH = testDbPath;

  return {
    dbPath: testDbPath,
    dataDir: testDataDir
  };
}

export async function setupTestEnv() {
  const result = setupTestEnvSync();
  await mkdir(testDataDir, { recursive: true });
  return result;
}

export async function cleanupTestEnv() {
  try {
    await rm(testDataDir, { recursive: true, force: true });
  } catch {
  }
}

export async function createTestDb(seedData) {
  const defaultSeed = {
    equipment: [
      { id: "L-001", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" },
      { id: "L-002", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓B", condition: "available" },
      { id: "C-001", name: "MA控台", category: "控台", spec: "Command Wing", location: "控台柜", condition: "available" }
    ],
    orders: [
      { id: "O-1001", customer: "测试客户", startDate: "2026-06-18", endDate: "2026-06-20", status: "待出库", itemIds: ["L-001"], note: "测试订单" }
    ],
    customers: [
      { id: "CU-001", name: "测试客户", contact: "测试联系人", phone: "13800138000", activityType: "发布会", note: "测试客户" }
    ],
    quotations: [],
    handovers: [],
    handoverDrafts: [],
    repairs: [],
    settlements: [],
    payments: [],
    paymentPlans: [],
    stocktakes: [],
    packages: [],
    auditLogs: []
  };

  const data = seedData || defaultSeed;
  await mkdir(dirname(testDbPath), { recursive: true });
  await writeFile(testDbPath, JSON.stringify(data, null, 2));

  return { dbPath: testDbPath, data };
}

export function buildMockDb(overrides = {}) {
  return {
    equipment: overrides.equipment || [],
    orders: overrides.orders || [],
    quotations: overrides.quotations || [],
    repairs: overrides.repairs || [],
    customers: overrides.customers || [],
    settlements: overrides.settlements || [],
    payments: overrides.payments || [],
    stocktakes: overrides.stocktakes || [],
    packages: overrides.packages || [],
    auditLogs: overrides.auditLogs || []
  };
}
