import { loadDb } from "../data/db.js";
import { sendJson, parseBody } from "../lib/http.js";
import {
  listAuditLogs,
  getAuditLog,
  revertAuditLog,
  buildAuditPayload
} from "../lib/audit.js";

export async function listAuditLogsApi(req, res) {
  const db = await loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const objectType = url.searchParams.get("objectType");
  const objectId = url.searchParams.get("objectId");
  const action = url.searchParams.get("action");
  const limit = Number(url.searchParams.get("limit")) || 100;

  const logs = await listAuditLogs(db, { objectType, objectId, action, limit });
  return sendJson(res, 200, logs.map(buildAuditPayload));
}

export async function getAuditLogApi(req, res, id) {
  const db = await loadDb();
  const log = await getAuditLog(db, id);
  if (!log) return sendJson(res, 404, { error: "audit_log_not_found" });
  return sendJson(res, 200, buildAuditPayload(log));
}

export async function revertAuditLogApi(req, res, id) {
  const input = await parseBody(req);
  const operator = input.operator || "user";
  const result = await revertAuditLog(id, operator);
  if (!result.success) {
    return sendJson(res, 400, { error: result.error });
  }
  return sendJson(res, 200, { ok: true, message: result.message });
}
