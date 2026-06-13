import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "rental.json");
const port = Number(process.env.PORT || 3011);

const seed = {
  equipment: [
    { id: "L-001", name: "摇头染色灯", category: "灯具", spec: "19颗蜂眼", location: "主仓A", condition: "available" },
    { id: "L-002", name: "LED帕灯", category: "灯具", spec: "18x10W", location: "主仓B", condition: "available" },
    { id: "C-001", name: "MA控台", category: "控台", spec: "Command Wing", location: "控台柜", condition: "available" },
    { id: "T-001", name: "铝合金桁架", category: "桁架", spec: "300mm 2m", location: "外场架", condition: "repair" }
  ],
  orders: [
    { id: "O-1001", customer: "星桥活动", startDate: "2026-06-18", endDate: "2026-06-20", status: "待出库", itemIds: ["L-001", "C-001"], note: "发布会" }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
}

function occupiedItems(db, startDate, endDate, exceptOrderId) {
  return new Set(db.orders.filter((order) => order.id !== exceptOrderId && !["已取消", "已归还"].includes(order.status) && overlaps(startDate, endDate, order.startDate, order.endDate)).flatMap((order) => order.itemIds));
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>舞台灯光租赁</title>
  <style>
    :root { --bg:#f4f6f4; --panel:#fff; --ink:#1f2933; --muted:#65717d; --line:#d9dfd8; --green:#2f6b4f; --red:#a64236; --yellow:#9a6a12; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; border-bottom:1px solid var(--line); background:#fff; display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { padding:22px 28px; display:grid; grid-template-columns:360px 1fr; gap:22px; }
    form, .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; } label { display:block; margin:10px 0 5px; font-size:13px; color:var(--muted); }
    input, select, textarea { width:100%; padding:9px; border:1px solid var(--line); border-radius:6px; font:inherit; } textarea { min-height:70px; }
    button { border:0; border-radius:6px; padding:10px 13px; font-weight:700; color:#fff; background:var(--green); cursor:pointer; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select { width:auto; min-width:150px; }
    .items { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:10px; max-height:360px; overflow:auto; padding-right:4px; }
    .item, .order { border:1px solid var(--line); border-radius:8px; padding:12px; background:#fff; }
    .item { cursor:pointer; } .item.selected { border-color:var(--green); outline:2px solid rgba(47,107,79,.15); } .item.disabled { opacity:.48; cursor:not-allowed; }
    .meta { font-size:13px; color:var(--muted); } .badge { display:inline-block; padding:3px 8px; border-radius:999px; background:#eef3ed; font-size:12px; }
    .repair { color:var(--red); } .orders { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px; } .stat strong { display:block; font-size:24px; }
    @media (max-width:850px) { header { display:block; padding:18px 16px; } main { grid-template-columns:1fr; padding:16px; } .stats { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header><div><h1>舞台灯光租赁管理</h1><div class="meta">设备库存、时间占用、待出库和待归还</div></div><button id="reload">刷新</button></header>
  <main>
    <form id="orderForm">
      <h2>创建租赁订单</h2>
      <label>客户</label><input name="customer" required>
      <label>租期开始</label><input name="startDate" type="date" required>
      <label>租期结束</label><input name="endDate" type="date" required>
      <label>备注</label><textarea name="note"></textarea>
      <label>选择设备</label><div class="items" id="items"></div>
      <p class="meta" id="selection"></p>
      <button>提交订单</button>
    </form>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部订单</option><option>待出库</option><option>已出库</option><option>待归还</option><option>已归还</option></select><select id="categoryFilter"><option value="">全部设备</option></select></div>
      <div class="panel"><h2>订单</h2><div class="orders" id="orders"></div></div>
    </section>
  </main>
  <script>
    const orderForm = document.querySelector("#orderForm");
    const itemsEl = document.querySelector("#items");
    const ordersEl = document.querySelector("#orders");
    const statsEl = document.querySelector("#stats");
    const selectionEl = document.querySelector("#selection");
    const statusFilter = document.querySelector("#statusFilter");
    const categoryFilter = document.querySelector("#categoryFilter");
    const selected = new Set();
    let equipment = [];
    let orders = [];

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function overlap(a,b,c,d) { return new Date(a) <= new Date(d) && new Date(c) <= new Date(b); }
    function occupied(id, start, end) { return orders.some(o => !["已取消","已归还"].includes(o.status) && o.itemIds.includes(id) && start && end && overlap(start,end,o.startDate,o.endDate)); }
    function renderItems() {
      const start = orderForm.startDate.value;
      const end = orderForm.endDate.value;
      const category = categoryFilter.value;
      const visible = category ? equipment.filter(e => e.category === category) : equipment;
      itemsEl.innerHTML = visible.map((item) => {
        const unavailable = item.condition === "repair" || occupied(item.id, start, end);
        const cls = "item " + (selected.has(item.id) ? "selected " : "") + (unavailable ? "disabled" : "");
        return '<div class="'+cls+'" data-id="'+item.id+'"><b>'+item.name+'</b><div class="meta">'+item.id+' · '+item.category+' · '+item.spec+'</div><div class="'+(item.condition==="repair"?"repair":"meta")+'">'+(item.condition==="repair"?"维修中": unavailable ? "该租期已占用" : item.location)+'</div></div>';
      }).join("");
      document.querySelectorAll(".item").forEach((el) => {
        el.onclick = () => {
          if (el.classList.contains("disabled")) return;
          selected.has(el.dataset.id) ? selected.delete(el.dataset.id) : selected.add(el.dataset.id);
          render();
        };
      });
      selectionEl.textContent = selected.size ? "已选择：" + [...selected].join("、") : "还没有选择设备";
    }
    function renderOrders() {
      const status = statusFilter.value;
      const visible = status ? orders.filter(o => o.status === status) : orders;
      ordersEl.innerHTML = visible.map((o) => '<article class="order"><h3>'+o.customer+'</h3><div class="meta">'+o.startDate+' 至 '+o.endDate+' · '+o.note+'</div><p>'+o.itemIds.join("、")+'</p><span class="badge">'+o.status+'</span><p><select data-id="'+o.id+'"><option>待出库</option><option>已出库</option><option>待归还</option><option>已归还</option><option>已取消</option></select></p></article>').join("");
      document.querySelectorAll(".order select").forEach((select) => {
        const order = orders.find(o => o.id === select.dataset.id);
        select.value = order.status;
        select.onchange = async () => { await api('/api/orders/'+order.id, { method:'PATCH', body: JSON.stringify({ status: select.value }) }); await load(); };
      });
    }
    function renderStats() {
      const counts = {
        待出库: orders.filter(o => o.status === "待出库").length,
        待归还: orders.filter(o => ["已出库","待归还"].includes(o.status)).length,
        需维修: equipment.filter(e => e.condition === "repair").length
      };
      statsEl.innerHTML = Object.entries(counts).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join("");
    }
    function render() { renderStats(); renderItems(); renderOrders(); }
    async function load() {
      equipment = await api("/api/equipment");
      orders = await api("/api/orders");
      const categories = [...new Set(equipment.map(e => e.category))];
      categoryFilter.innerHTML = '<option value="">全部设备</option>' + categories.map(c => '<option>'+c+'</option>').join("");
      render();
    }
    orderForm.oninput = renderItems;
    statusFilter.onchange = renderOrders;
    categoryFilter.onchange = renderItems;
    document.querySelector("#reload").onclick = load;
    orderForm.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(orderForm).entries());
      data.itemIds = [...selected];
      try {
        await api("/api/orders", { method:"POST", body: JSON.stringify(data) });
        selected.clear(); orderForm.reset(); await load();
      } catch (error) { alert(error.message); }
    };
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/api/equipment") return sendJson(res, 200, db.equipment);
    if (req.method === "GET" && url.pathname === "/api/orders") return sendJson(res, 200, db.orders);
    if (req.method === "POST" && url.pathname === "/api/orders") {
      const input = await body(req);
      if (!input.itemIds?.length) return sendJson(res, 400, { error: "请至少选择一件设备" });
      const occupied = occupiedItems(db, input.startDate, input.endDate);
      const repair = db.equipment.filter((item) => input.itemIds.includes(item.id) && item.condition === "repair").map((item) => item.id);
      const conflict = input.itemIds.filter((id) => occupied.has(id));
      if (repair.length || conflict.length) return sendJson(res, 409, { error: `设备不可用：${[...repair, ...conflict].join("、")}` });
      const order = { id: `O-${Date.now()}`, customer: input.customer, startDate: input.startDate, endDate: input.endDate, status: "待出库", itemIds: input.itemIds, note: input.note || "" };
      db.orders.unshift(order);
      await saveDb(db);
      return sendJson(res, 201, order);
    }
    const match = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (match && req.method === "PATCH") {
      const order = db.orders.find((item) => item.id === match[1]);
      if (!order) return sendJson(res, 404, { error: "order_not_found" });
      Object.assign(order, await body(req));
      await saveDb(db);
      return sendJson(res, 200, order);
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Stage light rental app listening on http://localhost:${port}`);
});
