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
  quotations: [],
  handovers: [],
  repairs: [
    {
      id: "R-000001",
      equipmentId: "T-001",
      equipmentName: "铝合金桁架",
      faultDescription: "桁架接口变形，焊接处有开裂",
      sendTime: "2026-06-10",
      expectedReturn: "2026-06-20",
      repairCost: 350,
      status: "repairing",
      note: "已送合作焊接厂维修",
      createdAt: "2026-06-10T09:30:00.000Z",
      updatedAt: "2026-06-10T09:30:00.000Z",
      completedAt: null
    }
  ]
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!db.customers) db.customers = [];
  if (!db.quotations) db.quotations = [];
  if (!db.repairs) db.repairs = [];
  if (!db.handovers) db.handovers = [];

  db.quotations = db.quotations.map((q) => {
    if (!q.versions || !Array.isArray(q.versions)) {
      const initialVersion = {
        versionId: `V-${(q.createdAt ? new Date(q.createdAt).getTime() : Date.now()).toString().slice(-6)}`,
        versionNumber: 1,
        createdAt: q.createdAt || new Date().toISOString(),
        createdBy: "system",
        snapshot: {
          customer: q.customer,
          startDate: q.startDate,
          endDate: q.endDate,
          rentalDays: q.rentalDays,
          itemIds: q.itemIds ? [...q.itemIds] : [],
          discount: q.discount,
          depositOverride: q.depositOverride ? { ...q.depositOverride } : {},
          note: q.note
        },
        approvalStatus: q.status === "已确认" || q.status === "已转订单" ? "approved" : "pending",
        approvedAt: (q.status === "已确认" || q.status === "已转订单") ? (q.updatedAt || q.createdAt) : null,
        approvedBy: (q.status === "已确认" || q.status === "已转订单") ? "system" : null,
        approvalNote: "",
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: ""
      };
      q.versions = [initialVersion];
      q.currentVersionId = initialVersion.versionId;
      q.approvedVersionId = (q.status === "已确认" || q.status === "已转订单") ? initialVersion.versionId : null;
    }
    return q;
  });

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

export function genRepairId() {
  return `R-${Date.now().toString().slice(-6)}`;
}

export function genHandoverId() {
  return `H-${Date.now().toString().slice(-6)}`;
}

export function genVersionId() {
  return `V-${Date.now().toString().slice(-6)}`;
}

export const VERSION_APPROVAL_STATUSES = ["pending", "approved", "rejected"];
export const VERSION_APPROVAL_LABELS = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回"
};

export const QUOTE_KEY_FIELDS = [
  "customer",
  "startDate",
  "endDate",
  "itemIds",
  "discount",
  "depositOverride",
  "note"
];

export function hasKeyFieldChanged(oldData, newData) {
  for (const field of QUOTE_KEY_FIELDS) {
    const oldVal = oldData[field];
    const newVal = newData[field];
    if (field === "itemIds") {
      const oldArr = Array.isArray(oldVal) ? [...oldVal].sort() : [];
      const newArr = Array.isArray(newVal) ? [...newVal].sort() : [];
      if (oldArr.length !== newArr.length) return true;
      if (oldArr.some((v, i) => v !== newArr[i])) return true;
    } else if (field === "depositOverride") {
      const oldStr = JSON.stringify(oldVal || {});
      const newStr = JSON.stringify(newVal || {});
      if (oldStr !== newStr) return true;
    } else {
      if (oldVal !== newVal) return true;
    }
  }
  return false;
}

export const REPAIR_STATUSES = ["pending", "repairing", "completed", "cancelled"];
export const REPAIR_STATUS_LABELS = {
  pending: "待送修",
  repairing: "维修中",
  completed: "维修完成",
  cancelled: "已取消"
};

export function getActiveRepairByEquipmentId(db, equipmentId) {
  return db.repairs.find(
    (r) => r.equipmentId === equipmentId && ["pending", "repairing"].includes(r.status)
  );
}
