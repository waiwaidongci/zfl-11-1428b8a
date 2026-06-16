import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { sendJson, sendFile, sendHtml, MIME } from "./lib/http.js";

import * as equipment from "./routes/equipment.js";
import * as equipmentAvailability from "./routes/equipmentAvailability.js";
import * as orders from "./routes/orders.js";
import * as customers from "./routes/customers.js";
import * as quotations from "./routes/quotations.js";
import * as repairs from "./routes/repairs.js";
import * as schedule from "./routes/schedule.js";
import * as settlements from "./routes/settlements.js";
import * as stocktakes from "./routes/stocktakes.js";
import * as packages from "./routes/packages.js";
import * as audit from "./routes/audit.js";

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

function createRouter() {
  const routes = [];

  function compilePattern(pattern) {
    const paramNames = [];
    let regexStr = "^";
    let i = 0;

    while (i < pattern.length) {
      if (pattern[i] === ":") {
        let j = i + 1;
        while (j < pattern.length && /[a-zA-Z0-9_]/.test(pattern[j])) j++;
        paramNames.push(pattern.slice(i + 1, j));
        regexStr += "([^/]+)";
        i = j;
      } else {
        regexStr += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        i++;
      }
    }

    regexStr += "$";
    return { regex: new RegExp(regexStr), paramNames };
  }

  function addRoute(method, pattern, handler) {
    const { regex, paramNames } = compilePattern(pattern);
    routes.push({ method, regex, paramNames, handler });
  }

  function group(prefix, registerRoutes) {
    const originalAdd = (method, pattern, handler) => {
      const fullPattern = pattern === "/" ? prefix : prefix + pattern;
      addRoute(method, fullPattern, handler);
    };
    registerRoutes(originalAdd);
  }

  function match(req, res, pathname) {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;

      const params = route.paramNames.map((name, idx) =>
        decodeURIComponent(match[idx + 1])
      );
      return route.handler(req, res, ...params);
    }
    return null;
  }

  return { addRoute, group, match };
}

const router = createRouter();

router.addRoute("GET", "/api/equipment", equipment.listEquipment);
router.addRoute("POST", "/api/equipment", equipment.createEquipment);
router.addRoute("GET", "/api/equipment/export", equipment.exportEquipment);
router.addRoute("POST", "/api/equipment/import/preview", equipment.previewImport);
router.addRoute("POST", "/api/equipment/import", equipment.confirmImport);
router.addRoute("PATCH", "/api/equipment/:id", equipment.updateEquipment);
router.addRoute("DELETE", "/api/equipment/:id", equipment.deleteEquipment);
router.addRoute("PATCH", "/api/equipment/:id/condition", equipment.patchCondition);
router.addRoute("GET", "/api/equipment/:id/repairs", repairs.getEquipmentRepairs);

router.addRoute("POST", "/api/equipment/availability/check", equipmentAvailability.checkAvailability);
router.addRoute("GET", "/api/equipment/availability", equipmentAvailability.listAvailable);
router.addRoute("GET", "/api/equipment/availability/conflict-types", equipmentAvailability.getConflictTypes);

router.addRoute("GET", "/api/orders", orders.listOrders);
router.addRoute("POST", "/api/orders", orders.createOrder);
router.addRoute("GET", "/api/orders/:id", orders.getOrder);
router.addRoute("PATCH", "/api/orders/:id", orders.updateOrder);
router.addRoute("GET", "/api/orders/:orderId/handovers", orders.listHandovers);
router.addRoute("POST", "/api/orders/:orderId/handovers", orders.createHandover);
router.addRoute("GET", "/api/orders/:orderId/handovers/draft/:type", orders.getHandoverDraft);
router.addRoute("POST", "/api/orders/:orderId/handovers/draft/:type", orders.saveHandoverDraft);
router.addRoute("DELETE", "/api/orders/:orderId/handovers/draft/:type", orders.deleteHandoverDraft);
router.addRoute("GET", "/api/orders/:orderId/handovers/:handoverId", orders.getHandover);

router.addRoute("GET", "/api/customers", customers.listCustomers);
router.addRoute("POST", "/api/customers", customers.createCustomer);
router.addRoute("GET", "/api/customers/:id", customers.getCustomer);
router.addRoute("PATCH", "/api/customers/:id", customers.updateCustomer);
router.addRoute("DELETE", "/api/customers/:id", customers.deleteCustomer);

router.addRoute("GET", "/api/quotations", quotations.listQuotations);
router.addRoute("POST", "/api/quotations", quotations.createQuotation);
router.addRoute("POST", "/api/quotations/preview", quotations.previewQuote);
router.addRoute("GET", "/api/quotations/:id", quotations.getQuotation);
router.addRoute("PATCH", "/api/quotations/:id", quotations.updateQuotation);
router.addRoute("DELETE", "/api/quotations/:id", quotations.deleteQuotation);
router.addRoute("POST", "/api/quotations/:id/convert", quotations.convertToOrder);
router.addRoute("GET", "/api/quotations/:id/check", quotations.checkConvertibility);
router.addRoute("GET", "/api/quotations/:quoteId/versions", quotations.listVersions);
router.addRoute("POST", "/api/quotations/:quoteId/versions", quotations.createVersion);
router.addRoute("GET", "/api/quotations/:quoteId/versions/compare", quotations.compareVersions);
router.addRoute("POST", "/api/quotations/:quoteId/versions/:versionId/approve", quotations.approveVersion);
router.addRoute("POST", "/api/quotations/:quoteId/versions/:versionId/reject", quotations.rejectVersion);
router.addRoute("POST", "/api/quotations/:quoteId/versions/:versionId/restore", quotations.restoreVersion);
router.addRoute("GET", "/api/quotations/:quoteId/versions/:versionId", quotations.getVersion);

router.addRoute("GET", "/api/repairs", repairs.listRepairs);
router.addRoute("POST", "/api/repairs", repairs.createRepair);
router.addRoute("GET", "/api/repairs/:id", repairs.getRepair);
router.addRoute("PATCH", "/api/repairs/:id", repairs.updateRepair);
router.addRoute("DELETE", "/api/repairs/:id", repairs.deleteRepair);
router.addRoute("POST", "/api/repairs/:id/advance", repairs.advanceRepairStatus);

router.addRoute("GET", "/api/schedule", schedule.getSchedule);

router.addRoute("GET", "/api/settlements", settlements.listSettlements);
router.addRoute("GET", "/api/orders/:orderId/settlement", settlements.getSettlement);
router.addRoute("PATCH", "/api/orders/:orderId/settlement", settlements.updateSettlement);
router.addRoute("POST", "/api/orders/:orderId/settlement/fees", settlements.addFee);
router.addRoute("PATCH", "/api/orders/:orderId/settlement/fees/:feeId", settlements.updateFee);
router.addRoute("DELETE", "/api/orders/:orderId/settlement/fees/:feeId", settlements.deleteFee);
router.addRoute("POST", "/api/orders/:orderId/settlement/sync-quote", settlements.syncQuoteFees);
router.addRoute("POST", "/api/orders/:orderId/settlement/sync-handover", settlements.syncHandoverFees);
router.addRoute("POST", "/api/orders/:orderId/settlement/sync-repair", settlements.syncRepairFees);
router.addRoute("POST", "/api/orders/:orderId/settlement/payments", settlements.addPayment);
router.addRoute("PATCH", "/api/orders/:orderId/settlement/payments/:paymentId", settlements.updatePayment);
router.addRoute("DELETE", "/api/orders/:orderId/settlement/payments/:paymentId", settlements.deletePayment);
router.addRoute("GET", "/api/orders/:orderId/settlement/plans", settlements.listPaymentPlans);
router.addRoute("POST", "/api/orders/:orderId/settlement/plans", settlements.addPaymentPlan);
router.addRoute("PATCH", "/api/orders/:orderId/settlement/plans/:planId", settlements.updatePaymentPlan);
router.addRoute("DELETE", "/api/orders/:orderId/settlement/plans/:planId", settlements.deletePaymentPlan);

router.addRoute("GET", "/api/stocktakes", stocktakes.listStocktakes);
router.addRoute("POST", "/api/stocktakes", stocktakes.createStocktake);
router.addRoute("GET", "/api/stocktakes/:id", stocktakes.getStocktake);
router.addRoute("PATCH", "/api/stocktakes/:id", stocktakes.updateStocktake);
router.addRoute("DELETE", "/api/stocktakes/:id", stocktakes.deleteStocktake);
router.addRoute("POST", "/api/stocktakes/:id/scan", stocktakes.scanStocktakeItem);
router.addRoute("POST", "/api/stocktakes/:id/submit", stocktakes.submitStocktake);
router.addRoute("POST", "/api/stocktakes/:id/cancel", stocktakes.cancelStocktake);
router.addRoute("POST", "/api/stocktakes/:id/mark-processed/:equipmentId", stocktakes.markItemProcessed);
router.addRoute("POST", "/api/stocktakes/:id/damaged/:equipmentId", stocktakes.processDamaged);
router.addRoute("POST", "/api/stocktakes/:id/missing/:equipmentId", stocktakes.processMissing);
router.addRoute("POST", "/api/stocktakes/:id/mismatch/:equipmentId", stocktakes.processMismatch);

router.addRoute("GET", "/api/packages", packages.listPackages);
router.addRoute("POST", "/api/packages", packages.createPackage);
router.addRoute("POST", "/api/packages/preview-quote", packages.previewPackageQuote);
router.addRoute("GET", "/api/packages/:id", packages.getPackage);
router.addRoute("PATCH", "/api/packages/:id", packages.updatePackage);
router.addRoute("DELETE", "/api/packages/:id", packages.deletePackage);
router.addRoute("GET", "/api/packages/:id/availability", packages.checkPackageAvailability);

router.addRoute("GET", "/api/audit-logs", audit.listAuditLogsApi);
router.addRoute("GET", "/api/audit-logs/:id", audit.getAuditLogApi);
router.addRoute("POST", "/api/audit-logs/:id/revert", audit.revertAuditLogApi);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === "GET" && (p === "/" || p === "/equipment" || p === "/customers" || p === "/quotations" || p === "/repairs" || p === "/schedule" || p === "/print" || p === "/settlement" || p === "/stocktake" || p.startsWith("/css/") || p.startsWith("/js/"))) {
      const served = await serveStatic(req, res, p);
      if (served) return;
    }

    const matched = router.match(req, res, p);
    if (matched !== null) return matched;

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
  console.log(`  库存盘点:   http://localhost:${port}/stocktake`);
});
