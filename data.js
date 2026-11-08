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

  /* ---------------- Supabase sync shaping (pure / testable) ----------------
   * The Supabase backend is ONE table, public.hamza_state, with a
   * single row (id = 1) whose `state` jsonb column holds the whole
   * normalized shop state — the same whole-state shape the rest of
   * this file already syncs. These helpers build the exact REST
   * requests and decide the initial-state resolution; they run in
   * Node tests with a mock fetch, so the tested code is the shipped
   * code. No Supabase JS SDK is used — plain fetch only.
   */
  var SUPABASE_STATE_ID = 1;
  var SUPABASE_POLL_MS = 45000;
  var SUPABASE_SAVE_DEBOUNCE_MS = 800;

  function supabaseConfigReady(cfg) {
    return !!(cfg && typeof cfg.url === "string" &&
      cfg.url.indexOf("https://") === 0 &&
      typeof cfg.anonKey === "string" && cfg.anonKey.length > 20);
  }

  function supabaseRestBase(cfg) {
    return String(cfg.url).replace(/\/+$/, "") + "/rest/v1/hamza_state";
  }

  function supabaseSelectUrl(cfg) {
    return supabaseRestBase(cfg) + "?id=eq." + SUPABASE_STATE_ID + "&select=state,updated_at";
  }

  function supabaseHeaders(cfg, extra) {
    var h = {
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + cfg.anonKey,
      "Accept": "application/json"
    };
    if (extra) { for (var k in extra) { h[k] = extra[k]; } }
    return h;
  }

  // The exact upsert request shape used for every cloud save.
  function supabaseUpsertRequest(cfg, state, updatedAt) {
    return {
      url: supabaseRestBase(cfg),
      method: "POST",
      headers: supabaseHeaders(cfg, {
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      }),
      body: JSON.stringify([{ id: SUPABASE_STATE_ID, state: state, updated_at: updatedAt }])
    };
  }

  // REST GET returns an array of rows; [] or a row without an object
  // state means "no remote state yet".
  function parseSupabaseRows(json) {
    if (!Array.isArray(json) || !json.length) { return { state: null, updatedAt: "" }; }
    var row = json[0] || {};
    return {
      state: (row.state && typeof row.state === "object") ? row.state : null,
      updatedAt: str(row.updated_at)
    };
  }

  // "Has data" for a NORMALIZED state: any record at all, or a shop
  // PIN (a PIN-only device has still been set up and must not be
  // silently overwritten by an empty remote).
  function stateHasData(state) {
    if (!state || typeof state !== "object") { return false; }
    var keys = ["products", "bills", "customers", "khataEntries", "purchases"];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(state[keys[i]]) && state[keys[i]].length > 0) { return true; }
    }
    return !!(state.settings && state.settings.pin);
  }

  // Initial-state resolution on load. Both inputs go through the
  // SAME normalizeState the app always uses:
  //   remote has data            -> remote wins
  //   remote empty, local has data -> local wins and must be pushed
  //     up (first-device seeding)
  //   both empty                 -> empty state, nothing to push
  function resolveInitialState(remoteRaw, localRaw) {
    var remote = normalizeState(remoteRaw);
    var local = normalizeState(localRaw);
    if (stateHasData(remote)) { return { state: remote, source: "remote", shouldPush: false }; }
    if (stateHasData(local)) { return { state: local, source: "local", shouldPush: true }; }
    return { state: remote, source: "empty", shouldPush: false };
  }

  function createSupabaseClient(cfg, fetchImpl) {
    var doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    function fetchRemote() {
      if (!doFetch) { return Promise.reject(new Error("fetch is not available")); }
      return doFetch(supabaseSelectUrl(cfg), {
        method: "GET",
        headers: supabaseHeaders(cfg)
      }).then(function (res) {
        if (!res || !res.ok) { throw new Error("Supabase GET failed (" + (res ? res.status : "no response") + ")"); }
        return res.json();
      }).then(parseSupabaseRows);
    }
    function pushState(state, updatedAtIso) {
      if (!doFetch) { return Promise.reject(new Error("fetch is not available")); }
      var req = supabaseUpsertRequest(cfg, state, updatedAtIso || new Date().toISOString());
      return doFetch(req.url, { method: req.method, headers: req.headers, body: req.body })
        .then(function (res) {
          if (!res || !res.ok) { throw new Error("Supabase POST failed (" + (res ? res.status : "no response") + ")"); }
          return true;
        });
    }
    return { fetchRemote: fetchRemote, pushState: pushState };
  }

  /* ---------------- Store adapter (browser only) ----------------
   * Adapter priority: Supabase (window.HAMZA_SUPABASE_CONFIG) ->
   * Firebase Realtime Database (window.HAMZA_FIREBASE_CONFIG with
   * apiKey + databaseURL and the Firebase compat SDK loaded) ->
   * localStorage. Whole-state sync (v1): the full normalized state
   * is written on every save and remote updates replace local state
   * through onRemote callbacks. A failed cloud call never breaks
   * local use: the store falls back to localStorage and reports an
   * honest mode ("local" / "supabase-offline") via getMode().
   */
  function createStore() {
    var mode = "local"; // local | supabase | supabase-offline | firebase
    var ref = null;
    var lastJson = "";
    var remoteCbs = [];
    var supa = null;              // Supabase client (createSupabaseClient)
    var lastSeenUpdatedAt = "";   // updated_at of the last remote row seen/sent
    var currentState = null;      // last resolved/saved state (for status re-renders)
    var pendingState = null;      // newest state waiting for the debounced cloud save
    var saveTimer = null;
    var pollTimer = null;

    function configReady() {
      var c = (typeof window !== "undefined") ? window.HAMZA_FIREBASE_CONFIG : null;
      return !!(c && c.apiKey && c.databaseURL &&
        typeof window !== "undefined" && window.firebase &&
        window.firebase.database);
    }

    function supabaseConfig() {
      var c = (typeof window !== "undefined") ? window.HAMZA_SUPABASE_CONFIG : null;
      return supabaseConfigReady(c) ? c : null;
    }

    function writeLocal(state) {
      if (typeof localStorage === "undefined") { return; }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* quota */ }
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

    // Mode changes re-render the UI (header status) by replaying the
    // current state through the remote-update callbacks; the state
    // itself is unchanged, so this is safe.
    function setMode(next) {
      if (mode === next) { return; }
      mode = next;
      if (currentState) {
        remoteCbs.forEach(function (cb) { cb(currentState); });
      }
    }

    function flushSupabaseSave() {
      saveTimer = null;
      if (!supa || !pendingState) { return; }
      var toSend = pendingState;
      pendingState = null;
      var iso = new Date().toISOString();
      supa.pushState(toSend, iso).then(function () {
        lastSeenUpdatedAt = iso;
        setMode("supabase");
      }).catch(function () {
        // Keep the newest unsent state so the next mutation or poll
        // retries it; local use continues from the localStorage copy.
        if (!pendingState) { pendingState = toSend; }
        setMode("supabase-offline");
      });
    }

    function scheduleSupabaseSave(state) {
      pendingState = state;
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(flushSupabaseSave, SUPABASE_SAVE_DEBOUNCE_MS);
    }

    function persist(state) {
      currentState = state;
      var json = JSON.stringify(state);
      lastJson = json;
      if (mode === "supabase" || mode === "supabase-offline") {
        writeLocal(state); // offline cache / fallback, always immediate
        scheduleSupabaseSave(state);
      } else if (mode === "firebase" && ref) {
        ref.set(state).catch(function () { /* surfaced by caller UI if needed */ });
      } else {
        writeLocal(state);
      }
    }

    // One poll tick (also exposed for tests): retry a pending save,
    // then fetch the remote row. A newer updated_at whose normalized
    // state differs replaces local state via the onRemote callbacks.
    function pollOnce() {
      if (!supa) { return Promise.resolve(false); }
      if (pendingState && !saveTimer) { flushSupabaseSave(); }
      return supa.fetchRemote().then(function (remote) {
        setMode("supabase");
        if (!remote || !remote.updatedAt) { return false; }
        if (lastSeenUpdatedAt && remote.updatedAt <= lastSeenUpdatedAt) { return false; }
        var incomingState = normalizeState(remote.state);
        var incomingJson = JSON.stringify(incomingState);
        lastSeenUpdatedAt = remote.updatedAt;
        if (incomingJson === lastJson) { return false; }
        lastJson = incomingJson;
        currentState = incomingState;
        writeLocal(incomingState);
        remoteCbs.forEach(function (cb) { cb(incomingState); });
        return true;
      }).catch(function () {
        setMode("supabase-offline");
        return false;
      });
    }

    function startPolling() {
      if (pollTimer || typeof setInterval === "undefined") { return; }
      pollTimer = setInterval(function () { pollOnce(); }, SUPABASE_POLL_MS);
    }

    function initSupabase(cfg) {
      supa = createSupabaseClient(cfg);
      var local = loadLocal();
      return supa.fetchRemote().then(function (remote) {
        mode = "supabase";
        lastSeenUpdatedAt = remote.updatedAt || "";
        var resolved = resolveInitialState(remote.state, local);
        currentState = resolved.state;
        lastJson = JSON.stringify(resolved.state);
        writeLocal(resolved.state);
        startPolling();
        if (!resolved.shouldPush) { return resolved.state; }
        // First-device seeding: remote is empty, this device has the
        // data — push it up so every other device sees the same shop.
        var iso = new Date().toISOString();
        return supa.pushState(resolved.state, iso).then(function () {
          lastSeenUpdatedAt = iso;
          return resolved.state;
        }).catch(function () {
          setMode("supabase-offline");
          pendingState = resolved.state;
          return resolved.state;
        });
      }).catch(function () {
        // Cloud unreachable on load: run fully from localStorage.
        supa = null;
        mode = "local";
        return local;
      });
    }

    function init() {
      var sc = supabaseConfig();
      if (sc) { return initSupabase(sc); }
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
            currentState = state;
            lastJson = JSON.stringify(state);
            ref.on("value", function (s2) {
              var incoming = JSON.stringify(normalizeState(s2.val()));
              if (incoming !== lastJson) {
                lastJson = incoming;
                var st = JSON.parse(incoming);
                currentState = st;
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
      getMode: function () { return mode; },
      pollOnce: pollOnce
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
    createStore: createStore,
    SUPABASE_POLL_MS: SUPABASE_POLL_MS,
    SUPABASE_SAVE_DEBOUNCE_MS: SUPABASE_SAVE_DEBOUNCE_MS,
    supabaseConfigReady: supabaseConfigReady,
    supabaseSelectUrl: supabaseSelectUrl,
    supabaseHeaders: supabaseHeaders,
    supabaseUpsertRequest: supabaseUpsertRequest,
    parseSupabaseRows: parseSupabaseRows,
    stateHasData: stateHasData,
    resolveInitialState: resolveInitialState,
    createSupabaseClient: createSupabaseClient
  };
});
