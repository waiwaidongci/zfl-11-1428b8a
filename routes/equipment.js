import { loadDb, saveDb, genEquipmentId } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";

const REQUIRED_FIELDS = ["id", "name", "category", "spec", "location", "condition"];
const FIELD_ALIASES = {
  "设备编号": "id", "编号": "id", "ID": "id", "id": "id",
  "设备名称": "name", "名称": "name", "name": "name",
  "设备类别": "category", "类别": "category", "category": "category",
  "规格参数": "spec", "规格": "spec", "spec": "spec",
  "存放位置": "location", "库位": "location", "位置": "location", "location": "location",
  "设备状态": "condition", "状态": "condition", "condition": "condition"
};
const VALID_CONDITIONS = ["available", "repair", "在库可用", "维修中"];
const CONDITION_MAP = {
  "在库可用": "available", "可用": "available", "正常": "available", "available": "available",
  "维修中": "repair", "维修": "repair", "repair": "repair"
};

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]).map((h) => {
    const key = h.trim();
    return FIELD_ALIASES[key] || key;
  });

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] !== undefined ? values[i].trim() : "";
    });
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function normalizeRecord(raw) {
  const record = {};
  for (const [key, value] of Object.entries(raw)) {
    const mappedKey = FIELD_ALIASES[key] || key;
    record[mappedKey] = typeof value === "string" ? value.trim() : value;
  }
  if (record.condition) {
    record.condition = CONDITION_MAP[record.condition] || (VALID_CONDITIONS.includes(record.condition) ? record.condition : "available");
  } else {
    record.condition = "available";
  }
  if (!record.location) record.location = "未指定";
  if (!record.spec) record.spec = "";
  return record;
}

function validateRecords(records, existingIds) {
  const seenIds = new Set();
  const valid = [];
  const duplicates = [];
  const missing = [];

  records.forEach((raw, index) => {
    const record = normalizeRecord(raw);
    const rowNum = index + 2;

    const missingFields = [];
    if (!record.id) missingFields.push("id(设备编号)");
    if (!record.name) missingFields.push("name(设备名称)");
    if (!record.category) missingFields.push("category(设备类别)");

    if (missingFields.length > 0) {
      missing.push({ row: rowNum, record, fields: missingFields });
      return;
    }

    const isDuplicateInDb = existingIds.has(record.id);
    const isDuplicateInFile = seenIds.has(record.id);
    if (isDuplicateInDb || isDuplicateInFile) {
      duplicates.push({
        row: rowNum,
        record,
        reason: isDuplicateInDb ? "编号已存在于数据库" : "编号在导入文件中重复"
      });
      return;
    }

    seenIds.add(record.id);
    valid.push({ row: rowNum, record });
  });

  return { valid, duplicates, missing };
}

function toCSV(records) {
  const headers = ["设备编号", "设备名称", "设备类别", "规格参数", "存放位置", "设备状态"];
  const keyMap = { id: "设备编号", name: "设备名称", category: "设备类别", spec: "规格参数", location: "存放位置", condition: "设备状态" };
  const conditionLabel = { available: "在库可用", repair: "维修中" };

  const escape = (v) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [headers.join(",")];
  records.forEach((r) => {
    lines.push([
      escape(r.id),
      escape(r.name),
      escape(r.category),
      escape(r.spec),
      escape(r.location),
      escape(conditionLabel[r.condition] || r.condition)
    ].join(","));
  });
  return lines.join("\n");
}

export async function listEquipment(req, res) {
  const db = await loadDb();
  return sendJson(res, 200, db.equipment);
}

export async function createEquipment(req, res) {
  const db = await loadDb();
  const input = await parseBody(req);

  if (!input.name || !input.category) {
    return sendJson(res, 400, { error: "设备名称和类别必填" });
  }

  const id = input.id?.trim() || genEquipmentId(input.category);
  if (db.equipment.some((e) => e.id === id)) {
    return sendJson(res, 409, { error: `设备编号 ${id} 已存在` });
  }

  const equipment = {
    id,
    name: input.name.trim(),
    category: input.category.trim(),
    spec: input.spec?.trim() || "",
    location: input.location?.trim() || "未指定",
    condition: input.condition === "repair" ? "repair" : "available"
  };

  db.equipment.unshift(equipment);
  await saveDb(db);
  return sendJson(res, 201, equipment);
}

export async function updateEquipment(req, res, id) {
  const db = await loadDb();
  const idx = db.equipment.findIndex((e) => e.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "equipment_not_found" });

  const input = await parseBody(req);
  const current = db.equipment[idx];

  if (input.name !== undefined) input.name = input.name.trim();
  if (input.category !== undefined) input.category = input.category.trim();
  if (input.spec !== undefined) input.spec = input.spec.trim();
  if (input.location !== undefined) input.location = input.location.trim();
  if (input.condition !== undefined) {
    input.condition = input.condition === "repair" ? "repair" : "available";
  }

  db.equipment[idx] = { ...current, ...input };
  await saveDb(db);
  return sendJson(res, 200, db.equipment[idx]);
}

export async function patchCondition(req, res, id) {
  const db = await loadDb();
  const equipment = db.equipment.find((e) => e.id === id);
  if (!equipment) return sendJson(res, 404, { error: "equipment_not_found" });

  const input = await parseBody(req);
  equipment.condition = input.condition === "repair" ? "repair" : "available";
  await saveDb(db);
  return sendJson(res, 200, equipment);
}

export async function deleteEquipment(req, res, id) {
  const db = await loadDb();
  const idx = db.equipment.findIndex((e) => e.id === id);
  if (idx === -1) return sendJson(res, 404, { error: "equipment_not_found" });

  const usedInOrder = db.orders.some(
    (o) => !["已取消", "已归还"].includes(o.status) && o.itemIds.includes(id)
  );
  if (usedInOrder) {
    return sendJson(res, 409, { error: "该设备存在进行中的订单，无法删除" });
  }

  db.equipment.splice(idx, 1);
  await saveDb(db);
  return sendJson(res, 200, { ok: true });
}

async function parseMultipartBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, boundary) {
  const body = buffer.toString("utf8");
  const parts = body.split(`--${boundary}`);
  const result = {};

  for (const part of parts) {
    if (!part.trim() || part.trim() === "--") continue;

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd);
    const content = part.slice(headerEnd + 4).replace(/\r\n$/, "");

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);

    if (nameMatch) {
      const name = nameMatch[1];
      if (filenameMatch) {
        result[name] = {
          filename: filenameMatch[1],
          content: content
        };
      } else {
        result[name] = content;
      }
    }
  }
  return result;
}

export async function previewImport(req, res) {
  const db = await loadDb();
  const existingIds = new Set(db.equipment.map((e) => e.id));

  const contentType = req.headers["content-type"] || "";
  let records = [];

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return sendJson(res, 400, { error: "无效的multipart请求" });
    }
    const buffer = await parseMultipartBody(req);
    const parts = parseMultipart(buffer, boundaryMatch[1]);
    const file = parts.file || parts.importFile;
    if (!file) {
      return sendJson(res, 400, { error: "未找到上传文件" });
    }

    const filename = file.filename.toLowerCase();
    const content = file.content;

    if (filename.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        records = Array.isArray(parsed) ? parsed : (parsed.equipment || []);
      } catch (e) {
        return sendJson(res, 400, { error: "JSON文件解析失败：" + e.message });
      }
    } else if (filename.endsWith(".csv")) {
      records = parseCSV(content);
    } else {
      return sendJson(res, 400, { error: "不支持的文件格式，仅支持 .csv 和 .json" });
    }
  } else {
    const input = await parseBody(req);
    records = input.records || [];
  }

  if (!records.length) {
    return sendJson(res, 400, { error: "未解析到任何设备记录" });
  }

  const { valid, duplicates, missing } = validateRecords(records, existingIds);
  return sendJson(res, 200, {
    total: records.length,
    validCount: valid.length,
    duplicateCount: duplicates.length,
    missingCount: missing.length,
    valid,
    duplicates,
    missing
  });
}

export async function confirmImport(req, res) {
  const db = await loadDb();
  const existingIds = new Set(db.equipment.map((e) => e.id));

  const contentType = req.headers["content-type"] || "";
  let records = [];

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return sendJson(res, 400, { error: "无效的multipart请求" });
    }
    const buffer = await parseMultipartBody(req);
    const parts = parseMultipart(buffer, boundaryMatch[1]);
    const file = parts.file || parts.importFile;
    if (!file) {
      return sendJson(res, 400, { error: "未找到上传文件" });
    }

    const filename = file.filename.toLowerCase();
    const content = file.content;

    if (filename.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        records = Array.isArray(parsed) ? parsed : (parsed.equipment || []);
      } catch (e) {
        return sendJson(res, 400, { error: "JSON文件解析失败：" + e.message });
      }
    } else if (filename.endsWith(".csv")) {
      records = parseCSV(content);
    } else {
      return sendJson(res, 400, { error: "不支持的文件格式，仅支持 .csv 和 .json" });
    }
  } else {
    const input = await parseBody(req);
    records = input.records || [];
  }

  const { valid, duplicates, missing } = validateRecords(records, existingIds);

  if (valid.length === 0) {
    return sendJson(res, 400, {
      error: "没有可导入的有效记录",
      duplicateCount: duplicates.length,
      missingCount: missing.length
    });
  }

  const inserted = [];
  valid.forEach(({ record }) => {
    const equipment = {
      id: record.id,
      name: record.name,
      category: record.category,
      spec: record.spec || "",
      location: record.location || "未指定",
      condition: record.condition === "repair" ? "repair" : "available"
    };
    db.equipment.unshift(equipment);
    inserted.push(equipment);
  });

  await saveDb(db);
  return sendJson(res, 200, {
    inserted: inserted.length,
    insertedRecords: inserted,
    duplicateCount: duplicates.length,
    missingCount: missing.length,
    duplicates,
    missing
  });
}

export async function exportEquipment(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);

  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const category = url.searchParams.get("category") || "";
  const condition = url.searchParams.get("condition") || "";
  const format = (url.searchParams.get("format") || "csv").toLowerCase();

  let data = db.equipment.filter((e) => {
    if (category && e.category !== category) return false;
    if (condition && e.condition !== condition) return false;
    if (search) {
      const hay = `${e.id} ${e.name} ${e.spec} ${e.location} ${e.category}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  if (format === "json") {
    const jsonStr = JSON.stringify({ equipment: data }, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="equipment_${dateStr}.json"`
    });
    res.end(jsonStr);
  } else {
    const csvStr = toCSV(data);
    const bom = "\uFEFF";
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="equipment_${dateStr}.csv"`
    });
    res.end(bom + csvStr);
  }
}
