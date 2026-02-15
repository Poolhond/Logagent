/* Tuinlog MVP — 5 boeken + detail sheets
   - Logboek: start/stop/pauze, items toevoegen
   - Afrekenboek: bundel logs, per regel Factuur/Cash dropdown
   - Klanten: detail toont logs + afrekeningen
   - Producten: beheerlijst, gebruikt in logs/afrekeningen
   - Status kleuren: logs afgeleid van afrekening.status
*/

const STORAGE_KEY = "tuinlog_mvp_v1";
const $ = (s) => document.querySelector(s);

const uid = () => Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
const now = () => Date.now();
const todayISO = () => new Date().toISOString().slice(0,10);
const esc = (s) => String(s ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

function fmtMoney(n){
  const v = Number(n||0);
  return "€" + v.toFixed(2).replace(".", ",");
}
function pad2(n){ return String(n).padStart(2,"0"); }
function fmtClock(ms){
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function durMsToHM(ms){
  const m = Math.max(0, Math.floor(ms/60000));
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h}u ${pad2(mm)}m`;
}
function round2(n){ return Math.round((Number(n||0))*100)/100; }
function formatLogDatePretty(isoDate){
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return String(isoDate);
  const dt = new Date(y, m - 1, d);
  if (!Number.isFinite(dt.getTime())) return String(isoDate);
  const dayNames = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const monthNames = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const yy = String(y).slice(-2);
  return `${dayNames[dt.getDay()]} ${d} ${monthNames[m - 1]} ${yy}`;
}
function fmtTimeInput(ms){
  if (!Number.isFinite(ms)) return "";
  return fmtClock(ms);
}
function parseLogTimeToMs(isoDate, value){
  if (!value) return null;
  const parsed = new Date(`${isoDate}T${value}:00`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function confirmDelete(label){
  return confirm(`Zeker verwijderen?\n\n${label}\n\nDit kan niet ongedaan gemaakt worden.`);
}
function confirmAction(label){
  return confirm(label);
}

// ---------- State ----------
function defaultState(){
  return {
    settings: { hourlyRate: 38, vatRate: 0.21 },
    customers: [
      { id: uid(), nickname:"Van de Werf", name:"", address:"Heverlee, Leuven", createdAt: now() },
      { id: uid(), nickname:"Kessel-Lo tuin", name:"", address:"Kessel-Lo, Leuven", createdAt: now() },
    ],
    products: [
      { id: uid(), name:"Werk", unit:"uur", unitPrice:38, vatRate:0.21, defaultBucket:"invoice" },
      { id: uid(), name:"Groen", unit:"keer", unitPrice:38, vatRate:0.21, defaultBucket:"invoice" },
    ],
    logs: [],
    settlements: [],
    activeLogId: null,
    ui: {
      logFilter: "open",
      showLogFilters: false,
      logCustomerId: "all",
      logPeriod: "all"
    }
  };
}

function ensureUIPreferences(st){
  st.ui = st.ui || {};
  if (!["open", "paid", "all"].includes(st.ui.logFilter)) st.ui.logFilter = "open";
  if (!("showLogFilters" in st.ui)) st.ui.showLogFilters = false;
  if (!("logCustomerId" in st.ui)) st.ui.logCustomerId = "all";
  if (!("logPeriod" in st.ui)) st.ui.logPeriod = "all";
  if (!["7d", "30d", "90d", "all"].includes(st.ui.logPeriod)) st.ui.logPeriod = "all";
  if (!("editLogId" in st.ui)) st.ui.editLogId = null;
}

function ensureCoreProducts(st){
  st.products = st.products || [];
  const coreProducts = [
    { name:"Werk", unit:"uur", unitPrice:38, vatRate:0.21, defaultBucket:"invoice" },
    { name:"Groen", unit:"keer", unitPrice:38, vatRate:0.21, defaultBucket:"invoice" },
  ];
  for (const core of coreProducts){
    const exists = st.products.find(p => (p.name||"").trim().toLowerCase() === core.name.toLowerCase());
    if (!exists){
      st.products.push({ id: uid(), ...core });
    }
  }
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw){
    const st = defaultState();
    seedDemoMonths(st, { months: 3, force: false });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    return st;
  }
  const st = JSON.parse(raw);

  // migrations
  if (!st.settings) st.settings = { hourlyRate: 38, vatRate: 0.21 };
  if (!("hourlyRate" in st.settings)) st.settings.hourlyRate = 38;
  if (!("vatRate" in st.settings)) st.settings.vatRate = 0.21;
  if (!st.customers) st.customers = [];
  if (!st.products) st.products = [];
  if (!st.logs) st.logs = [];
  if (!st.settlements) st.settlements = [];
  if (!("activeLogId" in st)) st.activeLogId = null;
  ensureUIPreferences(st);

  for (const c of st.customers){
    if (!("demo" in c)) c.demo = false;
  }
  for (const p of st.products){
    if (!("demo" in p)) p.demo = false;
  }

  ensureCoreProducts(st);

  // settlement status default
  for (const s of st.settlements){
    if (!s.status) s.status = "draft";
    if (!s.lines) s.lines = [];
    if (!s.logIds) s.logIds = [];
    if (!("invoicePaid" in s)) s.invoicePaid = false;
    if (!("cashPaid" in s)) s.cashPaid = false;
    if (!("demo" in s)) s.demo = false;
  }
  // log fields
  for (const l of st.logs){
    if (!l.segments) l.segments = [];
    if (!l.items) l.items = [];
    if (!l.date) l.date = todayISO();
    if (!("demo" in l)) l.demo = false;
  }

  ensureUIPreferences(st);

  return st;
}

function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

const DEMO = {
  firstNames: ["Jan", "Els", "Koen", "Sofie", "Lotte", "Tom", "An", "Pieter", "Nina", "Wim", "Bram", "Fien", "Arne", "Joke", "Raf", "Mira", "Tine", "Milan"],
  lastNames: ["Peeters", "Janssens", "Van den Broeck", "Wouters", "Claes", "Lambrechts", "Maes", "Vermeulen", "Hermans", "Goossens", "De Smet", "Schreurs"],
  streets: ["Naamsesteenweg", "Tiensevest", "Diestsesteenweg", "Tervuursesteenweg", "Geldenaaksebaan", "Kapucijnenvoer", "Ridderstraat", "Brusselsestraat", "Parkstraat", "Molenstraat", "Blandenstraat"],
  zones: ["Heverlee", "Kessel-Lo", "Wilsele", "Herent", "Leuven", "Wijgmaal", "Haasrode", "Bertem"],
  nicknames: ["achtertuin", "voortuin", "haag", "gazons", "border", "moestuin", "terras", "oprit"]
};

function ri(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }
function rf(min, max){ return Math.random() * (max - min) + min; }
function pick(arr){ return arr[ri(0, arr.length - 1)]; }
function demoDateISO(daysBack){
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0,10);
}

function ensureStateSafetyAfterMutations(st){
  const logIds = new Set(st.logs.map(l => l.id));
  for (const s of st.settlements){
    s.logIds = (s.logIds||[]).filter(id => logIds.has(id));
  }
  if (st.activeLogId && !logIds.has(st.activeLogId)) st.activeLogId = null;
  const active = currentView();
  if (active.view === "logDetail" && !logIds.has(active.id)) popView();
  if (active.view === "customerDetail" && !st.customers.some(c => c.id === active.id)) popView();
  if (active.view === "productDetail" && !st.products.some(p => p.id === active.id)) popView();
  if (active.view === "settlementDetail" && !st.settlements.some(x => x.id === active.id)) popView();
}

function settlementTotals(settlement){
  return getSettlementTotals(settlement);
}

function seedDemoMonths(st, { months = 3, force = false } = {}){
  const hasDemo = (st.customers||[]).some(c => c.demo) || (st.logs||[]).some(l => l.demo) || (st.settlements||[]).some(s => s.demo);
  if (!force && hasDemo) return false;

  ensureCoreProducts(st);

  const workProduct = st.products.find(p => (p.name||"").trim().toLowerCase() === "werk");
  const greenProduct = st.products.find(p => (p.name||"").trim().toLowerCase() === "groen");
  if (!workProduct || !greenProduct) return false;

  const customerCount = ri(12, 25);
  const logCount = ri(40, 90);
  const settlementCount = ri(15, 35);

  const customers = [];
  for (let i = 0; i < customerCount; i++){
    const fn = pick(DEMO.firstNames);
    const ln = pick(DEMO.lastNames);
    const street = pick(DEMO.streets);
    const zone = pick(DEMO.zones);
    const nr = ri(1, 180);
    const nick = `${ln.split(" ")[0]} ${pick(DEMO.nicknames)}`;
    customers.push({
      id: uid(),
      nickname: nick,
      name: `${fn} ${ln}`,
      address: `${street} ${nr}, ${zone}, Leuven`,
      createdAt: now() - ri(15, 90) * 86400000,
      demo: true
    });
  }

  const logs = [];
  for (let i = 0; i < logCount; i++){
    const customer = pick(customers);
    const daysBack = ri(0, months * 31 - 1);
    const date = demoDateISO(daysBack);
    const startHour = ri(7, 10);
    const startMin = pick([0, 15, 30, 45]);
    const firstDurMin = ri(90, 220);
    const breakMin = Math.random() < 0.35 ? ri(10, 35) : 0;
    const secondDurMin = Math.random() < 0.55 ? ri(60, 180) : 0;

    const start = new Date(`${date}T${pad2(startHour)}:${pad2(startMin)}:00`).getTime();
    const firstEnd = start + firstDurMin * 60000;
    const breakEnd = firstEnd + breakMin * 60000;
    const finalEnd = breakEnd + secondDurMin * 60000;

    const segments = [{ id: uid(), type:"work", start, end: firstEnd }];
    if (breakMin > 0) segments.push({ id: uid(), type:"break", start: firstEnd, end: breakEnd });
    if (secondDurMin > 0) segments.push({ id: uid(), type:"work", start: breakEnd, end: finalEnd });

    const workHours = round2(sumWorkMs({ segments }) / 3600000);
    const greenQty = ri(0, 3);
    const items = [
      { id: uid(), productId: workProduct.id, qty: workHours, unitPrice: 38, note:"" },
      { id: uid(), productId: greenProduct.id, qty: greenQty, unitPrice: 38, note:"" }
    ];

    logs.push({
      id: uid(),
      customerId: customer.id,
      date,
      createdAt: start,
      closedAt: finalEnd,
      note: Math.random() < 0.3 ? pick(["Onderhoud", "Snoeiwerk", "Border opgefrist", "Seizoensbeurt"]) : "",
      segments,
      items,
      demo: true
    });
  }

  logs.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));

  const settlements = [];
  const logsByCustomer = new Map();
  for (const l of logs){
    if (!logsByCustomer.has(l.customerId)) logsByCustomer.set(l.customerId, []);
    logsByCustomer.get(l.customerId).push(l);
  }
  for (const arr of logsByCustomer.values()) arr.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));

  const target = Math.min(settlementCount, Math.max(1, logs.length));
  for (let i = 0; i < target; i++){
    const cid = pick([...logsByCustomer.keys()]);
    const pool = logsByCustomer.get(cid).filter(l => !l._used);
    if (!pool.length) continue;
    const take = pool.slice(0, ri(1, Math.min(6, pool.length)));
    take.forEach(l => { l._used = true; });

    const summary = { workQty: 0, greenQty: 0 };
    for (const log of take){
      for (const it of (log.items||[])){
        if (it.productId === workProduct.id) summary.workQty += Number(it.qty)||0;
        if (it.productId === greenProduct.id) summary.greenQty += Number(it.qty)||0;
      }
    }
    summary.workQty = round2(summary.workQty);
    summary.greenQty = round2(summary.greenQty);

    const scenarioPick = Math.random();
    const scenario = scenarioPick < 0.35 ? "invoice" : (scenarioPick < 0.70 ? "cash" : "mixed");
    const lines = [];
    const pushLine = ({ bucket, productId, description, unit, qty, unitPrice, vatRate })=>{
      const nQty = round2(Number(qty)||0);
      if (nQty <= 0) return;
      lines.push({ id: uid(), bucket, productId, description, unit, qty: nQty, unitPrice, vatRate });
    };

    if (scenario === "invoice"){
      pushLine({ bucket:"invoice", productId: workProduct.id, description:"Werk", unit:"uur", qty: summary.workQty, unitPrice:38, vatRate:0.21 });
      pushLine({ bucket:"invoice", productId: greenProduct.id, description:"Groen", unit:"keer", qty: summary.greenQty, unitPrice:38, vatRate:0.21 });
    } else if (scenario === "cash"){
      pushLine({ bucket:"cash", productId: workProduct.id, description:"Werk", unit:"uur", qty: summary.workQty, unitPrice:38, vatRate:0 });
      pushLine({ bucket:"cash", productId: greenProduct.id, description:"Groen", unit:"keer", qty: summary.greenQty, unitPrice:38, vatRate:0 });
    } else {
      const invoiceWorkQty = round2(Math.max(0.5, summary.workQty * rf(0.45, 0.75)));
      const cashWorkQty = round2(Math.max(0.5, summary.workQty - invoiceWorkQty));
      const invoiceGreenQty = Math.floor(summary.greenQty / 2);
      const cashGreenQty = Math.max(0, Math.round(summary.greenQty - invoiceGreenQty));
      pushLine({ bucket:"invoice", productId: workProduct.id, description:"Werk", unit:"uur", qty: invoiceWorkQty, unitPrice:38, vatRate:0.21 });
      pushLine({ bucket:"cash", productId: workProduct.id, description:"Werk", unit:"uur", qty: cashWorkQty, unitPrice:38, vatRate:0 });
      pushLine({ bucket:"invoice", productId: greenProduct.id, description:"Groen", unit:"keer", qty: invoiceGreenQty, unitPrice:38, vatRate:0.21 });
      pushLine({ bucket:"cash", productId: greenProduct.id, description:"Groen", unit:"keer", qty: cashGreenQty, unitPrice:38, vatRate:0 });
    }

    const statusPick = Math.random();
    const status = statusPick < 0.30 ? "draft" : "calculated";
    const temp = {
      id: uid(),
      customerId: cid,
      date: take[take.length - 1].date,
      createdAt: take[take.length - 1].createdAt,
      logIds: take.map(l => l.id),
      lines,
      status,
      invoicePaid: false,
      cashPaid: false,
      demo: true
    };

    const totals = settlementTotals(temp);
    if (statusPick >= 0.70){
      if (totals.invoiceTotal > 0 && totals.cashTotal > 0){
        temp.invoicePaid = true;
        temp.cashPaid = true;
      } else if (totals.invoiceTotal > 0){
        temp.invoicePaid = true;
      } else if (totals.cashTotal > 0){
        temp.cashPaid = true;
      }
    } else {
      temp.invoicePaid = totals.invoiceTotal > 0 ? Math.random() < 0.5 : false;
      temp.cashPaid = totals.cashTotal > 0 ? Math.random() < 0.5 : false;
    }

    const paid = isSettlementPaid(temp);
    if (paid) temp.status = "calculated";

    settlements.push(temp);
  }

  for (const l of logs) delete l._used;

  st.customers = [...customers, ...st.customers];
  st.logs = [...logs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)), ...st.logs];
  st.settlements = [...settlements.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)), ...st.settlements];
  return true;
}

function clearDemoData(st){
  const removedLogIds = new Set((st.logs||[]).filter(l => l.demo).map(l => l.id));
  st.customers = (st.customers||[]).filter(c => !c.demo);
  st.logs = (st.logs||[]).filter(l => !l.demo);
  st.settlements = (st.settlements||[])
    .filter(s => !s.demo)
    .map(s => ({ ...s, logIds: (s.logIds||[]).filter(id => !removedLogIds.has(id)) }));
  ensureStateSafetyAfterMutations(st);
}

const state = loadState();

// ---------- Computations ----------
function sumWorkMs(log){
  let t=0;
  for (const s of (log.segments||[])){
    if (s.type !== "work") continue;
    const end = s.end ?? now();
    t += Math.max(0, end - s.start);
  }
  return t;
}
function sumBreakMs(log){
  let t=0;
  for (const s of (log.segments||[])){
    if (s.type !== "break") continue;
    const end = s.end ?? now();
    t += Math.max(0, end - s.start);
  }
  return t;
}
function sumItemsAmount(log){
  return round2((log.items||[]).reduce((acc,it)=> acc + (Number(it.qty)||0)*(Number(it.unitPrice)||0), 0));
}
function getCustomer(id){ return state.customers.find(c => c.id === id) || null; }
function cname(id){ const c=getCustomer(id); return c ? (c.nickname || c.name || "Klant") : "Klant"; }
function getProduct(id){ return state.products.find(p => p.id === id) || null; }
function pname(id){ const p=getProduct(id); return p ? p.name : "Product"; }

function currentOpenSegment(log){
  return (log.segments||[]).find(s => s.end == null) || null;
}
function closeOpenSegment(log){
  const seg = currentOpenSegment(log);
  if (seg) seg.end = now();
}
function openSegment(log, type){
  log.segments = log.segments || [];
  log.segments.push({ id: uid(), type, start: now(), end: null });
}

// ---------- Status helpers ----------
function statusClassFromStatus(s){
  if (s === "linked" || s === "draft") return "status-linked";
  if (s === "calculated") return "status-calculated";
  if (s === "paid") return "status-paid";
  return "";
}
function getLogVisualState(log){
  const state = logStatus(log.id);
  if (state === "paid") return { state: "paid", color: "#00a05a" };
  if (state === "calculated") return { state: "calculated", color: "#ff8c00" };
  if (state === "linked") return { state: "linked", color: "#ffcc00" };
  return { state: "free", color: "#93a0b5" };
}
function getSettlementTotals(settlement){
  const invoiceTotals = bucketTotals(settlement.lines, "invoice");
  const cashTotals = bucketTotals(settlement.lines, "cash");
  return {
    invoiceTotal: invoiceTotals.total,
    cashTotal: cashTotals.subtotal
  };
}
function isSettlementPaid(settlement){
  const { invoiceTotal, cashTotal } = getSettlementTotals(settlement);
  const hasInvoice = invoiceTotal > 0;
  const hasCash = cashTotal > 0;
  return (!hasInvoice || settlement.invoicePaid)
    && (!hasCash || settlement.cashPaid)
    && (hasInvoice || hasCash);
}
function settlementColorClass(settlement){
  return statusClassFromStatus(settlementVisualState(settlement));
}
function settlementForLog(logId){
  return state.settlements.find(a => (a.logIds||[]).includes(logId)) || null;
}
function settlementVisualState(settlement){
  if (!settlement) return "free";
  if (isSettlementPaid(settlement)) return "paid";
  if (settlement.status === "calculated") return "calculated";
  return "linked";
}
function logStatus(logId){
  return settlementVisualState(settlementForLog(logId));
}
function isLogLinkedElsewhere(logId, currentSettlementId){
  return state.settlements.some(s =>
    s.id !== currentSettlementId &&
    (s.logIds || []).includes(logId)
  );
}
function getWorkLogStatus(logId){
  return logStatus(logId);
}
function statusLabelNL(s){
  if (s === "draft") return "draft";
  if (s === "calculated") return "berekend";
  if (s === "paid") return "betaald";
  return s || "";
}

// ---------- Lines & totals ----------
function lineAmount(line){ return round2((Number(line.qty)||0) * (Number(line.unitPrice)||0)); }
function lineVat(line){
  const r = Number(line.vatRate ?? state.settings.vatRate ?? 0.21);
  const bucket = line.bucket || "invoice";
  if (bucket === "cash") return 0;
  return round2(lineAmount(line) * r);
}
function bucketTotals(lines, bucket){
  const arr = (lines||[]).filter(l => (l.bucket||"invoice") === bucket);
  const subtotal = round2(arr.reduce((a,l)=> a + lineAmount(l), 0));
  const vat = round2(arr.reduce((a,l)=> a + lineVat(l), 0));
  const total = round2(subtotal + vat);
  return { subtotal, vat, total };
}

function settlementPaymentState(settlement){
  const invoiceTotals = bucketTotals(settlement.lines, "invoice");
  const cashTotals = bucketTotals(settlement.lines, "cash");
  const { invoiceTotal, cashTotal } = getSettlementTotals(settlement);
  const hasInvoice = invoiceTotal > 0;
  const hasCash = cashTotal > 0;
  const isPaid = isSettlementPaid(settlement);
  return { invoiceTotals, cashTotals, invoiceTotal, cashTotal, hasInvoice, hasCash, isPaid };
}

function computeSettlementFromLogsInState(sourceState, customerId, logIds){
  let workMs = 0;
  const itemMap = new Map(); // productId -> {qty, unitPrice}
  for (const id of logIds){
    const log = sourceState.logs.find(l => l.id === id);
    if (!log) continue;
    workMs += sumWorkMs(log);
    for (const it of (log.items||[])){
      const key = it.productId || "free";
      if (!itemMap.has(key)) itemMap.set(key, { qty:0, unitPrice: Number(it.unitPrice)||0 });
      const cur = itemMap.get(key);
      cur.qty += Number(it.qty)||0;
      cur.unitPrice = Number(it.unitPrice)||cur.unitPrice;
    }
  }
  const hours = round2(workMs / 3600000);

  // build lines: labour + grouped items
  const lines = [];
  const labourProduct = sourceState.products.find(p => {
    const n = (p.name||"").toLowerCase();
    return n === "werk" || n === "arbeid";
  });
  if (hours > 0){
    lines.push({
      id: uid(),
      productId: labourProduct?.id || null,
      description: labourProduct?.name || "Werk",
      unit: labourProduct?.unit || "uur",
      qty: hours,
      unitPrice: Number(sourceState.settings.hourlyRate||38),
      vatRate: labourProduct?.vatRate ?? 0.21,
      bucket: "invoice"
    });
  }
  for (const [productId, v] of itemMap.entries()){
    const prod = sourceState.products.find(p => p.id === productId);
    lines.push({
      id: uid(),
      productId,
      description: prod?.name || "Product",
      unit: prod?.unit || "keer",
      qty: round2(v.qty),
      unitPrice: round2(v.unitPrice),
      vatRate: prod?.vatRate ?? 0.21,
      bucket: (prod?.defaultBucket || "invoice")
    });
  }

  return { workMs, hours, lines };
}

function computeSettlementFromLogs(customerId, logIds){
  return computeSettlementFromLogsInState(state, customerId, logIds);
}

// ---------- UI state ----------
const ui = {
  navStack: [{ view: "logs" }],
  transition: null,
  logDetailSegmentEditId: null,
  activeLogQuickAdd: {
    open: false,
    productId: null,
    qty: "1"
  }
};

function toggleEditLog(logId){
  state.ui.editLogId = state.ui.editLogId === logId ? null : logId;
  if (state.ui.editLogId !== logId) ui.logDetailSegmentEditId = null;
  saveState();
  renderSheet();
  render();
}

function preferredWorkProduct(){
  return state.products.find(p => (p.name||"").trim().toLowerCase() === "werk") || state.products[0] || null;
}

function addProductToLog(logId, productId, qty, unitPrice){
  const log = state.logs.find(l => l.id === logId);
  if (!log) return false;
  const product = state.products.find(p => p.id === productId) || preferredWorkProduct();
  if (!product) return false;

  const parsedQty = Number(String(qty ?? "").replace(",", "."));
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) return false;

  const priceSource = unitPrice ?? product.unitPrice ?? 0;
  const parsedUnitPrice = Number(String(priceSource).replace(",", "."));
  const safeUnitPrice = Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : 0;

  log.items = log.items || [];
  log.items.push({
    id: uid(),
    productId: product.id,
    qty: parsedQty,
    unitPrice: safeUnitPrice,
    note: ""
  });
  return true;
}

function currentView(){
  return ui.navStack[ui.navStack.length - 1] || { view: "logs" };
}

function updateTabs(){
  const key = ui.navStack[0]?.view || "logs";
  $("#tab-logs").classList.toggle("hidden", key !== "logs");
  $("#tab-settlements").classList.toggle("hidden", key !== "settlements");
  $("#tab-customers").classList.toggle("hidden", key !== "customers");
  $("#tab-products").classList.toggle("hidden", key !== "products");
  $("#tab-settings").classList.toggle("hidden", key !== "settings");

  $("#nav-logs").classList.toggle("active", key === "logs");
  $("#nav-settlements").classList.toggle("active", key === "settlements");
  $("#nav-customers").classList.toggle("active", key === "customers");
  $("#nav-products").classList.toggle("active", key === "products");
  $("#nav-settings").classList.toggle("active", key === "settings");

  $("#nav-logs").setAttribute("aria-selected", String(key === "logs"));
  $("#nav-settlements").setAttribute("aria-selected", String(key === "settlements"));
  $("#nav-customers").setAttribute("aria-selected", String(key === "customers"));
  $("#nav-products").setAttribute("aria-selected", String(key === "products"));
  $("#nav-settings").setAttribute("aria-selected", String(key === "settings"));
}

function viewTitle(viewState){
  const view = viewState?.view;
  if (view === "logs") return "Logboek";
  if (view === "settlements") return "Afrekenboek";
  if (view === "customers") return "Klanten";
  if (view === "products") return "Producten";
  if (view === "settings") return "Instellingen";
  if (view === "logDetail"){
    const l = state.logs.find(x => x.id === viewState.id);
    return l ? `${cname(l.customerId)} · ${l.date}` : "Werklog";
  }
  if (view === "settlementDetail"){
    const s = state.settlements.find(x => x.id === viewState.id);
    return s ? `${cname(s.customerId)}${s.date ? ` · ${s.date}` : ""}` : "Afrekening";
  }
  if (view === "customerDetail"){
    const c = state.customers.find(x => x.id === viewState.id);
    return c ? (c.nickname || c.name || "Klant") : "Klant";
  }
  if (view === "productDetail"){
    const p = state.products.find(x => x.id === viewState.id);
    return p ? (p.name || "Product") : "Product";
  }
  if (view === "newLog") return "Nieuwe werklog";
  return "Tuinlog";
}

function renderTopbar(){
  const active = currentView();
  const topbar = document.querySelector(".topbar");
  const subtitleEl = $("#topbarSubtitle");
  topbar.classList.remove("nav--free", "nav--linked", "nav--calculated", "nav--paid");
  subtitleEl.classList.add("hidden");
  subtitleEl.textContent = "";

  if (active.view === "logDetail"){
    const log = state.logs.find(x => x.id === active.id);
    if (log){
      const visual = getLogVisualState(log);
      topbar.classList.add(`nav--${visual.state}`);
      $("#topbarTitle").textContent = cname(log.customerId);
      subtitleEl.textContent = formatLogDatePretty(log.date);
      subtitleEl.classList.remove("hidden");
    } else {
      $("#topbarTitle").textContent = viewTitle(active);
    }
  } else {
    $("#topbarTitle").textContent = viewTitle(active);
  }

  const showBack = ui.navStack.length > 1;
  $("#btnBack").classList.toggle("hidden", !showBack);
}

function setTab(key){
  ui.navStack = [{ view: key }];
  ui.transition = null;
  render();
}

function pushView(viewState){
  ui.transition = "push";
  ui.navStack.push(viewState);
  render();
}

function popView(){
  if (ui.navStack.length <= 1) return;
  ui.transition = "pop";
  ui.navStack.pop();
  render();
}

$("#nav-logs").addEventListener("click", ()=>setTab("logs"));
$("#nav-settlements").addEventListener("click", ()=>setTab("settlements"));
$("#nav-customers").addEventListener("click", ()=>setTab("customers"));
$("#nav-products").addEventListener("click", ()=>setTab("products"));
$("#nav-settings").addEventListener("click", ()=>setTab("settings"));

$("#btnBack").addEventListener("click", popView);
$("#btnNewLog").addEventListener("click", ()=> pushView({ view: "newLog" }));

function startWorkLog(customerId){
  if (!customerId) return;
  if (state.activeLogId){
    alert("Er is al een actieve werklog.");
    return;
  }
  const log = {
    id: uid(),
    customerId,
    date: todayISO(),
    createdAt: now(),
    closedAt: null,
    note: "",
    segments: [],
    items: []
  };
  openSegment(log, "work");
  state.logs.unshift(log);
  state.activeLogId = log.id;
  saveState();
  popView();
}

function openSheet(type, id){
  const map = {
    "log": "logDetail",
    "customer": "customerDetail",
    "product": "productDetail",
    "settlement": "settlementDetail",
    "new-log": "newLog"
  };
  const view = map[type];
  if (!view) return;
  pushView(id ? { view, id } : { view });
}
function closeSheet(){
  popView();
}

// ---------- Render ----------
function render(){
  const root = ui.navStack[0]?.view || "logs";
  updateTabs();
  if (root === "logs") renderLogs();
  if (root === "settlements") renderSettlements();
  if (root === "customers") renderCustomers();
  if (root === "products") renderProducts();
  if (root === "settings") renderSettings();

  renderTopbar();

  const detailPage = $("#detailPage");
  const rootPage = $("#rootPage");
  if (ui.navStack.length > 1){
    detailPage.classList.remove("hidden");
    renderSheet();
    if (ui.transition === "push"){
      detailPage.className = "page enter";
      rootPage.className = "page active";
      requestAnimationFrame(()=>{
        detailPage.className = "page active";
        rootPage.className = "page exitLeft";
      });
    } else {
      detailPage.className = "page active";
      rootPage.className = "page exitLeft";
    }
  } else {
    if (ui.transition === "pop" && !detailPage.classList.contains("hidden")){
      detailPage.className = "page active";
      rootPage.className = "page exitLeft";
      requestAnimationFrame(()=>{
        detailPage.className = "page enter";
        rootPage.className = "page active";
      });
      setTimeout(()=>{
        detailPage.className = "page hidden";
        detailPage.innerHTML = '<div class="page-inner"><div class="detail-head"><div id="sheetTitle" class="hidden"></div><div class="sheet-actions" id="sheetActions"></div></div><div class="sheet-body" id="sheetBody"></div></div>';
      }, 280);
    } else {
      detailPage.className = "page hidden";
      rootPage.className = "page active";
    }
  }
  ui.transition = null;
}

function renderLogs(){
  const el = $("#tab-logs");
  const active = state.activeLogId ? state.logs.find(l => l.id === state.activeLogId) : null;
  const logFilter = state.ui.logFilter || "open";
  const showLogFilters = !!state.ui.showLogFilters;
  const logCustomerId = state.ui.logCustomerId || "all";
  const logPeriod = state.ui.logPeriod || "all";

  const activeCard = active ? `
    <div class="card stack">
      <div class="row space">
        <div>
          <div class="item-title">Actieve werklog</div>
          <div class="small mono">${esc(cname(active.customerId))} • gestart ${fmtClock(active.createdAt)}</div>
        </div>
        <span class="badge mono">Werk: ${durMsToHM(sumWorkMs(active))}</span>
      </div>
      <div class="small mono">Producten: ${fmtMoney(sumItemsAmount(active))}</div>

      <div class="active-log-actions" role="group" aria-label="Actieve werklog acties">
        <button class="icon-toggle icon-toggle-neutral ${currentOpenSegment(active)?.type === "break" ? "is-active icon-toggle-pause" : ""}" id="btnPause" title="${currentOpenSegment(active)?.type === "break" ? "Stop pauze" : "Start pauze"}" aria-label="${currentOpenSegment(active)?.type === "break" ? "Stop pauze" : "Start pauze"}">
          ${currentOpenSegment(active)?.type === "break"
            ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M8 6l10 6-10 6z" stroke-linejoin="round"/></svg>`
            : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M8 5v14M16 5v14" stroke-linecap="round"/></svg>`}
        </button>
        <button class="icon-toggle icon-toggle-stop" id="btnStop" title="Stop werklog" aria-label="Stop werklog">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>
        </button>
        <button class="icon-toggle icon-toggle-neutral ${ui.activeLogQuickAdd.open ? "is-active" : ""}" id="btnToggleQuickAdd" title="Product toevoegen" aria-label="Product toevoegen">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
        </button>
        <button class="icon-toggle icon-toggle-neutral" id="btnOpenActive" title="Open details" aria-label="Open details">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      ${ui.activeLogQuickAdd.open ? `<div class="active-quick-add"><select id="activeQuickProduct">${state.products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><input id="activeQuickQty" inputmode="decimal" value="${esc(ui.activeLogQuickAdd.qty || "1")}" placeholder="qty" /><button class="iconbtn" id="btnQuickAddProduct" title="Voeg product toe" aria-label="Voeg product toe"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg></button></div>` : ""}
    </div>
  ` : "";

  const periodDays = logPeriod === "7d" ? 7 : logPeriod === "30d" ? 30 : logPeriod === "90d" ? 90 : null;
  const minTimestamp = periodDays ? (now() - (periodDays * 86400000)) : null;

  const filteredLogs = [...state.logs]
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))
    .filter(l => {
      const status = getWorkLogStatus(l.id);
      const isPaid = status === "paid";
      if (logFilter === "open" && isPaid) return false;
      if (logFilter === "paid" && !isPaid) return false;

      if (logCustomerId !== "all" && l.customerId !== logCustomerId) return false;

      if (minTimestamp != null){
        const ts = l.createdAt || new Date(`${l.date}T00:00:00`).getTime();
        if (Number.isFinite(ts) && ts < minTimestamp) return false;
      }
      return true;
    });

  const logs = filteredLogs.slice(0, 20);
  const list = logs.length ? logs.map(l=>{
    const st = getWorkLogStatus(l.id);
    const cls = statusClassFromStatus(st);
    return `
      <div class="item ${cls}" data-open-log="${l.id}">
        <div class="item-main">
          <div class="item-title">${esc(cname(l.customerId))}</div>
          <div class="item-sub mono">${esc(l.date)} • Werk ${durMsToHM(sumWorkMs(l))} • Pauze ${durMsToHM(sumBreakMs(l))} • Producten ${fmtMoney(sumItemsAmount(l))}</div>
        </div>
        <div class="item-right">
          <span class="badge">${st==="free" ? "vrij" : (st==="linked"?"gekoppeld":st==="calculated"?"berekend":"betaald")}</span>
        </div>
      </div>
    `;
  }).join("") : `<div class="small">Geen logs voor deze filter.</div>`;

  const customerOptions = [`<option value="all">Alle klanten</option>`, ...state.customers
    .slice()
    .sort((a,b)=>(a.nickname||a.name||"").localeCompare(b.nickname||b.name||""))
    .map(c => `<option value="${esc(c.id)}" ${logCustomerId === c.id ? "selected" : ""}>${esc(c.nickname||c.name||"Klant")}</option>`)
  ].join("");

  el.innerHTML = `<div class="stack">${activeCard}<div class="card stack"><div class="log-filters"><div class="segmented" role="group" aria-label="Filter logs"><button class="seg-btn ${logFilter === "open" ? "is-active" : ""}" data-log-filter="open">Open</button><button class="seg-btn ${logFilter === "paid" ? "is-active" : ""}" data-log-filter="paid">Betaald</button><button class="seg-btn ${logFilter === "all" ? "is-active" : ""}" data-log-filter="all">Alles</button></div><button class="btn btn-filters ${showLogFilters ? "is-active" : ""}" id="btnToggleLogFilters" aria-expanded="${showLogFilters}"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M7 12h10M10 18h4" stroke-linecap="round"/></svg>Filters</button></div>${showLogFilters ? `<div class="log-filter-row"><div class="log-chip"><label for="logCustomerFilter">Klant</label><select id="logCustomerFilter">${customerOptions}</select></div><div class="log-chip"><label for="logPeriodFilter">Periode</label><select id="logPeriodFilter"><option value="7d" ${logPeriod === "7d" ? "selected" : ""}>7d</option><option value="30d" ${logPeriod === "30d" ? "selected" : ""}>30d</option><option value="90d" ${logPeriod === "90d" ? "selected" : ""}>90d</option><option value="all" ${logPeriod === "all" ? "selected" : ""}>Alles</option></select></div></div>` : ""}<div class="item-title">Recente logs</div><div class="list">${list}</div></div></div>`;

  // actions
  if (active){
    const defaultProduct = ui.activeLogQuickAdd.productId
      ? state.products.find(p => p.id === ui.activeLogQuickAdd.productId)
      : preferredWorkProduct();
    if (!ui.activeLogQuickAdd.productId && defaultProduct) ui.activeLogQuickAdd.productId = defaultProduct.id;
    if (!ui.activeLogQuickAdd.qty) ui.activeLogQuickAdd.qty = "1";

    $("#btnPause")?.addEventListener("click", ()=>{
      const seg = currentOpenSegment(active);
      if (!seg) openSegment(active,"work");
      else if (seg.type === "work"){ closeOpenSegment(active); openSegment(active,"break"); }
      else { closeOpenSegment(active); openSegment(active,"work"); }
      saveState(); render();
    });
    $("#btnStop")?.addEventListener("click", ()=>{
      closeOpenSegment(active);
      active.closedAt = now();
      state.activeLogId = null;
      ui.activeLogQuickAdd.open = false;
      saveState(); render();
    });
    $("#btnToggleQuickAdd")?.addEventListener("click", ()=>{
      ui.activeLogQuickAdd.open = !ui.activeLogQuickAdd.open;
      const fallback = preferredWorkProduct();
      if (!ui.activeLogQuickAdd.productId && fallback) ui.activeLogQuickAdd.productId = fallback.id;
      renderLogs();
    });
    $("#btnOpenActive")?.addEventListener("click", ()=> openSheet("log", active.id));

    const productSelect = $("#activeQuickProduct");
    if (productSelect){
      productSelect.value = ui.activeLogQuickAdd.productId || defaultProduct?.id || "";
      productSelect.addEventListener("change", ()=>{
        ui.activeLogQuickAdd.productId = productSelect.value || preferredWorkProduct()?.id || null;
      });
    }
    const qtyInput = $("#activeQuickQty");
    qtyInput?.addEventListener("input", ()=>{
      ui.activeLogQuickAdd.qty = qtyInput.value;
    });
    $("#btnQuickAddProduct")?.addEventListener("click", ()=>{
      const productId = productSelect?.value || preferredWorkProduct()?.id || null;
      const product = productId ? getProduct(productId) : preferredWorkProduct();
      const qty = qtyInput?.value || ui.activeLogQuickAdd.qty || "1";
      const ok = addProductToLog(active.id, product?.id, qty, product?.unitPrice ?? 0);
      if (!ok){
        alert("Ongeldige hoeveelheid. Vul een qty groter dan 0 in.");
        return;
      }
      ui.activeLogQuickAdd.productId = product?.id || null;
      ui.activeLogQuickAdd.qty = "1";
      saveState();
      render();
    });
  }

  el.querySelectorAll("[data-open-log]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("log", x.getAttribute("data-open-log")));
  });
  el.querySelectorAll("[data-log-filter]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.ui.logFilter = btn.getAttribute("data-log-filter") || "open";
      saveState();
      renderLogs();
    });
  });
  $("#btnToggleLogFilters")?.addEventListener("click", ()=>{
    state.ui.showLogFilters = !state.ui.showLogFilters;
    saveState();
    renderLogs();
  });
  $("#logCustomerFilter")?.addEventListener("change", ()=>{
    state.ui.logCustomerId = $("#logCustomerFilter").value || "all";
    saveState();
    renderLogs();
  });
  $("#logPeriodFilter")?.addEventListener("change", ()=>{
    state.ui.logPeriod = $("#logPeriodFilter").value || "all";
    saveState();
    renderLogs();
  });
}

function renderCustomers(){
  const el = $("#tab-customers");
  const list = state.customers.map(c => `
    <div class="item" data-open-customer="${c.id}">
      <div class="item-main">
        <div class="item-title">${esc(c.nickname||c.name||"Klant")}</div>
        <div class="item-sub">${esc(c.address||"")}</div>
      </div>
      <div class="item-right"><span class="badge">open</span></div>
    </div>
  `).join("");

  el.innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="row space">
          <div class="item-title">Klanten</div>
          <button class="btn" id="btnNewCustomer">Nieuwe klant</button>
        </div>
        <div class="list">${list || `<div class="small">Nog geen klanten.</div>`}</div>
      </div>
    </div>
  `;

  $("#btnNewCustomer")?.addEventListener("click", ()=>{
    const c = { id: uid(), nickname:"", name:"", address:"", createdAt: now() };
    state.customers.unshift(c);
    saveState();
    openSheet("customer", c.id);
  });

  el.querySelectorAll("[data-open-customer]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("customer", x.getAttribute("data-open-customer")));
  });
}

function renderProducts(){
  const el = $("#tab-products");
  const list = state.products.map(p => `
    <div class="item" data-open-product="${p.id}">
      <div class="item-main">
        <div class="item-title">${esc(p.name)}</div>
        <div class="item-sub mono">${esc(p.unit)} • ${fmtMoney(p.unitPrice)} • btw ${(Number(p.vatRate||0)*100).toFixed(0)}% • default ${esc(p.defaultBucket||"invoice")}</div>
      </div>
      <div class="item-right"><span class="badge">open</span></div>
    </div>
  `).join("");

  el.innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="row space">
          <div class="item-title">Producten</div>
          <button class="btn" id="btnNewProduct">Nieuw product</button>
        </div>
        <div class="list">${list || `<div class="small">Nog geen producten.</div>`}</div>
      </div>
    </div>
  `;

  $("#btnNewProduct")?.addEventListener("click", ()=>{
    const p = { id: uid(), name:"", unit:"keer", unitPrice:0, vatRate:0.21, defaultBucket:"invoice" };
    state.products.unshift(p);
    saveState();
    openSheet("product", p.id);
  });

  el.querySelectorAll("[data-open-product]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("product", x.getAttribute("data-open-product")));
  });
}

function renderSettings(){
  const el = $("#tab-settings");
  const demoCounts = {
    customers: state.customers.filter(c => c.demo).length,
    logs: state.logs.filter(l => l.demo).length,
    settlements: state.settlements.filter(a => a.demo).length,
  };

  el.innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="item-title">Algemeen</div>
        <div class="row">
          <div style="flex:1; min-width:170px;">
            <label>Uurtarief</label>
            <input id="settingHourly" inputmode="decimal" value="${esc(String(state.settings.hourlyRate ?? 38))}" />
          </div>
          <div style="flex:1; min-width:170px;">
            <label>BTW %</label>
            <input id="settingVat" inputmode="decimal" value="${esc(String(round2(Number(state.settings.vatRate || 0) * 100)))}" />
          </div>
        </div>
        <button class="btn primary" id="saveSettings">Opslaan</button>
      </div>

      <div class="card stack">
        <div class="item-title">Demo data</div>
        <div class="small mono">Demo records: klanten ${demoCounts.customers} • logs ${demoCounts.logs} • afrekeningen ${demoCounts.settlements}</div>
        <button class="btn" id="fillDemoBtn">Vul demo data (3 maanden)</button>
        <button class="btn danger" id="clearDemoBtn">Wis demo data</button>
      </div>

      <div class="card stack">
        <div class="item-title">Geavanceerd</div>
        <button class="btn danger" id="resetAllBtn">Reset alles</button>
      </div>
    </div>
  `;

  $("#saveSettings").onclick = ()=>{
    const hourly = Number(String($("#settingHourly").value).replace(",", ".") || "0");
    const vatPct = Number(String($("#settingVat").value).replace(",", ".") || "0");
    state.settings.hourlyRate = round2(hourly);
    state.settings.vatRate = round2(vatPct / 100);
    saveState();
    alert("Instellingen opgeslagen.");
    render();
  };

  $("#fillDemoBtn").onclick = ()=>{
    if (!confirmAction("Demo data toevoegen voor 3 maanden?")) return;
    const changed = seedDemoMonths(state, { months: 3, force: false });
    if (changed){
      saveState();
      render();
    } else {
      alert("Demo data bestaat al. Wis eerst demo data om opnieuw te seeden.");
    }
  };

  $("#clearDemoBtn").onclick = ()=>{
    const demoRecordCount = state.customers.filter(c => c.demo).length + state.logs.filter(l => l.demo).length + state.settlements.filter(s => s.demo).length;
    if (!demoRecordCount){
      alert("Geen demo data om te wissen.");
      return;
    }
    if (!confirmAction("Alle demo records wissen? Echte data blijft behouden.")) return;
    clearDemoData(state);
    closeSheet();
    saveState();
    render();
  };

  $("#resetAllBtn").onclick = ()=>{
    if (!confirmAction("Reset alles? Dit wist alle lokale data.")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  };
}

function renderSettlements(){
  const el = $("#tab-settlements");
  const list = [...state.settlements].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(s=>{
    const pay = settlementPaymentState(s);
    const cls = settlementColorClass(s);
    const grand = round2(pay.invoiceTotal + pay.cashTotal);
    const invoicePillClass = s.invoicePaid ? "pill-paid" : "pill-open";
    const cashPillClass = s.cashPaid ? "pill-paid" : "pill-open";
    const meta = [esc(s.date || ""), `logs ${(s.logIds||[]).length}`].filter(Boolean).join(" • ");

    const pills = [
      pay.hasInvoice ? `<div class="pill ${invoicePillClass} mono">Factuur ${s.invoicePaid ? "paid" : "open"}</div>` : "",
      pay.hasCash ? `<div class="pill ${cashPillClass} mono">Cash ${s.cashPaid ? "paid" : "open"}</div>` : ""
    ].filter(Boolean).join("");

    return `
      <div class="item item-compact settlement-row ${cls}" data-open-settlement="${s.id}">
        <div class="settlement-row-top">
          <div class="item-title">${esc(cname(s.customerId))}</div>
          <div class="badge mono amount-badge">${fmtMoney(grand)}</div>
        </div>
        <div class="settlement-row-bottom">
          <div class="item-sub mono">${meta}</div>
          <div class="item-right settlement-pills">${pills}</div>
        </div>
      </div>
    `;
  }).join("");

  el.innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="row space">
          <div class="item-title">Afrekenboek</div>
          <button class="btn" id="btnNewSettlement">Nieuwe afrekening</button>
        </div>
        <div class="list">${list || `<div class="small">Nog geen afrekeningen.</div>`}</div>
      </div>
    </div>
  `;

  $("#btnNewSettlement")?.addEventListener("click", ()=>{
    // create empty settlement; user selects logs inside detail
    const s = {
      id: uid(),
      customerId: state.customers[0]?.id || "",
      date: todayISO(),
      createdAt: now(),
      logIds: [],
      lines: [],
      status: "draft",
      invoicePaid: false,
      cashPaid: false
    };
    state.settlements.unshift(s);
    saveState();
    openSheet("settlement", s.id);
  });

  el.querySelectorAll("[data-open-settlement]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("settlement", x.getAttribute("data-open-settlement")));
  });
}

// ---------- Sheet rendering ----------
function renderSheet(){
  const active = currentView();
  const actions = $("#sheetActions");
  const body = $("#sheetBody");
  if (!actions || !body) return;
  actions.innerHTML = "";
  body.innerHTML = "";

  if (active.view === "customerDetail") renderCustomerSheet(active.id);
  if (active.view === "productDetail") renderProductSheet(active.id);
  if (active.view === "logDetail") renderLogSheet(active.id);
  if (active.view === "settlementDetail") renderSettlementSheet(active.id);
  if (active.view === "newLog") renderNewLogSheet();
}

function renderNewLogSheet(){
  const active = state.activeLogId ? state.logs.find(l => l.id === state.activeLogId) : null;
  const customerOptions = state.customers.map(c => `<option value="${c.id}">${esc(c.nickname||c.name||"Klant")}</option>`).join("");

  $("#sheetTitle").textContent = "Nieuwe werklog";
  $("#sheetBody").innerHTML = `
    <div class="stack">
      ${active ? `
      <div class="card stack">
        <div class="item-title">Actieve werklog</div>
        <div class="small mono">${esc(cname(active.customerId))} • gestart ${fmtClock(active.createdAt)}</div>
        <button class="btn" id="btnOpenActiveFromNew">Open actieve werklog</button>
      </div>
      ` : ""}
      <div class="card stack">
        <div>
          <label>Klant</label>
          <select id="startCustomer">${customerOptions || `<option value="">(Geen klanten)</option>`}</select>
        </div>
        <button class="btn primary" id="btnStartFromSheet" ${(state.customers.length && !active) ? "" : "disabled"}>Start werk</button>
        ${state.customers.length ? "" : `<div class="small">Maak eerst een klant aan.</div>`}
      </div>
    </div>
  `;

  $("#btnStartFromSheet")?.addEventListener("click", ()=>{
    const cid = $("#startCustomer")?.value;
    startWorkLog(cid);
  });
  $("#btnOpenActiveFromNew")?.addEventListener("click", ()=>{
    if (!active) return;
    openSheet("log", active.id);
  });
}

function renderCustomerSheet(id){
  const c = getCustomer(id);
  if (!c){ closeSheet(); return; }
  $("#sheetTitle").textContent = "Klant";

  const logs = state.logs.filter(l => l.customerId === c.id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const settlements = state.settlements.filter(s => s.customerId === c.id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  $("#sheetActions").innerHTML = `
    <button class="btn danger" id="delCustomer">Verwijder</button>
  `;

  $("#sheetBody").innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="item-title">Bewerken</div>
        <div class="row">
          <div style="flex:1; min-width:220px;">
            <label>Bijnaam</label>
            <input id="cNick" value="${esc(c.nickname||"")}" />
          </div>
          <div style="flex:1; min-width:220px;">
            <label>Naam</label>
            <input id="cName" value="${esc(c.name||"")}" />
          </div>
        </div>
        <div>
          <label>Adres</label>
          <input id="cAddr" value="${esc(c.address||"")}" />
        </div>
        <button class="btn primary" id="saveCustomer">Opslaan</button>
      </div>

      <div class="card stack">
        <div class="item-title">Werklogs</div>
        <div class="list">
          ${logs.slice(0,20).map(l=>{
            const cls = statusClassFromStatus(getWorkLogStatus(l.id));
            return `
              <div class="item ${cls}" data-open-log="${l.id}">
                <div class="item-main">
                  <div class="item-title">${esc(l.date)}</div>
                  <div class="item-sub mono">Werk ${durMsToHM(sumWorkMs(l))} • Producten ${fmtMoney(sumItemsAmount(l))}</div>
                </div>
                <div class="item-right"><span class="badge">open</span></div>
              </div>
            `;
          }).join("") || `<div class="small">Geen logs.</div>`}
        </div>
      </div>

      <div class="card stack">
        <div class="item-title">Afrekeningen</div>
        <div class="list">
          ${settlements.slice(0,20).map(s=>{
            const paid = isSettlementPaid(s);
            const cls = settlementColorClass(s);
            const totInv = bucketTotals(s.lines,"invoice");
            const totCash = bucketTotals(s.lines,"cash");
            const grand = round2(totInv.total + totCash.subtotal);
            const label = paid ? "betaald" : (s.status === "calculated" ? "berekend" : "draft/open");
            return `
              <div class="item ${cls}" data-open-settlement="${s.id}">
                <div class="item-main">
                  <div class="item-title">${esc(s.date)} • ${label}</div>
                  <div class="item-sub mono">logs ${(s.logIds||[]).length} • totaal ${fmtMoney(grand)}</div>
                </div>
                <div class="item-right"><span class="badge">${label}</span></div>
              </div>
            `;
          }).join("") || `<div class="small">Geen afrekeningen.</div>`}
        </div>
      </div>
    </div>
  `;

  $("#saveCustomer").onclick = ()=>{
    c.nickname = ($("#cNick").value||"").trim();
    c.name = ($("#cName").value||"").trim();
    c.address = ($("#cAddr").value||"").trim();
    saveState(); render();
    alert("Opgeslagen.");
  };

  $("#delCustomer").onclick = ()=>{
    const hasLogs = state.logs.some(l => l.customerId === c.id);
    const hasSet = state.settlements.some(s => s.customerId === c.id);
    if (hasLogs || hasSet){ alert("Kan niet verwijderen: klant heeft logs/afrekeningen."); return; }
    if (!confirmDelete(`Klant: ${c.nickname||c.name||""}`)) return;
    state.customers = state.customers.filter(x => x.id !== c.id);
    saveState(); closeSheet();
  };

  $("#sheetBody").querySelectorAll("[data-open-log]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("log", x.getAttribute("data-open-log")));
  });
  $("#sheetBody").querySelectorAll("[data-open-settlement]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("settlement", x.getAttribute("data-open-settlement")));
  });
}

function renderProductSheet(id){
  const p = getProduct(id);
  if (!p){ closeSheet(); return; }
  $("#sheetTitle").textContent = "Product";
  $("#sheetActions").innerHTML = `<button class="btn danger" id="delProduct">Verwijder</button>`;

  const usedInLogs = state.logs.filter(l => (l.items||[]).some(it => it.productId === p.id)).slice(0,10);
  const usedInSet = state.settlements.filter(s => (s.lines||[]).some(li => li.productId === p.id)).slice(0,10);

  $("#sheetBody").innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="item-title">Bewerken</div>
        <div class="row">
          <div style="flex:2; min-width:220px;">
            <label>Naam</label>
            <input id="pName" value="${esc(p.name||"")}" />
          </div>
          <div style="flex:1; min-width:140px;">
            <label>Eenheid</label>
            <input id="pUnit" value="${esc(p.unit||"keer")}" />
          </div>
        </div>
        <div class="row">
          <div style="flex:1; min-width:160px;">
            <label>Prijs per eenheid</label>
            <input id="pPrice" inputmode="decimal" value="${esc(String(p.unitPrice ?? 0))}" />
          </div>
          <div style="flex:1; min-width:160px;">
            <label>BTW (bv 0.21)</label>
            <input id="pVat" inputmode="decimal" value="${esc(String(p.vatRate ?? 0.21))}" />
          </div>
          <div style="flex:1; min-width:160px;">
            <label>Default</label>
            <select id="pBucket">
              <option value="invoice" ${p.defaultBucket==="invoice"?"selected":""}>factuur</option>
              <option value="cash" ${p.defaultBucket==="cash"?"selected":""}>cash</option>
            </select>
          </div>
        </div>
        <button class="btn primary" id="saveProduct">Opslaan</button>
      </div>

      <div class="card stack">
        <div class="item-title">Gebruikt in logs (recent)</div>
        <div class="list">
          ${usedInLogs.map(l=>`
            <div class="item" data-open-log="${l.id}">
              <div class="item-main">
                <div class="item-title">${esc(cname(l.customerId))}</div>
                <div class="item-sub mono">${esc(l.date)} • ${durMsToHM(sumWorkMs(l))}</div>
              </div>
              <div class="item-right"><span class="badge">open</span></div>
            </div>
          `).join("") || `<div class="small">Nog niet gebruikt.</div>`}
        </div>
      </div>

      <div class="card stack">
        <div class="item-title">Gebruikt in afrekeningen (recent)</div>
        <div class="list">
          ${usedInSet.map(s=>`
            <div class="item" data-open-settlement="${s.id}">
              <div class="item-main">
                <div class="item-title">${esc(cname(s.customerId))}</div>
                <div class="item-sub mono">${esc(s.date)} • ${statusLabelNL(s.status)}</div>
              </div>
              <div class="item-right"><span class="badge">open</span></div>
            </div>
          `).join("") || `<div class="small">Nog niet gebruikt.</div>`}
        </div>
      </div>
    </div>
  `;

  $("#saveProduct").onclick = ()=>{
    p.name = ($("#pName").value||"").trim();
    p.unit = ($("#pUnit").value||"").trim() || "keer";
    p.unitPrice = Number(String($("#pPrice").value).replace(",", ".") || "0");
    p.vatRate = Number(String($("#pVat").value).replace(",", ".") || "0.21");
    p.defaultBucket = $("#pBucket").value;
    saveState(); render();
    alert("Opgeslagen.");
  };

  $("#delProduct").onclick = ()=>{
    const used = state.logs.some(l => (l.items||[]).some(it => it.productId === p.id))
      || state.settlements.some(s => (s.lines||[]).some(li => li.productId === p.id));
    if (used){ alert("Kan niet verwijderen: product is gebruikt."); return; }
    if (!confirmDelete(`Product: ${p.name}`)) return;
    state.products = state.products.filter(x => x.id !== p.id);
    saveState(); closeSheet();
  };

  $("#sheetBody").querySelectorAll("[data-open-log]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("log", x.getAttribute("data-open-log")));
  });
  $("#sheetBody").querySelectorAll("[data-open-settlement]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("settlement", x.getAttribute("data-open-settlement")));
  });
}

function renderLogSheet(id){
  const log = state.logs.find(l => l.id === id);
  if (!log){ closeSheet(); return; }
  $("#sheetTitle").textContent = "Werklog";
  const af = settlementForLog(log.id);
  const locked = false;
  $("#sheetActions").innerHTML = "";

  const settlementOptions = buildSettlementSelectOptions(log.customerId, af?.id);

  const visual = getLogVisualState(log);
  const statusPillClass = visual.state === "paid" ? "pill-paid" : visual.state === "calculated" ? "pill-calc" : visual.state === "linked" ? "pill-open" : "pill-neutral";
  const statusLabel = visual.state === "free" ? "vrij" : visual.state === "linked" ? "gekoppeld" : visual.state === "calculated" ? "berekend" : "betaald";
  const isEditing = state.ui.editLogId === log.id;

  function renderSegments(currentLog, editing){
    return `
      <section class="compact-section stack">
        <div class="row space">
          <div class="item-title">Segments</div>
          <div class="rowtight">
            <button class="iconbtn iconbtn-sm" id="toggleEditLog" type="button" title="${editing ? "Klaar" : "Bewerk"}" aria-label="${editing ? "Klaar" : "Bewerk"}">
              ${editing
                ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 12l5 5 9-9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 20h9" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" stroke-linejoin="round"/></svg>`}
            </button>
            ${editing ? `<button class="btn" id="addSegment" type="button">+ segment</button>` : ""}
          </div>
        </div>
        <div class="compact-lines">
          ${(currentLog.segments||[]).map(s=>{
            if (!editing){
              return `<div class="segment-row segment-row-static mono">${s.type === "break" ? "Pauze" : "Werk"} ${s.start ? fmtClock(s.start) : "…"}–${s.end ? fmtClock(s.end) : "…"}</div>`;
            }
            const isOpen = ui.logDetailSegmentEditId === s.id;
            return `
              <div class="segment-row ${isOpen ? "is-open" : ""}">
                <button class="segment-row-btn mono" type="button" data-toggle-segment="${s.id}">
                  ${s.type === "break" ? "Pauze" : "Werk"} ${s.start ? fmtClock(s.start) : "…"}–${s.end ? fmtClock(s.end) : "…"}
                </button>
                ${isOpen ? `
                  <div class="segment-editor" data-segment-editor="${s.id}">
                    <div class="segment-grid">
                      <label>Start<input type="time" value="${esc(fmtTimeInput(s.start))}" data-edit-segment="${s.id}" data-field="start" /></label>
                      <label>Einde<input type="time" value="${esc(fmtTimeInput(s.end))}" data-edit-segment="${s.id}" data-field="end" /></label>
                      <label>Type
                        <select data-edit-segment="${s.id}" data-field="type">
                          <option value="work" ${s.type === "work" ? "selected" : ""}>work</option>
                          <option value="break" ${s.type === "break" ? "selected" : ""}>break</option>
                        </select>
                      </label>
                    </div>
                    <button class="iconbtn iconbtn-sm danger" type="button" data-del-segment="${s.id}" title="Verwijder segment" aria-label="Verwijder segment">
                      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 6h18" stroke-linecap="round"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                ` : ""}
              </div>
            `;
          }).join("") || `<div class="small">Geen segments.</div>`}
        </div>
      </section>
    `;
  }

  $("#sheetBody").innerHTML = `
    <div class="stack log-detail-compact">
      <section class="compact-section compact-row">
        <label>Afrekening</label>
        <select id="logSettlement" ${locked ? "disabled" : ""}>
          ${settlementOptions}
        </select>
      </section>

      ${renderSegments(log, isEditing)}

      <section class="compact-section stack">
        <div class="row space">
          <div class="item-title">Producten</div>
          <span class="small mono">Totaal ${fmtMoney(sumItemsAmount(log))}</span>
        </div>
        <div class="log-lines-wrap">
          ${renderLogItems(log)}
        </div>
      </section>

      <section class="compact-section">
        <label>Notitie</label>
        <input id="logNote" value="${esc(log.note||"")}" />
      </section>

      <section class="compact-section log-detail-footer-actions">
        <span class="pill ${statusPillClass}">${statusLabel}</span>
        <button class="btn danger" id="delLog">Verwijder</button>
      </section>
    </div>
  `;

  // wire (autosave)
  $("#logNote").addEventListener("change", ()=>{
    log.note = ($("#logNote").value||"").trim();
    saveState();
    render();
  });

  $("#toggleEditLog")?.addEventListener("click", ()=> toggleEditLog(log.id));

  $("#addSegment")?.addEventListener("click", ()=>{
    log.segments = log.segments || [];
    const seg = { id: uid(), type: "work", start: null, end: null };
    log.segments.push(seg);
    ui.logDetailSegmentEditId = seg.id;
    saveState();
    renderSheet();
  });

  $("#sheetBody").querySelectorAll("[data-toggle-segment]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const segmentId = btn.getAttribute("data-toggle-segment");
      ui.logDetailSegmentEditId = ui.logDetailSegmentEditId === segmentId ? null : segmentId;
      renderSheet();
    });
  });

  $("#sheetBody").querySelectorAll("[data-edit-segment]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      const segmentId = inp.getAttribute("data-edit-segment");
      const field = inp.getAttribute("data-field");
      const seg = (log.segments||[]).find(x => x.id === segmentId);
      if (!seg) return;

      if (field === "type"){
        if (!["work", "break"].includes(inp.value)){
          alert('Type moet "work" of "break" zijn.');
          renderSheet();
          return;
        }
        seg.type = inp.value;
      }

      if (field === "start" || field === "end"){
        const nextStart = field === "start" ? parseLogTimeToMs(log.date, inp.value) : seg.start;
        const nextEnd = field === "end" ? parseLogTimeToMs(log.date, inp.value) : seg.end;
        if (nextStart == null || nextEnd == null || !(nextEnd > nextStart)){
          alert("Segment ongeldig: einde moet later zijn dan start.");
          renderSheet();
          return;
        }
        seg.start = nextStart;
        seg.end = nextEnd;
      }

      saveState();
      renderSheet();
      render();
    });
  });

  $("#sheetBody").querySelectorAll("[data-del-segment]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const segmentId = btn.getAttribute("data-del-segment");
      if (!confirmDelete("Segment verwijderen")) return;
      log.segments = (log.segments||[]).filter(s => s.id !== segmentId);
      if (ui.logDetailSegmentEditId === segmentId) ui.logDetailSegmentEditId = null;
      saveState();
      renderSheet();
      render();
    });
  });

  $("#sheetBody").querySelectorAll("[data-del-log-item]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const itemId = btn.getAttribute("data-del-log-item");
      if (!confirmDelete("Item verwijderen")) return;
      log.items = (log.items||[]).filter(it => it.id !== itemId);
      saveState(); renderSheet(); render();
    });
  });

  $("#sheetBody").querySelectorAll("[data-edit-log-item]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      const itemId = inp.getAttribute("data-edit-log-item");
      const field = inp.getAttribute("data-field");
      const it = (log.items||[]).find(x => x.id === itemId);
      if (!it) return;
      if (field === "qty") it.qty = inp.value === "" ? null : Number(String(inp.value).replace(",", ".") || "0");
      if (field === "unitPrice") it.unitPrice = inp.value === "" ? null : Number(String(inp.value).replace(",", ".") || "0");
      if (field === "productId"){
        it.productId = inp.value;
        const p = getProduct(inp.value);
        if (p && (it.unitPrice == null || it.unitPrice === 0)) it.unitPrice = Number(p.unitPrice||0);
      }
      saveState(); renderSheet(); render();
    });
  });

  $("#addProductItem").addEventListener("click", ()=>{
    const workProduct = state.products.find(p => (p.name||"").trim().toLowerCase() === "werk") || state.products[0] || null;
    if (!workProduct) return;
    log.items = log.items || [];
    log.items.push({ id: uid(), productId: workProduct.id, qty: null, unitPrice: Number(workProduct.unitPrice||0), note:"" });
    saveState();
    renderSheet();
    render();
  });

  $("#logSettlement").onchange = ()=>{
    if (locked) return;
    const v = $("#logSettlement").value;

    // remove from any settlement first
    for (const s of state.settlements){
      s.logIds = (s.logIds||[]).filter(x => x !== log.id);
    }

    if (v === "none"){
      // nothing
    } else if (v === "new"){
      const s = {
        id: uid(),
        customerId: log.customerId,
        date: todayISO(),
        createdAt: now(),
        logIds: [log.id],
        lines: [],
        status: "draft",
        invoicePaid: false,
        cashPaid: false
      };
      // compute default lines
      const computed = computeSettlementFromLogs(s.customerId, s.logIds);
      s.lines = computed.lines;
      state.settlements.unshift(s);
      saveState();
      renderSheet();
      return;
    } else {
      const s = state.settlements.find(x => x.id === v);
      if (s){
        s.logIds = Array.from(new Set([...(s.logIds||[]), log.id]));
        // refresh lines (simple approach): recompute, but preserve existing bucket choices if possible
        const prev = new Map((s.lines||[]).map(li => [li.productId+"|"+li.description, li.bucket]));
        const computed = computeSettlementFromLogs(s.customerId, s.logIds);
        s.lines = computed.lines.map(li => ({
          ...li,
          bucket: prev.get(li.productId+"|"+li.description) || li.bucket
        }));
      }
    }
    saveState(); renderSheet(); render();
  };

  $("#delLog").onclick = ()=>{
    if (state.activeLogId === log.id){ alert("Stop eerst je actieve log."); return; }
    if (af){ alert("Ontkoppel eerst van afrekening (of verwijder afrekening)."); return; }
    if (!confirmDelete(`Werklog ${log.date} — ${cname(log.customerId)}`)) return;
    state.logs = state.logs.filter(x => x.id !== log.id);
    saveState(); closeSheet();
  };
}

function renderLogItems(log){
  const productOptions = state.products
    .map(p => `<option value="${p.id}">${esc(p.name)}${p.unit ? ` (${esc(p.unit)})` : ""}</option>`)
    .join("");

  const rows = (log.items||[]).map(it=>{
    const productId = it.productId || state.products[0]?.id || "";
    const qtyValue = it.qty == null ? "" : String(it.qty);
    const unitPriceValue = it.unitPrice == null ? "" : String(it.unitPrice);
    return `
      <div class="log-item-row">
        <div class="log-item-row-top">
          <select class="settlement-cell-input" data-edit-log-item="${it.id}" data-field="productId">
            ${productOptions.replace(`value="${productId}"`, `value="${productId}" selected`)}
          </select>
          <button class="iconbtn settlement-trash" data-del-log-item="${it.id}" title="Verwijder">
            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6l1 16h10l1-16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="log-item-row-bottom">
          <div class="log-item-cell">
            <label>qty</label>
            <input class="settlement-cell-input num" data-edit-log-item="${it.id}" data-field="qty" inputmode="decimal" value="${esc(qtyValue)}" />
          </div>
          <div class="log-item-cell">
            <label>€/eenheid</label>
            <input class="settlement-cell-input num" data-edit-log-item="${it.id}" data-field="unitPrice" inputmode="decimal" value="${esc(unitPriceValue)}" />
          </div>
          <div class="log-item-total num mono">${fmtMoney((Number(it.qty)||0)*(Number(it.unitPrice)||0))}</div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="log-items-list">
      ${rows || `<div class="small">Nog geen producten.</div>`}
      <button class="btn" id="addProductItem" type="button">+ Product</button>
    </div>
  `;
}

function buildSettlementSelectOptions(customerId, currentSettlementId){
  const options = [];
  options.push(`<option value="none"${!currentSettlementId?" selected":""}>Niet gekoppeld</option>`);
  const list = state.settlements
    .filter(s => s.customerId === customerId)
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  for (const s of list){
    const label = `${s.date} — ${statusLabelNL(s.status)} — logs ${(s.logIds||[]).length}`;
    options.push(`<option value="${s.id}" ${s.id===currentSettlementId?"selected":""}>${esc(label)}</option>`);
  }
  options.push(`<option value="new">+ Nieuwe afrekening aanmaken…</option>`);
  return options.join("");
}

function settlementLogbookSummary(s){
  const linkedLogs = (s.logIds||[])
    .map(id => state.logs.find(l => l.id === id))
    .filter(Boolean);
  const totalWorkMs = linkedLogs.reduce((acc, log) => acc + sumWorkMs(log), 0);
  const totalProductCosts = round2(linkedLogs.reduce((acc, log) => acc + sumItemsAmount(log), 0));
  const hourly = Number(state.settings.hourlyRate||0);
  const totalLogPrice = round2((totalWorkMs / 3600000) * hourly + totalProductCosts);
  return { linkedCount: linkedLogs.length, totalWorkMs, totalProductCosts, totalLogPrice };
}

function renderIconToggle({ id, active, variant, icon, label }){
  const classes = ["icon-toggle", `icon-toggle-${variant}`];
  if (active) classes.push("is-active");
  return `
    <button
      class="${classes.join(" ")}"
      id="${id}"
      type="button"
      aria-label="${esc(label)}"
      title="${esc(label)}"
    >
      ${icon}
    </button>
  `;
}

function renderSettlementSheet(id){
  const s = state.settlements.find(x => x.id === id);
  if (!s){ closeSheet(); return; }
  if (!("invoicePaid" in s)) s.invoicePaid = false;
  if (!("cashPaid" in s)) s.cashPaid = false;
  ensureDefaultSettlementLines(s);
  $('#sheetTitle').textContent = 'Afrekening';

  const customerOptions = state.customers.map(c => `<option value="${c.id}" ${c.id===s.customerId?"selected":""}>${esc(c.nickname||c.name||"Klant")}</option>`).join('');

  const availableLogs = state.logs
    .filter(l => l.customerId === s.customerId)
    .filter(log => {
      const isInThisSettlement = (s.logIds || []).includes(log.id);
      const linkedElsewhere = isLogLinkedElsewhere(log.id, s.id);
      return isInThisSettlement || !linkedElsewhere;
    })
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  const pay = settlementPaymentState(s);
  const invT = pay.invoiceTotals;
  const cashT = pay.cashTotals;
  const grand = round2(pay.invoiceTotal + pay.cashTotal);
  const summary = settlementLogbookSummary(s);
  const linkedAccentClass = pay.isPaid
    ? "linked-log-accent-paid"
    : (s.status === "calculated" ? "linked-log-accent-calculated" : "");

  $('#sheetActions').innerHTML = `
    <button class="btn danger" id="delSettlement">Verwijder</button>
  `;

  $('#sheetBody').innerHTML = `
    <div class="stack">
      <div class="card stack settlement-header-card">
        <div class="row space settlement-header-top">
          <div>
            <div class="item-title">${esc(cname(s.customerId))}</div>
            <div class="small mono">${esc(s.date)} • #${esc((s.id||'').slice(0,8))}</div>
          </div>
          <div class="rowtight settlement-header-toggles" role="group" aria-label="Afrekening status">
            ${renderIconToggle({
              id: "toggleCalculated",
              active: s.status === "calculated",
              variant: "calculated",
              label: "Afrekening berekend",
              icon: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
            })}
            ${pay.hasInvoice ? renderIconToggle({
              id: "toggleInvoicePaid",
              active: s.invoicePaid,
              variant: "paid",
              label: "Factuur betaald",
              icon: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 3v3h3M9 11h6M9 15h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
            }) : ""}
            ${pay.hasCash ? renderIconToggle({
              id: "toggleCashPaid",
              active: s.cashPaid,
              variant: "paid",
              label: "Cash betaald",
              icon: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 12h6M12 9v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
            }) : ""}
          </div>
        </div>

        <div class="row settlement-meta-row">
          <div style="flex:2; min-width:220px;">
            <label>Klant</label>
            <select id="sCustomer">${customerOptions}</select>
          </div>
          <div style="flex:1; min-width:160px;">
            <label>Datum</label>
            <input id="sDate" value="${esc(s.date||todayISO())}" />
          </div>
          <div class="badge mono">${pay.isPaid ? 'BETAALD' : 'OPEN'} • ${fmtMoney(grand)}</div>
        </div>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Gekoppelde logs</div>
        </div>
        <div class="list" id="sLogs">
          ${availableLogs.slice(0,30).map(l=>{
            const checked = (s.logIds||[]).includes(l.id) ? 'checked' : '';
            const cls = linkedAccentClass;
            return `
              <label class="item item-compact ${cls}" style="cursor:pointer;">
                <div class="item-main">
                  <div class="item-title">${esc(l.date)} • ${durMsToHM(sumWorkMs(l))}</div>
                  <div class="item-sub mono">Producten ${fmtMoney(sumItemsAmount(l))}</div>
                </div>
                <div class="item-right">
                  <input type="checkbox" data-logpick="${l.id}" ${checked}/>
                </div>
              </label>
            `;
          }).join('') || `<div class="small">Geen beschikbare logs</div>`}
        </div>
        <button class="btn" id="btnRecalc">Herbereken uit logs</button>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Logboek totaal</div>
          <div class="small mono">${summary.linkedCount} logs</div>
        </div>
        <div class="row">
          <div class="badge mono">Werkduur ${durMsToHM(summary.totalWorkMs)}</div>
          <div class="badge mono">Productkosten ${fmtMoney(summary.totalProductCosts)}</div>
          <div class="badge mono">Logboek prijs ${fmtMoney(summary.totalLogPrice)}</div>
        </div>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Factuur</div>
          <div class="item-title mono">${fmtMoney(pay.invoiceTotal)}</div>
        </div>
        <div class="settlement-lines-wrap">
          ${renderLinesTable(s, 'invoice')}
        </div>
        <div class="row settlement-line-actions">
          <button class="btn" id="addInvoiceLine">+ lijn</button>
        </div>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Cash</div>
          <div class="item-title mono">${fmtMoney(pay.cashTotal)}</div>
        </div>
        <div class="settlement-lines-wrap">
          ${renderLinesTable(s, 'cash')}
        </div>
        <div class="row settlement-line-actions">
          <button class="btn" id="addCashLine">+ lijn</button>
        </div>
      </div>
    </div>
  `;

  $('#delSettlement').onclick = ()=>{
    if (!confirmDelete(`Afrekening ${s.date} — ${cname(s.customerId)}`)) return;
    state.settlements = state.settlements.filter(x => x.id !== s.id);
    saveState(); closeSheet();
  };

  $('#toggleCalculated').onclick = ()=>{
    const next = s.status !== 'calculated';
    if (!confirmAction(next ? 'Markeren als berekend?' : 'Terug naar open?')) return;
    s.status = next ? 'calculated' : 'draft';
    saveState(); renderSheet(); render();
  };

  const invoiceToggle = $('#toggleInvoicePaid');
  if (invoiceToggle){
    invoiceToggle.onclick = ()=>{
      const next = !s.invoicePaid;
      if (!confirmAction(next ? 'Factuur als betaald?' : 'Factuur terug open?')) return;
      s.invoicePaid = next;
      saveState(); renderSheet(); render();
    };
  }

  const cashToggle = $('#toggleCashPaid');
  if (cashToggle){
    cashToggle.onclick = ()=>{
      const next = !s.cashPaid;
      if (!confirmAction(next ? 'Cash als betaald?' : 'Cash terug open?')) return;
      s.cashPaid = next;
      saveState(); renderSheet(); render();
    };
  }

  $('#sCustomer').onchange = ()=>{
    s.customerId = $('#sCustomer').value;
    s.logIds = [];
    saveState(); renderSheet(); render();
  };
  $('#sDate').onchange = ()=>{
    s.date = ($('#sDate').value||'').trim() || todayISO();
    saveState(); renderSheet(); render();
  };

  $('#sheetBody').querySelectorAll('[data-logpick]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const logId = cb.getAttribute('data-logpick');
      const other = settlementForLog(logId);
      if (other && other.id !== s.id){
        alert('Deze log zit al in een andere afrekening. Open die afrekening of ontkoppel eerst.');
        cb.checked = false;
        return;
      }
      if (cb.checked) s.logIds = Array.from(new Set([...(s.logIds||[]), logId]));
      else s.logIds = (s.logIds||[]).filter(x => x !== logId);
      saveState(); renderSheet(); render();
    });
  });

  $('#btnRecalc').onclick = ()=>{
    const computed = computeSettlementFromLogs(s.customerId, s.logIds||[]);
    const prev = new Map((s.lines||[]).map(li => [li.productId+'|'+li.description, li.bucket]));
    s.lines = computed.lines.map(li => ({ ...li, bucket: prev.get(li.productId+'|'+li.description) || li.bucket }));
    saveState(); renderSheet(); render();
  };

  $('#sheetBody').querySelectorAll('[data-line-qty]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const lineId = inp.getAttribute('data-line-qty');
      const line = s.lines.find(x=>x.id===lineId);
      if (!line) return;
      line.qty = Number(String(inp.value).replace(',', '.')||'0');
      saveState(); renderSheet(); render();
    });
  });
  $('#sheetBody').querySelectorAll('[data-line-price]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const lineId = inp.getAttribute('data-line-price');
      const line = s.lines.find(x=>x.id===lineId);
      if (!line) return;
      line.unitPrice = Number(String(inp.value).replace(',', '.')||'0');
      saveState(); renderSheet(); render();
    });
  });
  $('#sheetBody').querySelectorAll('[data-line-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const lineId = btn.getAttribute('data-line-del');
      if (!confirmDelete('Regel verwijderen')) return;
      s.lines = (s.lines||[]).filter(x=>x.id!==lineId);
      saveState(); renderSheet(); render();
    });
  });

  $('#sheetBody').querySelectorAll('[data-line-product]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const lineId = sel.getAttribute('data-line-product');
      const line = s.lines.find(x=>x.id===lineId);
      if (!line) return;
      const productId = sel.value || null;
      const product = productId ? getProduct(productId) : null;
      line.productId = productId;
      if (product){
        line.name = product.name;
        line.description = product.name;
        line.unitPrice = Number(product.unitPrice || 0);
        if ((line.bucket || 'invoice') === 'invoice') line.vatRate = Number(product.vatRate ?? 0.21);
      }
      saveState(); renderSheet(); render();
    });
  });

  $('#addInvoiceLine').onclick = ()=>{
    addSettlementLine(s, 'invoice');
    saveState(); renderSheet(); render();
  };
  $('#addCashLine').onclick = ()=>{
    addSettlementLine(s, 'cash');
    saveState(); renderSheet(); render();
  };
}

function renderLinesTable(settlement, bucket){
  const lines = (settlement.lines||[]).filter(l => (l.bucket||'invoice')===bucket);
  const totals = settlementTotals(settlement);
  const footer = bucket === 'invoice'
    ? `
      <div class="settlement-lines-footer mono">
        <div>Subtotaal</div><div></div><div></div><div class="num">${fmtMoney(totals.invoiceSubtotal)}</div><div></div>
        <div>BTW 21%</div><div></div><div></div><div class="num">${fmtMoney(totals.invoiceVat)}</div><div></div>
        <div>Totaal</div><div></div><div></div><div class="num">${fmtMoney(totals.invoiceTotal)}</div><div></div>
      </div>
    `
    : `
      <div class="settlement-lines-footer mono">
        <div>Totaal</div><div></div><div></div><div class="num">${fmtMoney(totals.cashTotal)}</div><div></div>
      </div>
    `;

  return `
    <div class="settlement-lines-table">
      <div class="settlement-lines-grid settlement-lines-head mono">
        <div>Product</div><div>Aantal</div><div>€/eenheid</div><div class="num">Totaal</div><div></div>
      </div>
      ${(lines.map(l=>{
        const rowTotal = lineAmount(l);
        const productValue = l.productId || '';
        return `
          <div class="settlement-lines-grid settlement-lines-row">
            <div>
              <select class="settlement-cell-input" data-line-product="${l.id}">
                <option value="">Kies product</option>
                ${state.products.map(p=>`<option value="${p.id}" ${p.id===productValue?"selected":""}>${esc(p.name)}${p.unit ? ` (${esc(p.unit)})` : ''}</option>`).join('')}
              </select>
            </div>
            <div><input class="settlement-cell-input mono" data-line-qty="${l.id}" inputmode="decimal" value="${esc((l.qty ?? '') === 0 ? '' : String(l.qty ?? ''))}" /></div>
            <div><input class="settlement-cell-input mono" data-line-price="${l.id}" inputmode="decimal" value="${esc((l.unitPrice ?? '') === 0 ? '' : String(l.unitPrice ?? ''))}" /></div>
            <div class="num mono">${fmtMoney(rowTotal)}</div>
            <div>
              <button class="iconbtn settlement-trash" data-line-del="${l.id}" title="Verwijder">
                <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6l1 16h10l1-16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join('')) || `<div class="small">Geen regels</div>`}
      ${footer}
    </div>
  `;
}

function addSettlementLine(settlement, bucket){
  settlement.lines = settlement.lines || [];
  settlement.lines.push({
    id: uid(),
    productId: null,
    name: '',
    qty: '',
    unitPrice: '',
    vatRate: bucket === 'invoice' ? 0.21 : 0,
    bucket
  });
}

function ensureDefaultSettlementLines(settlement){
  settlement.lines = settlement.lines || [];
  const ensureForBucket = bucket=>{
    ["Werk", "Groen"].forEach(productName=>{
      const product = (state.products||[]).find(p => (p.name||'').toLowerCase() === productName.toLowerCase()) || null;
      const hasLine = settlement.lines.some(line => {
        const sameBucket = (line.bucket||'invoice') === bucket;
        if (!sameBucket) return false;
        if (product && line.productId) return line.productId === product.id;
        const label = String(line.name || line.description || pname(line.productId) || '').toLowerCase();
        return label === productName.toLowerCase();
      });
      if (hasLine) return;
      settlement.lines.push({
        id: uid(),
        productId: product?.id || null,
        name: product?.name || productName,
        description: product?.name || productName,
        qty: '',
        unitPrice: product ? Number(product.unitPrice || 0) : '',
        vatRate: bucket === 'invoice' ? Number(product?.vatRate ?? 0.21) : 0,
        bucket
      });
    });
  };
  ensureForBucket('invoice');
  ensureForBucket('cash');
}


function shouldBlockIOSGestures(){
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const isIOSDevice = /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && maxTouchPoints > 1);
  if (!isIOSDevice) return false;
  const isSafariLike = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  return isSafariLike || isStandalone;
}

function installIOSNoZoomGuards(){
  if (!shouldBlockIOSGestures()) return;
  const blockGesture = (event) => event.preventDefault();
  ["gesturestart", "gesturechange", "gestureend"].forEach((type)=>{
    document.addEventListener(type, blockGesture, { passive: false });
  });
}

// ---------- PWA register ----------
if ("serviceWorker" in navigator){
  window.addEventListener("load", async ()=>{
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  });
}

// init
installIOSNoZoomGuards();
setTab("logs");
render();
