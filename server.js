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

import { listOrders, getOrder, createOrder, updateOrder, listHandovers, createHandover, getHandover } from "./routes/orders.js";

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
  checkConvertibility,
  listVersions,
  getVersion,
  createVersion,
  approveVersion,
  rejectVersion,
  restoreVersion,
  compareVersions
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

import {
  listSettlements,
  getSettlement,
  updateSettlement,
  addFee,
  updateFee,
  deleteFee,
  syncQuoteFees,
  syncHandoverFees,
  addPayment,
  updatePayment,
  deletePayment
} from "./routes/settlements.js";

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

    if (req.method === "GET" && (p === "/" || p === "/equipment" || p === "/customers" || p === "/quotations" || p === "/repairs" || p === "/schedule" || p === "/print" || p === "/settlement" || p.startsWith("/css/") || p.startsWith("/js/"))) {
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

    const handoverMatch = p.match(/^\/api\/orders\/([^/]+)\/handovers$/);
    if (handoverMatch) {
      const orderId = decodeURIComponent(handoverMatch[1]);
      if (req.method === "GET") return listHandovers(req, res, orderId);
      if (req.method === "POST") return createHandover(req, res, orderId);
    }

    const handoverDetailMatch = p.match(/^\/api\/orders\/([^/]+)\/handovers\/([^/]+)$/);
    if (handoverDetailMatch) {
      const orderId = decodeURIComponent(handoverDetailMatch[1]);
      const handoverId = decodeURIComponent(handoverDetailMatch[2]);
      if (req.method === "GET") return getHandover(req, res, orderId, handoverId);
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

    const quoteVersionsMatch = p.match(/^\/api\/quotations\/([^/]+)\/versions$/);
    if (quoteVersionsMatch) {
      const quoteId = decodeURIComponent(quoteVersionsMatch[1]);
      if (req.method === "GET") return listVersions(req, res, quoteId);
      if (req.method === "POST") return createVersion(req, res, quoteId);
    }

    const quoteVersionsCompareMatch = p.match(/^\/api\/quotations\/([^/]+)\/versions\/compare$/);
    if (quoteVersionsCompareMatch && req.method === "GET") {
      return compareVersions(req, res, decodeURIComponent(quoteVersionsCompareMatch[1]));
    }

    const quoteVersionApproveMatch = p.match(/^\/api\/quotations\/([^/]+)\/versions\/([^/]+)\/approve$/);
    if (quoteVersionApproveMatch && req.method === "POST") {
      return approveVersion(req, res, decodeURIComponent(quoteVersionApproveMatch[1]), decodeURIComponent(quoteVersionApproveMatch[2]));
    }

    const quoteVersionRejectMatch = p.match(/^\/api\/quotations\/([^/]+)\/versions\/([^/]+)\/reject$/);
    if (quoteVersionRejectMatch && req.method === "POST") {
      return rejectVersion(req, res, decodeURIComponent(quoteVersionRejectMatch[1]), decodeURIComponent(quoteVersionRejectMatch[2]));
    }

    const quoteVersionRestoreMatch = p.match(/^\/api\/quotations\/([^/]+)\/versions\/([^/]+)\/restore$/);
    if (quoteVersionRestoreMatch && req.method === "POST") {
      return restoreVersion(req, res, decodeURIComponent(quoteVersionRestoreMatch[1]), decodeURIComponent(quoteVersionRestoreMatch[2]));
    }

    const quoteVersionMatch = p.match(/^\/api\/quotations\/([^/]+)\/versions\/([^/]+)$/);
    if (quoteVersionMatch) {
      const quoteId = decodeURIComponent(quoteVersionMatch[1]);
      const versionId = decodeURIComponent(quoteVersionMatch[2]);
      if (req.method === "GET") return getVersion(req, res, quoteId, versionId);
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

    if (req.method === "GET" && p === "/api/settlements") return listSettlements(req, res);

    const settlementMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement$/);
    if (settlementMatch) {
      const orderId = decodeURIComponent(settlementMatch[1]);
      if (req.method === "GET") return getSettlement(req, res, orderId);
      if (req.method === "PATCH") return updateSettlement(req, res, orderId);
    }

    const settlementFeesMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement\/fees$/);
    if (settlementFeesMatch) {
      const orderId = decodeURIComponent(settlementFeesMatch[1]);
      if (req.method === "POST") return addFee(req, res, orderId);
    }

    const settlementFeeMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement\/fees\/([^/]+)$/);
    if (settlementFeeMatch) {
      const orderId = decodeURIComponent(settlementFeeMatch[1]);
      const feeId = decodeURIComponent(settlementFeeMatch[2]);
      if (req.method === "PATCH") return updateFee(req, res, orderId, feeId);
      if (req.method === "DELETE") return deleteFee(req, res, orderId, feeId);
    }

    const syncQuoteFeesMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement\/sync-quote$/);
    if (syncQuoteFeesMatch && req.method === "POST") {
      return syncQuoteFees(req, res, decodeURIComponent(syncQuoteFeesMatch[1]));
    }

    const syncHandoverFeesMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement\/sync-handover$/);
    if (syncHandoverFeesMatch && req.method === "POST") {
      return syncHandoverFees(req, res, decodeURIComponent(syncHandoverFeesMatch[1]));
    }

    const settlementPaymentsMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement\/payments$/);
    if (settlementPaymentsMatch) {
      const orderId = decodeURIComponent(settlementPaymentsMatch[1]);
      if (req.method === "POST") return addPayment(req, res, orderId);
    }

    const settlementPaymentMatch = p.match(/^\/api\/orders\/([^/]+)\/settlement\/payments\/([^/]+)$/);
    if (settlementPaymentMatch) {
      const orderId = decodeURIComponent(settlementPaymentMatch[1]);
      const paymentId = decodeURIComponent(settlementPaymentMatch[2]);
      if (req.method === "PATCH") return updatePayment(req, res, orderId, paymentId);
      if (req.method === "DELETE") return deletePayment(req, res, orderId, paymentId);
    }

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
  console.log(`  项目结算:   http://localhost:${port}/settlement`);
});
