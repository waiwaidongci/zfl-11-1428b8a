import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "rental.json");

const seed = {
  equipment: [
    { id: "L-001", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" },
    { id: "L-002", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓B", condition: "available" },
    { id: "C-001", name: "MA控台", category: "控台", spec: "Command Wing", location: "控台柜", condition: "available" },
    { id: "T-001", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "repair" }
  ],
  orders: [
    { id: "O-1001", customer: "星桥活动", startDate: "2026-06-18", endDate: "2026-06-20", status: "待出库", itemIds: ["L-001", "C-001"], note: "发布会" }
  ],
  customers: [
    { id: "CU-001", name: "星桥活动", contact: "张经理", phone: "13800138001", activityType: "发布会", note: "长期合作客户" },
    { id: "CU-002", name: "光影传媒", contact: "李总监", phone: "13900139002", activityType: "演唱会", note: "" }
  ],
  quotations: []
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!db.customers) db.customers = [];
  if (!db.quotations) db.quotations = [];
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
}

export function occupiedItems(db, startDate, endDate, exceptOrderId) {
  return new Set(
    db.orders
      .filter((order) => order.id !== exceptOrderId && !["已取消", "已归还"].includes(order.status) && overlaps(startDate, endDate, order.startDate, order.endDate))
      .flatMap((order) => order.itemIds)
  );
}

export function genEquipmentId(category) {
  const prefixMap = { 灯具: "L", 控台: "C", 桁架: "T", 线缆: "W", 其他: "E" };
  const prefix = prefixMap[category] || "E";
  return `${prefix}-${Date.now().toString().slice(-6)}`;
}

export function genCustomerId() {
  return `CU-${Date.now().toString().slice(-6)}`;
}

export function genQuotationId() {
  return `Q-${Date.now().toString().slice(-6)}`;
}
