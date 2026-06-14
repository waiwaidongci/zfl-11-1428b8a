import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { sendJson, sendFile, sendHtml, MIME } from "./lib/http.js";

import {
  listEquipment,
  createEquipment,
  updateEquipment,
  patchCondition,
  deleteEquipment
} from "./routes/equipment.js";

import { listOrders, getOrder, createOrder, updateOrder } from "./routes/orders.js";

import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer
} from "./routes/customers.js";

import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  previewQuote,
  convertToOrder,
  checkConvertibility
} from "./routes/quotations.js";

import {
  listRepairs,
  getRepair,
  createRepair,
  updateRepair,
  advanceRepairStatus,
  deleteRepair,
  getEquipmentRepairs
} from "./routes/repairs.js";

import { getSchedule } from "./routes/schedule.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3011);

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

async function serveStatic(req, res, pathname) {
  try {
    let relPath = pathname === "/" ? "/index.html" : pathname;
    if (relPath !== "/" && !extname(relPath) && !relPath.endsWith("/")) {
      relPath = relPath + ".html";
    }
    const filePath = join(publicDir, relPath);
    if (!filePath.startsWith(publicDir)) return false;
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    const data = await readFile(filePath);
    sendFile(res, data, contentType);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === "GET" && (p === "/" || p === "/equipment" || p === "/customers" || p === "/quotations" || p === "/repairs" || p === "/schedule" || p === "/print" || p.startsWith("/css/") || p.startsWith("/js/"))) {
      const served = await serveStatic(req, res, p);
      if (served) return;
    }

    if (req.method === "GET" && p === "/api/equipment") return listEquipment(req, res);
    if (req.method === "POST" && p === "/api/equipment") return createEquipment(req, res);

    const eqMatch = p.match(/^\/api\/equipment\/([^/]+)$/);
    if (eqMatch) {
      const id = decodeURIComponent(eqMatch[1]);
      if (req.method === "PATCH") return updateEquipment(req, res, id);
      if (req.method === "DELETE") return deleteEquipment(req, res, id);
    }

    const eqCondMatch = p.match(/^\/api\/equipment\/([^/]+)\/condition$/);
    if (eqCondMatch && req.method === "PATCH") {
      return patchCondition(req, res, decodeURIComponent(eqCondMatch[1]));
    }

    if (req.method === "GET" && p === "/api/orders") return listOrders(req, res);
    if (req.method === "POST" && p === "/api/orders") return createOrder(req, res);

    const orderMatch = p.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch) {
      const id = decodeURIComponent(orderMatch[1]);
      if (req.method === "GET") return getOrder(req, res, id);
      if (req.method === "PATCH") return updateOrder(req, res, id);
    }

    if (req.method === "GET" && p === "/api/customers") return listCustomers(req, res);
    if (req.method === "POST" && p === "/api/customers") return createCustomer(req, res);

    const customerMatch = p.match(/^\/api\/customers\/([^/]+)$/);
    if (customerMatch) {
      const id = decodeURIComponent(customerMatch[1]);
      if (req.method === "GET") return getCustomer(req, res, id);
      if (req.method === "PATCH") return updateCustomer(req, res, id);
      if (req.method === "DELETE") return deleteCustomer(req, res, id);
    }

    if (req.method === "GET" && p === "/api/quotations") return listQuotations(req, res);
    if (req.method === "POST" && p === "/api/quotations") return createQuotation(req, res);
    if (req.method === "POST" && p === "/api/quotations/preview") return previewQuote(req, res);

    const quoteMatch = p.match(/^\/api\/quotations\/([^/]+)$/);
    if (quoteMatch) {
      const id = decodeURIComponent(quoteMatch[1]);
      if (req.method === "GET") return getQuotation(req, res, id);
      if (req.method === "PATCH") return updateQuotation(req, res, id);
      if (req.method === "DELETE") return deleteQuotation(req, res, id);
    }

    const quoteConvertMatch = p.match(/^\/api\/quotations\/([^/]+)\/convert$/);
    if (quoteConvertMatch && req.method === "POST") {
      return convertToOrder(req, res, decodeURIComponent(quoteConvertMatch[1]));
    }

    const quoteCheckMatch = p.match(/^\/api\/quotations\/([^/]+)\/check$/);
    if (quoteCheckMatch && req.method === "GET") {
      return checkConvertibility(req, res, decodeURIComponent(quoteCheckMatch[1]));
    }

    if (req.method === "GET" && p === "/api/repairs") return listRepairs(req, res);
    if (req.method === "POST" && p === "/api/repairs") return createRepair(req, res);

    const repairMatch = p.match(/^\/api\/repairs\/([^/]+)$/);
    if (repairMatch) {
      const id = decodeURIComponent(repairMatch[1]);
      if (req.method === "GET") return getRepair(req, res, id);
      if (req.method === "PATCH") return updateRepair(req, res, id);
      if (req.method === "DELETE") return deleteRepair(req, res, id);
    }

    const repairAdvanceMatch = p.match(/^\/api\/repairs\/([^/]+)\/advance$/);
    if (repairAdvanceMatch && req.method === "POST") {
      return advanceRepairStatus(req, res, decodeURIComponent(repairAdvanceMatch[1]));
    }

    const eqRepairsMatch = p.match(/^\/api\/equipment\/([^/]+)\/repairs$/);
    if (eqRepairsMatch && req.method === "GET") {
      return getEquipmentRepairs(req, res, decodeURIComponent(eqRepairsMatch[1]));
    }

    if (req.method === "GET" && p === "/api/schedule") return getSchedule(req, res);

    notFound(res);
  } catch (error) {
    console.error("[server error]", error);
    sendJson(res, 500, { error: error.message || "internal_server_error" });
  }
});

server.listen(port, () => {
  console.log(`Stage light rental app listening on http://localhost:${port}`);
  console.log(`  订单中心:   http://localhost:${port}/`);
  console.log(`  报价管理:   http://localhost:${port}/quotations`);
  console.log(`  设备管理:   http://localhost:${port}/equipment`);
  console.log(`  客户管理:   http://localhost:${port}/customers`);
  console.log(`  维修工单:   http://localhost:${port}/repairs`);
  console.log(`  租期排期:   http://localhost:${port}/schedule`);
});
