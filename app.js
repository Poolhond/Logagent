/* Tuinlog MVP — 4 boeken + detail sheets
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
      { id: uid(), name:"Arbeid", unit:"uur", unitPrice:38, vatRate:0.21, defaultBucket:"invoice" },
      { id: uid(), name:"Groenafval", unit:"keer", unitPrice:38, vatRate:0.21, defaultBucket:"invoice" },
      { id: uid(), name:"Parkeren", unit:"keer", unitPrice:0, vatRate:0.21, defaultBucket:"invoice" },
      { id: uid(), name:"Materiaal", unit:"keer", unitPrice:0, vatRate:0.21, defaultBucket:"invoice" },
    ],
    logs: [],
    settlements: [],
    activeLogId: null
  };
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw){
    const st = defaultState();
    seedDemoWeek(st);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    return st;
  }
  const st = JSON.parse(raw);

  // migrations
  if (!st.settings) st.settings = { hourlyRate: 38, vatRate: 0.21 };
  if (!st.customers) st.customers = [];
  if (!st.products) st.products = [];
  if (!st.logs) st.logs = [];
  if (!st.settlements) st.settlements = [];
  if (!("activeLogId" in st)) st.activeLogId = null;

  // settlement status default
  for (const s of st.settlements){
    if (!s.status) s.status = "draft";
    if (!s.lines) s.lines = [];
    if (!s.logIds) s.logIds = [];
    if (!("invoicePaid" in s)) s.invoicePaid = false;
    if (!("cashPaid" in s)) s.cashPaid = false;
  }
  // log fields
  for (const l of st.logs){
    if (!l.segments) l.segments = [];
    if (!l.items) l.items = [];
    if (!l.date) l.date = todayISO();
  }

  return st;
}

function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

const state = loadState();

// ---------- Demo seed (week) ----------
function seedDemoWeek(st){
  if (st.logs.length) return;
  const cids = st.customers.map(c => c.id);
  const prodGroen = st.products.find(p => p.name === "Groenafval")?.id;
  const prodPark = st.products.find(p => p.name === "Parkeren")?.id;

  for (let i=0;i<7;i++){
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateISO = d.toISOString().slice(0,10);

    const customerId = cids[i % cids.length];
    const start = new Date(dateISO+"T08:30:00").getTime();
    const end = new Date(dateISO+"T12:30:00").getTime();
    const brS = new Date(dateISO+"T10:30:00").getTime();
    const brE = new Date(dateISO+"T10:45:00").getTime();

    const log = {
      id: uid(),
      customerId,
      date: dateISO,
      createdAt: start,
      closedAt: end,
      note: (i%3===0) ? "Haag + borders" : "",
      segments: [
        { id: uid(), type:"work", start, end: brS },
        { id: uid(), type:"break", start: brS, end: brE },
        { id: uid(), type:"work", start: brE, end }
      ],
      items: []
    };

    if (prodGroen && i%2===0){
      log.items.push({ id: uid(), productId: prodGroen, qty: 1 + (i%3), unitPrice: 38, note:"" });
    }
    if (prodPark && i%4===0){
      log.items.push({ id: uid(), productId: prodPark, qty: 1, unitPrice: 2.5, note:"" });
    }
    st.logs.unshift(log);
  }
}

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
function settlementForLog(logId){
  return state.settlements.find(a => (a.logIds||[]).includes(logId)) || null;
}
function getWorkLogStatus(logId){
  const af = settlementForLog(logId);
  if (!af) return "free";
  if (settlementPaymentState(af).isPaid) return "paid";
  if (af.status === "calculated") return "calculated";
  return "linked";
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
  const invoiceTotal = invoiceTotals.total;
  const cashTotal = cashTotals.subtotal;
  const hasInvoice = invoiceTotal > 0;
  const hasCash = cashTotal > 0;
  const isPaid = (!hasInvoice || settlement.invoicePaid)
    && (!hasCash || settlement.cashPaid)
    && (hasInvoice || hasCash);
  return { invoiceTotals, cashTotals, invoiceTotal, cashTotal, hasInvoice, hasCash, isPaid };
}

function computeSettlementFromLogs(customerId, logIds){
  let workMs = 0;
  const itemMap = new Map(); // productId -> {qty, unitPrice}
  for (const id of logIds){
    const log = state.logs.find(l => l.id === id);
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
  const labourProduct = state.products.find(p => p.name.toLowerCase() === "arbeid");
  if (hours > 0){
    lines.push({
      id: uid(),
      productId: labourProduct?.id || null,
      description: labourProduct?.name || "Arbeid",
      unit: labourProduct?.unit || "uur",
      qty: hours,
      unitPrice: Number(state.settings.hourlyRate||38),
      vatRate: labourProduct?.vatRate ?? 0.21,
      bucket: "invoice"
    });
  }
  for (const [productId, v] of itemMap.entries()){
    const prod = getProduct(productId);
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

// ---------- UI state ----------
const ui = {
  tab: "logs",
  sheet: { type: null, id: null }, // customer|log|settlement|product
};

function setTab(key){
  ui.tab = key;
  $("#tab-logs").classList.toggle("hidden", key !== "logs");
  $("#tab-settlements").classList.toggle("hidden", key !== "settlements");
  $("#tab-customers").classList.toggle("hidden", key !== "customers");
  $("#tab-products").classList.toggle("hidden", key !== "products");

  $("#nav-logs").classList.toggle("active", key === "logs");
  $("#nav-settlements").classList.toggle("active", key === "settlements");
  $("#nav-customers").classList.toggle("active", key === "customers");
  $("#nav-products").classList.toggle("active", key === "products");

  $("#nav-logs").setAttribute("aria-selected", String(key === "logs"));
  $("#nav-settlements").setAttribute("aria-selected", String(key === "settlements"));
  $("#nav-customers").setAttribute("aria-selected", String(key === "customers"));
  $("#nav-products").setAttribute("aria-selected", String(key === "products"));

  const subtitle = key === "logs" ? "Logboek"
    : key === "settlements" ? "Afrekenboek"
    : key === "customers" ? "Klanten"
    : "Producten";
  $("#subTitle").textContent = subtitle;

  render();
}

$("#nav-logs").addEventListener("click", ()=>setTab("logs"));
$("#nav-settlements").addEventListener("click", ()=>setTab("settlements"));
$("#nav-customers").addEventListener("click", ()=>setTab("customers"));
$("#nav-products").addEventListener("click", ()=>setTab("products"));

$("#btnBack").addEventListener("click", ()=> {
  if (ui.sheet.type) closeSheet();
  else setTab("logs");
});
$("#btnSearch").addEventListener("click", ()=> alert("Zoeken komt later."));

function openSheet(type, id){
  ui.sheet = { type, id };
  $("#sheet").classList.remove("hidden");
  renderSheet();
}
function closeSheet(){
  ui.sheet = { type:null, id:null };
  $("#sheet").classList.add("hidden");
  $("#sheetTitle").textContent = "";
  $("#sheetActions").innerHTML = "";
  $("#sheetBody").innerHTML = "";
  render(); // update lists for status changes
}
$("#sheetClose").addEventListener("click", closeSheet);

// ---------- Render ----------
function render(){
  if (ui.tab === "logs") renderLogs();
  if (ui.tab === "settlements") renderSettlements();
  if (ui.tab === "customers") renderCustomers();
  if (ui.tab === "products") renderProducts();
  if (ui.sheet.type) renderSheet();
}

function renderLogs(){
  const el = $("#tab-logs");
  const active = state.activeLogId ? state.logs.find(l => l.id === state.activeLogId) : null;

  const customerOptions = state.customers.map(c => `<option value="${c.id}">${esc(c.nickname||c.name||"Klant")}</option>`).join("");

  const activeCard = active ? `
    <div class="card stack">
      <div class="row space">
        <div>
          <div class="item-title">Actieve werklog</div>
          <div class="small mono">${esc(cname(active.customerId))} • gestart ${fmtClock(active.createdAt)}</div>
        </div>
        <span class="badge mono">Werk: ${durMsToHM(sumWorkMs(active))}</span>
      </div>

      <div class="row">
        <button class="btn primary" id="btnPause">${currentOpenSegment(active)?.type === "break" ? "Stop pauze" : "Start pauze"}</button>
        <button class="btn danger" id="btnStop">Stop</button>
        <button class="btn" id="btnOpenActive">Open</button>
      </div>

      <div class="small">Tip: producten voeg je toe via “Open”.</div>
    </div>
  ` : `
    <div class="card stack">
      <div class="item-title">Nieuwe werklog</div>
      <div class="row">
        <div style="flex:1; min-width:220px;">
          <label>Klant</label>
          <select id="startCustomer">${customerOptions || `<option value="">(Geen klanten)</option>`}</select>
        </div>
      </div>
      <button class="btn primary" id="btnStart" ${state.customers.length ? "" : "disabled"}>Start werk</button>
      ${state.customers.length ? "" : `<div class="small">Maak eerst een klant aan.</div>`}
    </div>
  `;

  const logs = [...state.logs].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0, 20);
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
  }).join("") : `<div class="small">Nog geen logs.</div>`;

  el.innerHTML = `<div class="stack">${activeCard}<div class="card stack"><div class="item-title">Recente logs</div><div class="list">${list}</div></div></div>`;

  // actions
  if (!active){
    $("#btnStart")?.addEventListener("click", ()=>{
      const cid = $("#startCustomer").value;
      if (!cid) return;
      const log = {
        id: uid(),
        customerId: cid,
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
      saveState(); render();
    });
  } else {
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
      saveState(); render();
    });
    $("#btnOpenActive")?.addEventListener("click", ()=> openSheet("log", active.id));
  }

  el.querySelectorAll("[data-open-log]").forEach(x=>{
    x.addEventListener("click", ()=> openSheet("log", x.getAttribute("data-open-log")));
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

function renderSettlements(){
  const el = $("#tab-settlements");
  const list = [...state.settlements].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(s=>{
    const pay = settlementPaymentState(s);
    const rowStatus = pay.isPaid ? "paid" : (s.status === "calculated" ? "calculated" : "draft");
    const cls = statusClassFromStatus(rowStatus);
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
  const { type, id } = ui.sheet;
  if (!type) return;

  const actions = $("#sheetActions");
  actions.innerHTML = "";

  if (type === "customer") renderCustomerSheet(id);
  if (type === "product") renderProductSheet(id);
  if (type === "log") renderLogSheet(id);
  if (type === "settlement") renderSettlementSheet(id);
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
            const cls = statusClassFromStatus(s.status);
            const totInv = bucketTotals(s.lines,"invoice");
            const totCash = bucketTotals(s.lines,"cash");
            const grand = round2(totInv.total + totCash.subtotal);
            return `
              <div class="item ${cls}" data-open-settlement="${s.id}">
                <div class="item-main">
                  <div class="item-title">${esc(s.date)} • ${statusLabelNL(s.status)}</div>
                  <div class="item-sub mono">logs ${(s.logIds||[]).length} • totaal ${fmtMoney(grand)}</div>
                </div>
                <div class="item-right"><span class="badge">open</span></div>
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

  $("#sheetActions").innerHTML = `
    <button class="btn danger" id="delLog">Verwijder</button>
  `;

  const settlementOptions = buildSettlementSelectOptions(log.customerId, af?.id);

  const productOptions = state.products.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit)} • ${fmtMoney(p.unitPrice)})</option>`).join("");

  $("#sheetBody").innerHTML = `
    <div class="stack">

      <div class="card stack">
        <div class="row space">
          <div>
            <div class="item-title">${esc(cname(log.customerId))}</div>
            <div class="small mono">${esc(log.date)} • Werk ${durMsToHM(sumWorkMs(log))} • Pauze ${durMsToHM(sumBreakMs(log))}</div>
          </div>
          <span class="badge">${af ? statusLabelNL(af.status) : "vrij"}</span>
        </div>

        <div class="hr"></div>

        <div class="row">
          <div style="flex:1; min-width:220px;">
            <label>Afrekening</label>
            <select id="logSettlement" ${locked ? "disabled" : ""}>
              ${settlementOptions}
            </select>
            <div class="small">Koppel via dropdown aan bestaande of nieuwe afrekening.</div>
          </div>
          <div style="flex:1; min-width:220px;">
            <label>Notitie</label>
            <input id="logNote" value="${esc(log.note||"")}" />
          </div>
        </div>
        <button class="btn primary" id="saveLog">Opslaan</button>
      </div>

      <div class="card stack">
        <div class="item-title">Segments</div>
        <div class="small mono">Werk: ${durMsToHM(sumWorkMs(log))} • Pauze: ${durMsToHM(sumBreakMs(log))}</div>
        <div class="list">
          ${(log.segments||[]).map(s=>`
            <div class="item">
              <div class="item-main">
                <div class="item-title">${esc(s.type)}</div>
                <div class="item-sub mono">${fmtClock(s.start)} → ${s.end ? fmtClock(s.end) : "…"} </div>
              </div>
              <div class="item-right"><span class="badge">${s.end? "ok":"open"}</span></div>
            </div>
          `).join("") || `<div class="small">Geen segments.</div>`}
        </div>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Producten in deze log</div>
          <span class="badge mono">Totaal ${fmtMoney(sumItemsAmount(log))}</span>
        </div>

        <div class="list" id="logItems">
          ${renderLogItems(log)}
        </div>

        <div class="hr"></div>

        <div class="item-title">Product toevoegen</div>
        <div class="row">
          <div style="flex:2; min-width:220px;">
            <label>Product</label>
            <select id="addProd">${productOptions}</select>
          </div>
          <div style="flex:1; min-width:120px;">
            <label>Aantal</label>
            <input id="addQty" inputmode="decimal" value="1" />
          </div>
          <div style="flex:1; min-width:140px;">
            <label>Prijs / eenheid</label>
            <input id="addPrice" inputmode="decimal" value="${esc(String(state.products[0]?.unitPrice ?? 0))}" />
          </div>
        </div>
        <button class="btn" id="addItem">Toevoegen</button>
      </div>

    </div>
  `;

  // wire
  $("#saveLog").onclick = ()=>{
    log.note = ($("#logNote").value||"").trim();
    saveState(); render();
    alert("Opgeslagen.");
  };

  $("#addProd").onchange = ()=>{
    const pid = $("#addProd").value;
    const p = getProduct(pid);
    $("#addPrice").value = String(p?.unitPrice ?? 0);
  };

  $("#addItem").onclick = ()=>{
    const pid = $("#addProd").value;
    const qty = Number(String($("#addQty").value).replace(",", ".") || "0");
    const price = Number(String($("#addPrice").value).replace(",", ".") || "0");
    if (!pid || !(qty>0)) return;
    log.items = log.items || [];
    log.items.push({ id: uid(), productId: pid, qty, unitPrice: price, note:"" });
    saveState(); renderSheet();
  };

  $("#sheetBody").querySelectorAll("[data-del-log-item]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const itemId = btn.getAttribute("data-del-log-item");
      if (!confirmDelete("Item verwijderen")) return;
      log.items = (log.items||[]).filter(it => it.id !== itemId);
      saveState(); renderSheet();
    });
  });

  $("#sheetBody").querySelectorAll("[data-edit-log-item]").forEach(inp=>{
    inp.addEventListener("change", ()=>{
      const itemId = inp.getAttribute("data-edit-log-item");
      const field = inp.getAttribute("data-field");
      const it = (log.items||[]).find(x => x.id === itemId);
      if (!it) return;
      if (field === "qty") it.qty = Number(String(inp.value).replace(",", ".") || "0");
      if (field === "unitPrice") it.unitPrice = Number(String(inp.value).replace(",", ".") || "0");
      saveState(); renderSheet();
    });
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
  if (!(log.items||[]).length) return `<div class="small">Nog geen producten.</div>`;
  return (log.items||[]).map(it=>{
    const p = getProduct(it.productId);
    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${esc(p?.name || "Product")}</div>
          <div class="item-sub mono">${esc(p?.unit || "keer")} • totaal ${fmtMoney((Number(it.qty)||0)*(Number(it.unitPrice)||0))}</div>
          <div class="row">
            <div style="flex:1; min-width:120px;">
              <label>Aantal</label>
              <input data-edit-log-item="${it.id}" data-field="qty" inputmode="decimal" value="${esc(String(it.qty ?? 0))}" />
            </div>
            <div style="flex:1; min-width:140px;">
              <label>Prijs / eenheid</label>
              <input data-edit-log-item="${it.id}" data-field="unitPrice" inputmode="decimal" value="${esc(String(it.unitPrice ?? 0))}" />
            </div>
          </div>
        </div>
        <div class="item-right">
          <button class="iconbtn" data-del-log-item="${it.id}" title="Verwijder">
            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6l1 16h10l1-16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join("");
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

function renderSettlementSheet(id){
  const s = state.settlements.find(x => x.id === id);
  if (!s){ closeSheet(); return; }
  if (!("invoicePaid" in s)) s.invoicePaid = false;
  if (!("cashPaid" in s)) s.cashPaid = false;
  $('#sheetTitle').textContent = 'Afrekening';

  const customerOptions = state.customers.map(c => `<option value="${c.id}" ${c.id===s.customerId?"selected":""}>${esc(c.nickname||c.name||"Klant")}</option>`).join('');

  const customerLogs = state.logs
    .filter(l => l.customerId === s.customerId)
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  const pay = settlementPaymentState(s);
  const invT = pay.invoiceTotals;
  const cashT = pay.cashTotals;
  const grand = round2(pay.invoiceTotal + pay.cashTotal);
  const summary = settlementLogbookSummary(s);

  $('#sheetActions').innerHTML = `
    <button class="btn danger" id="delSettlement">Verwijder</button>
  `;

  const productOptions = state.products.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit)} • ${fmtMoney(p.unitPrice)})</option>`).join('');

  $('#sheetBody').innerHTML = `
    <div class="stack">
      <div class="card stack">
        <div class="row space">
          <div>
            <div class="item-title">${esc(cname(s.customerId))}</div>
            <div class="small mono">${esc(s.date)} • #${esc((s.id||'').slice(0,8))}</div>
          </div>
          <span class="badge mono">Totaal: ${pay.isPaid ? 'BETAALD' : 'OPEN'} • ${fmtMoney(grand)}</span>
        </div>

        <div class="row">
          <div style="flex:2; min-width:220px;">
            <label>Klant</label>
            <select id="sCustomer">${customerOptions}</select>
          </div>
          <div style="flex:1; min-width:160px;">
            <label>Datum</label>
            <input id="sDate" value="${esc(s.date||todayISO())}" />
          </div>
        </div>
        <div class="row">
          <button class="btn" id="markCalculated" ${s.status==='calculated'?'disabled':''}>Markeer als berekend</button>
        </div>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Logboek totaal</div>
          <span class="badge mono">${summary.linkedCount} logs</span>
        </div>
        <div class="row">
          <div class="badge mono">Werkduur ${durMsToHM(summary.totalWorkMs)}</div>
          <div class="badge mono">Productkosten ${fmtMoney(summary.totalProductCosts)}</div>
          <div class="badge mono">Logboek prijs ${fmtMoney(summary.totalLogPrice)}</div>
        </div>
      </div>

      <div class="card stack">
        <div class="item-title">Gekoppelde logs</div>
        <div class="small">Tik om (de)selecteren. Koppeling bepaalt alleen totaal hierboven.</div>
        <div class="list" id="sLogs">
          ${customerLogs.slice(0,30).map(l=>{
            const checked = (s.logIds||[]).includes(l.id) ? 'checked' : '';
            const cls = statusClassFromStatus(getWorkLogStatus(l.id));
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
          }).join('') || `<div class="small">Geen logs.</div>`}
        </div>
        <button class="btn" id="btnRecalc">Herbereken uit logs</button>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Factuur</div>
          <span class="pill ${pay.hasInvoice && s.invoicePaid?'pill-paid':'pill-open'} mono">${fmtMoney(pay.invoiceTotal)}</span>
        </div>
        <div class="small mono">subtotaal ${fmtMoney(invT.subtotal)} • btw 21% ${fmtMoney(invT.vat)}</div>
        <div class="list">
          ${renderSettlementLines(s, 'invoice', false)}
        </div>
        <div class="row">
          <button class="btn" id="addInvoiceLine">+ Regel toevoegen (Factuur)</button>
          ${pay.hasInvoice ? `<button class="btn" id="toggleInvoicePaid">Factuur ${s.invoicePaid ? 'open zetten' : 'betaald zetten'}</button>` : `<button class="btn" disabled>Geen factuurbedrag</button>`}
        </div>
      </div>

      <div class="card stack">
        <div class="row space">
          <div class="item-title">Cash</div>
          <span class="pill ${pay.hasCash && s.cashPaid?'pill-paid':'pill-open'} mono">${fmtMoney(pay.cashTotal)}</span>
        </div>
        <div class="small mono">Cash zonder btw.</div>
        <div class="list">
          ${renderSettlementLines(s, 'cash', false)}
        </div>
        <div class="row">
          <button class="btn" id="addCashLine">+ Regel toevoegen (Cash)</button>
          ${pay.hasCash ? `<button class="btn" id="toggleCashPaid">Cash ${s.cashPaid ? 'open zetten' : 'betaald zetten'}</button>` : `<button class="btn" disabled>Geen cashbedrag</button>`}
        </div>
      </div>

      <div class="card stack" id="lineAdder"></div>
    </div>
  `;

  $('#delSettlement').onclick = ()=>{
    if (!confirmDelete(`Afrekening ${s.date} — ${cname(s.customerId)}`)) return;
    state.settlements = state.settlements.filter(x => x.id !== s.id);
    saveState(); closeSheet();
  };

  $('#markCalculated').onclick = ()=>{
    if (!confirmAction('Afrekening markeren als berekend?')) return;
    s.status = 'calculated';
    saveState(); renderSheet(); render();
  };

  const invoiceToggle = $('#toggleInvoicePaid');
  if (invoiceToggle){
    invoiceToggle.onclick = ()=>{
      const next = !s.invoicePaid;
      if (!confirmAction(next ? 'Factuur markeren als betaald?' : 'Factuur terug open zetten?')) return;
      s.invoicePaid = next;
      saveState(); renderSheet(); render();
    };
  }

  const cashToggle = $('#toggleCashPaid');
  if (cashToggle){
    cashToggle.onclick = ()=>{
      const next = !s.cashPaid;
      if (!confirmAction(next ? 'Cash markeren als betaald?' : 'Cash terug open zetten?')) return;
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

  $('#addInvoiceLine').onclick = ()=> showLineAdder(s, 'invoice', productOptions);
  $('#addCashLine').onclick = ()=> showLineAdder(s, 'cash', productOptions);
}

function renderSettlementLines(s, bucket, locked){
  const lines = (s.lines||[]).filter(l => (l.bucket||'invoice')===bucket);
  if (!lines.length) return `<div class="small">Geen regels.</div>`;
  return lines.map(l=>{
    const amount = lineAmount(l);
    return `
      <div class="item item-compact">
        <div class="item-main">
          <div class="item-title">${esc(l.description || pname(l.productId))}</div>
          <div class="item-sub mono">qty ${esc(String(l.qty ?? 0))} • ${fmtMoney(Number(l.unitPrice||0))} • regel ${fmtMoney(amount)} ${bucket==='invoice' ? `• btw ${fmtMoney(lineVat(l))}` : ''}</div>
          <div class="row">
            <div style="flex:1; min-width:120px;">
              <label>Aantal</label>
              <input ${locked?'disabled':''} data-line-qty="${l.id}" inputmode="decimal" value="${esc(String(l.qty ?? 0))}" />
            </div>
            <div style="flex:1; min-width:140px;">
              <label>Prijs / eenheid</label>
              <input ${locked?'disabled':''} data-line-price="${l.id}" inputmode="decimal" value="${esc(String(l.unitPrice ?? 0))}" />
            </div>
          </div>
        </div>
        <div class="item-right">
          <button class="iconbtn" ${locked?'disabled':''} data-line-del="${l.id}" title="Verwijder">
            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6l1 16h10l1-16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function showLineAdder(s, bucket, productOptions){
  const mount = $("#lineAdder");
  mount.classList.remove("hidden");
  mount.innerHTML = `
    <div class="card stack">
      <div class="row space">
        <div class="item-title">Nieuwe regel (${bucket==="invoice"?"factuur":"cash"})</div>
        <span class="badge">invullen</span>
      </div>

      <div class="row">
        <div style="flex:2; min-width:220px;">
          <label>Product (optioneel)</label>
          <select id="newLineProd">
            <option value="">Vrije tekst</option>
            ${productOptions}
          </select>
        </div>
        <div style="flex:2; min-width:220px;">
          <label>Omschrijving</label>
          <input id="newLineDesc" placeholder="bv. extra groenafvoer" />
        </div>
      </div>

      <div class="row">
        <div style="flex:1; min-width:120px;">
          <label>Aantal</label>
          <input id="newLineQty" inputmode="decimal" value="1" />
        </div>
        <div style="flex:1; min-width:140px;">
          <label>Eenheid</label>
          <input id="newLineUnit" value="keer" />
        </div>
        <div style="flex:1; min-width:140px;">
          <label>Prijs / eenheid</label>
          <input id="newLinePrice" inputmode="decimal" value="0" />
        </div>
      </div>

      <div class="row">
        <button class="btn primary" id="newLineAdd">Toevoegen</button>
        <button class="btn" id="newLineCancel">Annuleer</button>
      </div>
    </div>
  `;

  $("#newLineProd").onchange = ()=>{
    const pid = $("#newLineProd").value;
    const p = pid ? getProduct(pid) : null;
    if (p){
      $("#newLineDesc").value = p.name;
      $("#newLineUnit").value = p.unit || "keer";
      $("#newLinePrice").value = String(p.unitPrice ?? 0);
    }
  };

  $("#newLineCancel").onclick = ()=>{
    mount.classList.add("hidden");
    mount.innerHTML = "";
  };

  $("#newLineAdd").onclick = ()=>{
    const pid = $("#newLineProd").value || null;
    const prod = pid ? getProduct(pid) : null;
    const desc = ($("#newLineDesc").value||"").trim() || (prod?.name || "Regel");
    const qty = Number(String($("#newLineQty").value).replace(",", ".")||"0");
    const unit = ($("#newLineUnit").value||"").trim() || (prod?.unit || "keer");
    const price = Number(String($("#newLinePrice").value).replace(",", ".")||"0");
    if (!(qty>0)) return;
    s.lines = s.lines || [];
    s.lines.unshift({
      id: uid(),
      productId: pid,
      description: desc,
      unit,
      qty,
      unitPrice: price,
      vatRate: prod?.vatRate ?? 0.21,
      bucket
    });
    saveState(); renderSheet(); render();
  };
}

// ---------- PWA register ----------
if ("serviceWorker" in navigator){
  window.addEventListener("load", async ()=>{
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  });
}

// init
setTab("logs");
render();
