/*
 * Hamza Departmental Store — data layer
 * -------------------------------------
 * Pure state logic + a small Store adapter.
 *
 * The pure functions (emptyState, normalizeState, findByCode,
 * computeBillTotals, applyBillToStock, computeDashboard) run in the
 * browser AND in Node (used by tests/run-tests.js), so the exact code
 * the app ships is the code that is tested.
 *
 * STATE SHAPE (schema v2) — normalizeState ALWAYS returns this shape:
 * plain arrays for every collection, never a wrapper object:
 *   {
 *     version: 2,
 *     products:     [ {id, code, name, brand, size, category, unit,
 *                      purchasePaisa, salePaisa, stock, expiry, createdAt} ],
 *     bills:        [ {id, number, date, customerName, customerId,
 *                      paymentMethod, discountPaisa, totalPaisa,
 *                      profitPaisa, items:[{productId, code, name, unit,
 *                      qty, salePaisa, purchasePaisa}]} ],
 *     customers:    [ {id, name, phone, balancePaisa} ],
 *     khataEntries: [ {id, customerId, date, type, amountPaisa, note, billId} ],
 *     purchases:    [ {id, date, supplier, productId, code, name, qty,
 *                      purchasePaisa, totalPaisa} ],
 *     settings:     { pin, lowStockThreshold, expiryAlertDays, nextBillNumber }
 *   }
 * Money is stored as integer paisa (Rs 1 = 100 paisa) to avoid float drift.
 * salePaisa === 0 means "rate not set yet" (Rate set karna baqi).
 *
 * Legacy inputs normalizeState understands:
 *   - null / undefined / non-object                -> empty state
 *   - collections stored as id->object maps        -> arrays (Firebase style)
 *   - v1 field aliases: items->products, sales->bills,
 *     khata_entries->khataEntries, config->settings
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (root) { root.HamzaData = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SCHEMA_VERSION = 2;
  var STORAGE_KEY = "hamza_store_state_v2";
  var LEGACY_STORAGE_KEY = "hamza_store_state_v1";

  var CATEGORIES = [
    "Grocery", "Dairy & Bread", "Snacks & Biscuits", "Cold Drinks & Juices",
    "Household", "Personal Care", "Frozen", "Baby Care", "Other"
  ];
  var UNITS = ["piece", "pack", "kg", "litre"];
  var PAYMENT_METHODS = ["Cash", "Card", "JazzCash", "EasyPaisa", "Udhaar"];

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);
  }

  function num(v, dflt) {
    var n = typeof v === "string" ? parseFloat(v) : v;
    return (typeof n === "number" && isFinite(n)) ? n : (dflt || 0);
  }
  function str(v, dflt) { return (v === null || v === undefined) ? (dflt || "") : String(v); }
  function round3(n) { return Math.round(n * 1000) / 1000; }

  function defaultSettings() {
    return { pin: "", lowStockThreshold: 5, expiryAlertDays: 30, nextBillNumber: 1001 };
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      products: [],
      bills: [],
      customers: [],
      khataEntries: [],
      purchases: [],
      settings: defaultSettings()
    };
  }

  // Accepts an array, an id->object map (Firebase), or anything else.
  function toArray(v) {
    if (Array.isArray(v)) { return v.slice(); }
    if (v && typeof v === "object") {
      return Object.keys(v).map(function (k) {
        var item = v[k];
        if (item && typeof item === "object" && !item.id) {
          var copy = {}; for (var p in item) { copy[p] = item[p]; }
          copy.id = k; return copy;
        }
        return item;
      });
    }
    return [];
  }

  function normalizeProduct(p) {
    p = (p && typeof p === "object") ? p : {};
    return {
      id: str(p.id, uid("prod")),
      code: str(p.code),
      name: str(p.name, "Unnamed item"),
      brand: str(p.brand),
      size: str(p.size),
      category: CATEGORIES.indexOf(p.category) >= 0 ? p.category : "Other",
      unit: UNITS.indexOf(p.unit) >= 0 ? p.unit : "piece",
      purchasePaisa: Math.max(0, Math.round(num(p.purchasePaisa))),
      salePaisa: Math.max(0, Math.round(num(p.salePaisa))),
      stock: round3(num(p.stock)),
      expiry: str(p.expiry),
      createdAt: str(p.createdAt)
    };
  }

  function normalizeBillItem(it) {
    it = (it && typeof it === "object") ? it : {};
    return {
      productId: str(it.productId),
      code: str(it.code),
      name: str(it.name, "Item"),
      unit: UNITS.indexOf(it.unit) >= 0 ? it.unit : "piece",
      qty: round3(num(it.qty)),
      salePaisa: Math.max(0, Math.round(num(it.salePaisa))),
      purchasePaisa: Math.max(0, Math.round(num(it.purchasePaisa)))
    };
  }

  function normalizeBill(b) {
    b = (b && typeof b === "object") ? b : {};
    return {
      id: str(b.id, uid("bill")),
      number: Math.round(num(b.number)),
      date: str(b.date),
      customerName: str(b.customerName),
      customerId: str(b.customerId),
      paymentMethod: PAYMENT_METHODS.indexOf(b.paymentMethod) >= 0 ? b.paymentMethod : "Cash",
      discountPaisa: Math.max(0, Math.round(num(b.discountPaisa))),
      totalPaisa: Math.round(num(b.totalPaisa)),
      profitPaisa: Math.round(num(b.profitPaisa)),
      items: toArray(b.items).map(normalizeBillItem)
    };
  }

  function normalizeCustomer(c) {
    c = (c && typeof c === "object") ? c : {};
    return {
      id: str(c.id, uid("cust")),
      name: str(c.name, "Customer"),
      phone: str(c.phone),
      balancePaisa: Math.round(num(c.balancePaisa))
    };
  }

  function normalizeKhataEntry(e) {
    e = (e && typeof e === "object") ? e : {};
    return {
      id: str(e.id, uid("khata")),
      customerId: str(e.customerId),
      date: str(e.date),
      type: e.type === "payment" ? "payment" : "credit",
      amountPaisa: Math.round(num(e.amountPaisa)),
      note: str(e.note),
      billId: str(e.billId)
    };
  }

  function normalizePurchase(p) {
    p = (p && typeof p === "object") ? p : {};
    return {
      id: str(p.id, uid("pur")),
      date: str(p.date),
      supplier: str(p.supplier),
      productId: str(p.productId),
      code: str(p.code),
      name: str(p.name),
      qty: round3(num(p.qty)),
      purchasePaisa: Math.max(0, Math.round(num(p.purchasePaisa))),
      totalPaisa: Math.round(num(p.totalPaisa))
    };
  }

  function normalizeSettings(s) {
    s = (s && typeof s === "object") ? s : {};
    var d = defaultSettings();
    return {
      pin: str(s.pin),
      lowStockThreshold: num(s.lowStockThreshold, d.lowStockThreshold),
      expiryAlertDays: Math.round(num(s.expiryAlertDays, d.expiryAlertDays)),
      nextBillNumber: Math.round(num(s.nextBillNumber, d.nextBillNumber)) || d.nextBillNumber
    };
  }

  // THE initializer. Every stored state (empty / legacy / current)
  // goes through here before any consumer touches it.
  function normalizeState(input) {
    if (!input || typeof input !== "object") { return emptyState(); }
    var state = emptyState();
    state.products = toArray(input.products != null ? input.products :
      (input.items != null ? input.items : input.inventory)).map(normalizeProduct);
    state.bills = toArray(input.bills != null ? input.bills : input.sales).map(normalizeBill);
    state.customers = toArray(input.customers).map(normalizeCustomer);
    state.khataEntries = toArray(input.khataEntries != null ? input.khataEntries :
      (input.khata_entries != null ? input.khata_entries : input.khata)).map(normalizeKhataEntry);
    state.purchases = toArray(input.purchases).map(normalizePurchase);
    state.settings = normalizeSettings(input.settings != null ? input.settings : input.config);
    return state;
  }

  function findByCode(state, code) {
    if (!state || !Array.isArray(state.products)) { return null; }
    var target = String(code == null ? "" : code).trim();
    if (!target) { return null; }
    for (var i = 0; i < state.products.length; i++) {
      if (String(state.products[i].code).trim() === target) { return state.products[i]; }
    }
    return null;
  }

  function findProduct(state, id) {
    if (!state || !Array.isArray(state.products)) { return null; }
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].id === id) { return state.products[i]; }
    }
    return null;
  }

  // lines: [{qty, salePaisa, purchasePaisa}]
  function computeBillTotals(lines, discountPaisa) {
    var subtotal = 0, profit = 0, hasPendingRate = false;
    (lines || []).forEach(function (l) {
      var qty = num(l.qty), sale = Math.round(num(l.salePaisa)), pur = Math.round(num(l.purchasePaisa));
      subtotal += Math.round(sale * qty);
      if (sale > 0) { profit += Math.round((sale - pur) * qty); }
      else { hasPendingRate = true; }
    });
    var discount = Math.min(Math.max(0, Math.round(num(discountPaisa))), subtotal);
    return {
      subtotalPaisa: subtotal,
      discountPaisa: discount,
      totalPaisa: subtotal - discount,
      profitPaisa: profit,
      hasPendingRate: hasPendingRate
    };
  }

  // Returns a NEW products array with bill quantities deducted.
  function applyBillToStock(products, lines) {
    var byId = {};
    (lines || []).forEach(function (l) {
      byId[l.productId] = (byId[l.productId] || 0) + num(l.qty);
    });
    return (products || []).map(function (p) {
      if (!byId[p.id]) { return p; }
      var copy = {}; for (var k in p) { copy[k] = p[k]; }
      copy.stock = round3(num(p.stock) - byId[p.id]);
      return copy;
    });
  }

  function dateKey(iso) { return String(iso || "").slice(0, 10); }

  // Pure dashboard/report summary — the consumer the UI renders from.
  // Safe on any normalized state, including a completely empty store.
  function computeDashboard(state, todayStr) {
    var s = state || emptyState();
    var today = todayStr || new Date().toISOString().slice(0, 10);
    var todaySale = 0, todayProfit = 0;
    var byDay = {};
    (s.bills || []).forEach(function (b) {
      var d = dateKey(b.date);
      byDay[d] = (byDay[d] || 0) + num(b.totalPaisa);
      if (d === today) { todaySale += num(b.totalPaisa); todayProfit += num(b.profitPaisa); }
    });
    var last7Days = [];
    var base = new Date(today + "T00:00:00");
    for (var i = 6; i >= 0; i--) {
      var d = new Date(base.getTime() - i * 86400000);
      var key = d.toISOString().slice(0, 10);
      last7Days.push({ date: key, salePaisa: byDay[key] || 0 });
    }
    var threshold = num(s.settings && s.settings.lowStockThreshold, 5);
    var alertDays = num(s.settings && s.settings.expiryAlertDays, 30);
    var limit = new Date(base.getTime() + alertDays * 86400000).toISOString().slice(0, 10);
    var stockValue = 0, lowStock = [], expiring = [], pendingRates = [];
    (s.products || []).forEach(function (p) {
      stockValue += Math.round(num(p.purchasePaisa) * num(p.stock));
      if (num(p.stock) <= threshold) { lowStock.push(p); }
      if (p.expiry && p.expiry >= today && p.expiry <= limit) { expiring.push(p); }
      if (!p.expiry || p.expiry >= today) { /* expired handled below */ }
      if (p.expiry && p.expiry < today) { expiring.push(p); }
      if (num(p.salePaisa) === 0) { pendingRates.push(p); }
    });
    var totalUdhaar = 0;
    (s.customers || []).forEach(function (c) { totalUdhaar += num(c.balancePaisa); });
    return {
      todaySalePaisa: todaySale,
      todayProfitPaisa: todayProfit,
      stockValuePaisa: stockValue,
      productCount: (s.products || []).length,
      billCount: (s.bills || []).length,
      lowStock: lowStock,
      expiring: expiring,
      pendingRates: pendingRates,
      totalUdhaarPaisa: totalUdhaar,
      last7Days: last7Days
    };
  }

  /* ---------------- Store adapter (browser only) ----------------
   * Uses Firebase Realtime Database when window.HAMZA_FIREBASE_CONFIG
   * has apiKey + databaseURL and the Firebase compat SDK is loaded;
   * otherwise falls back to localStorage. Whole-state sync (v1):
   * the full normalized state is written on every save and remote
   * updates replace local state through onRemote callbacks.
   */
  function createStore() {
    var mode = "local";
    var ref = null;
    var lastJson = "";
    var remoteCbs = [];

    function configReady() {
      var c = (typeof window !== "undefined") ? window.HAMZA_FIREBASE_CONFIG : null;
      return !!(c && c.apiKey && c.databaseURL &&
        typeof window !== "undefined" && window.firebase &&
        window.firebase.database);
    }

    function persist(state) {
      var json = JSON.stringify(state);
      lastJson = json;
      if (mode === "firebase" && ref) {
        ref.set(state).catch(function () { /* surfaced by caller UI if needed */ });
      } else if (typeof localStorage !== "undefined") {
        try { localStorage.setItem(STORAGE_KEY, json); } catch (e) { /* quota */ }
      }
    }

    function loadLocal() {
      if (typeof localStorage === "undefined") { return emptyState(); }
      var raw = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      } catch (e) { raw = null; }
      if (!raw) { return emptyState(); }
      try { return normalizeState(JSON.parse(raw)); } catch (e) { return emptyState(); }
    }

    function init() {
      if (configReady()) {
        try {
          var cfg = window.HAMZA_FIREBASE_CONFIG;
          var app = (window.firebase.apps && window.firebase.apps.length)
            ? window.firebase.apps[0] : window.firebase.initializeApp(cfg);
          ref = window.firebase.database(app).ref("hamzaStore/stateV2");
          mode = "firebase";
          return ref.once("value").then(function (snap) {
            var val = snap.val();
            var state = normalizeState(val);
            lastJson = JSON.stringify(state);
            ref.on("value", function (s2) {
              var incoming = JSON.stringify(normalizeState(s2.val()));
              if (incoming !== lastJson) {
                lastJson = incoming;
                var st = JSON.parse(incoming);
                remoteCbs.forEach(function (cb) { cb(st); });
              }
            });
            return state;
          }).catch(function () {
            mode = "local"; ref = null;
            return loadLocal();
          });
        } catch (e) {
          mode = "local"; ref = null;
          return Promise.resolve(loadLocal());
        }
      }
      return Promise.resolve(loadLocal());
    }

    return {
      init: init,
      save: persist,
      onRemote: function (cb) { remoteCbs.push(cb); },
      getMode: function () { return mode; }
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    LEGACY_STORAGE_KEY: LEGACY_STORAGE_KEY,
    CATEGORIES: CATEGORIES,
    UNITS: UNITS,
    PAYMENT_METHODS: PAYMENT_METHODS,
    uid: uid,
    emptyState: emptyState,
    normalizeState: normalizeState,
    normalizeProduct: normalizeProduct,
    findByCode: findByCode,
    findProduct: findProduct,
    computeBillTotals: computeBillTotals,
    applyBillToStock: applyBillToStock,
    computeDashboard: computeDashboard,
    createStore: createStore
  };
});
