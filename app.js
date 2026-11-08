/*
 * Hamza Departmental Store — Terminal UI
 * Plain static app. All state goes through HamzaData.normalizeState
 * and HamzaData.createStore (Firebase RTDB when configured, else
 * localStorage). Starts EMPTY — no sample shop data is seeded.
 */
(function () {
  "use strict";
  var D = window.HamzaData, L = window.HamzaLookup;

  var store = D.createStore();
  var state = D.emptyState();
  var tab = "dashboard";
  var cart = [];               // [{productId, qty}]
  var cartDiscountRs = 0;
  var cartPayment = "Cash";
  var cartCustomer = "";
  var billSearch = "", stockSearch = "", stockCat = "All";
  var loaded = false;

  /* ---------------- helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtRs(paisa) {
    var v = Math.round(Number(paisa) || 0) / 100;
    var s = Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: (Math.round(v * 100) % 100 === 0) ? 0 : 2, maximumFractionDigits: 2 });
    return (v < 0 ? "-Rs " : "Rs ") + s;
  }
  function toPaisa(rs) { var n = parseFloat(rs); return isFinite(n) ? Math.round(n * 100) : 0; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function nowIso() { return new Date().toISOString(); }
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3400);
  }
  function save() { store.save(state); renderTabs(); }
  function daysUntil(dateStr) {
    if (!dateStr) { return null; }
    var a = new Date(todayStr() + "T00:00:00"), b = new Date(dateStr + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function toCsv(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? "" : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
  }
  function simpleHash(s) { // obfuscation only — a shop gate, not strong security
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return "h" + (h >>> 0).toString(16);
  }

  /* ---------------- PIN gate ---------------- */
  function showGate() {
    var gate = $("#pinGate");
    var hasPin = !!state.settings.pin;
    if (sessionStorage.getItem("hamza_unlocked") === "1") { gate.innerHTML = ""; return; }
    gate.innerHTML =
      '<div class="gate"><div class="box">' +
      "<h2>Hamza Departmental Store</h2>" +
      (hasPin
        ? '<p class="muted">Enter the shop PIN to open the terminal.</p>'
        : '<p class="muted">Welcome. Set a shop PIN first — you will use it to open the terminal on any device.</p>') +
      '<input id="gatePin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">' +
      (hasPin ? "" : '<input id="gatePin2" type="password" inputmode="numeric" autocomplete="off" placeholder="Repeat PIN" style="margin-top:10px">') +
      '<p class="small" id="gateErr" style="color:var(--red)"></p>' +
      '<button class="btn" id="gateBtn" style="width:100%">' + (hasPin ? "Open Terminal" : "Set PIN & Open") + "</button>" +
      "</div></div>";
    $("#gateBtn").addEventListener("click", function () {
      var pin = $("#gatePin").value.trim();
      var err = $("#gateErr");
      if (pin.length < 4) { err.textContent = "PIN must be at least 4 digits."; return; }
      if (hasPin) {
        if (simpleHash(pin) !== state.settings.pin) { err.textContent = "Wrong PIN. Try again."; return; }
      } else {
        if (pin !== $("#gatePin2").value.trim()) { err.textContent = "PINs do not match."; return; }
        state.settings.pin = simpleHash(pin);
        save();
      }
      sessionStorage.setItem("hamza_unlocked", "1");
      gate.innerHTML = "";
      render();
    });
  }

  /* ---------------- navigation ---------------- */
  var TABS = [
    ["dashboard", "Dashboard"], ["counter", "Bill Counter"], ["stock", "Stock"],
    ["purchases", "Purchases"], ["khata", "Khata"], ["bills", "Bills"],
    ["reports", "Reports"], ["settings", "Settings"]
  ];
  function renderTabs() {
    var pending = state.products.filter(function (p) { return p.salePaisa === 0; }).length;
    $("#tabs").innerHTML = TABS.map(function (t) {
      var badge = (t[0] === "stock" && pending > 0) ? '<span class="badge">' + pending + "</span>" : "";
      return '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? "active" : "") + '">' + t[1] + badge + "</button>";
    }).join("");
    Array.prototype.forEach.call($("#tabs").querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { tab = b.getAttribute("data-tab"); render(); });
    });
    $("#dataMode").textContent = "Data: " + (store.getMode() === "firebase" ? "Cloud (Firebase) — synced on all devices" : "This device only (local demo mode)");
  }

  function render() {
    if (!loaded) { $("#view").innerHTML = '<div class="panel">Loading…</div>'; return; }
    renderTabs();
    var v = $("#view");
    if (tab === "dashboard") { v.innerHTML = viewDashboard(); bindDashboard(); }
    else if (tab === "counter") { v.innerHTML = viewCounter(); bindCounter(); }
    else if (tab === "stock") { v.innerHTML = viewStock(); bindStock(); }
    else if (tab === "purchases") { v.innerHTML = viewPurchases(); bindPurchases(); }
    else if (tab === "khata") { v.innerHTML = viewKhata(); bindKhata(); }
    else if (tab === "bills") { v.innerHTML = viewBills(); bindBills(); }
    else if (tab === "reports") { v.innerHTML = viewReports(); bindReports(); }
    else if (tab === "settings") { v.innerHTML = viewSettings(); bindSettings(); }
  }

  /* ---------------- Dashboard ---------------- */
  function viewDashboard() {
    var d = D.computeDashboard(state, todayStr());
    var max = Math.max.apply(null, d.last7Days.map(function (x) { return x.salePaisa; }).concat([1]));
    var bars = d.last7Days.map(function (x) {
      var h = Math.max(3, Math.round((x.salePaisa / max) * 100));
      var label = x.date.slice(5);
      return '<div class="bar"><b>' + (x.salePaisa ? fmtRs(x.salePaisa) : "") + '</b><i style="height:' + h + '%"></i><span>' + label + "</span></div>";
    }).join("");
    var alerts = "";
    d.lowStock.slice(0, 6).forEach(function (p) {
      alerts += '<div class="alert amber">Low stock: <b>' + esc(p.name) + "</b> — only " + p.stock + " " + esc(p.unit) + " left.</div>";
    });
    d.expiring.slice(0, 6).forEach(function (p) {
      var dd = daysUntil(p.expiry);
      alerts += '<div class="alert ' + (dd < 0 ? "red" : "amber") + '">Expiry: <b>' + esc(p.name) + "</b> — " +
        (dd < 0 ? "expired " + Math.abs(dd) + " day(s) ago" : "expires in " + dd + " day(s)") + " (" + esc(p.expiry) + ").</div>";
    });
    if (d.pendingRates.length) {
      alerts += '<div class="alert amber"><b>' + d.pendingRates.length + ' item(s)</b> still need a sale rate. Open the Stock tab and use “Rate set karna baqi”.</div>';
    }
    if (!alerts) { alerts = '<p class="muted">No alerts. Stock levels and expiry dates look fine.</p>'; }
    return (
      '<div class="cards">' +
      card("Today's Sale", fmtRs(d.todaySalePaisa)) +
      card("Today's Profit (est.)", fmtRs(d.todayProfitPaisa)) +
      card("Stock Value (at purchase rate)", fmtRs(d.stockValuePaisa)) +
      card("Items in Stock", d.productCount) +
      card("Udhaar Outstanding", fmtRs(d.totalUdhaarPaisa)) +
      "</div>" +
      '<div class="panel"><h3>Sales — Last 7 Days</h3><div class="chart">' + bars + "</div></div>" +
      '<div class="panel"><h3>Alerts</h3>' + alerts + "</div>"
    );
  }
  function card(k, v) { return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>"; }
  function bindDashboard() {}

  /* ---------------- modal ---------------- */
  function openModal(html) {
    $("#modalRoot").innerHTML = '<div class="overlay"><div class="modal">' + html + "</div></div>";
    $("#modalRoot .overlay").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) { closeModal(); }
    });
  }
  function closeModal() { $("#modalRoot").innerHTML = ""; }

  /* ---------------- Stock ---------------- */
  function rateTag(p) { return p.salePaisa === 0 ? ' <span class="tag amber">Rate set karna baqi</span>' : ""; }
  function stockStatus(p) {
    var tags = "";
    if (p.stock <= state.settings.lowStockThreshold) { tags += ' <span class="tag red">Low stock</span>'; }
    var dd = daysUntil(p.expiry);
    if (dd !== null && dd < 0) { tags += ' <span class="tag red">Expired</span>'; }
    else if (dd !== null && dd <= state.settings.expiryAlertDays) { tags += ' <span class="tag amber">Expiring soon</span>'; }
    return tags;
  }

  function viewStock() {
    var list = state.products.filter(function (p) {
      var okCat = stockCat === "All" || p.category === stockCat;
      var okQ = !stockSearch || p.name.toLowerCase().indexOf(stockSearch) >= 0 || String(p.code).indexOf(stockSearch) >= 0;
      return okCat && okQ;
    });
    var pending = state.products.filter(function (p) { return p.salePaisa === 0; });
    var rows = list.map(function (p) {
      return "<tr><td><b>" + esc(p.name) + "</b>" + rateTag(p) + stockStatus(p) +
        '<div class="small muted">' + esc(p.code || "—") + (p.brand ? " · " + esc(p.brand) : "") + "</div></td>" +
        "<td>" + esc(p.category) + "</td><td>" + p.stock + " " + esc(p.unit) + "</td>" +
        "<td>" + fmtRs(p.purchasePaisa) + "</td><td>" + (p.salePaisa ? fmtRs(p.salePaisa) : "—") + "</td>" +
        "<td>" + esc(p.expiry || "—") + "</td>" +
        '<td><div class="row">' +
        '<button class="btn small secondary" data-act="restock" data-id="' + p.id + '">+ Stock</button>' +
        '<button class="btn small secondary" data-act="qr" data-id="' + p.id + '">QR Label</button>' +
        '<button class="btn small secondary" data-act="edit" data-id="' + p.id + '">Edit</button>' +
        '<button class="btn small danger" data-act="del" data-id="' + p.id + '">Delete</button>' +
        "</div></td></tr>";
    }).join("");
    var pendingHtml = "";
    if (pending.length) {
      pendingHtml = '<div class="panel"><h3>Rate set karna baqi (' + pending.length + ')</h3>' +
        '<p class="small muted">These items are in stock but have no sale rate yet. Set all rates here in one go.</p>' +
        pending.map(function (p) {
          return '<div class="row spread" style="border-bottom:1px solid var(--line);padding:6px 0"><span><b>' + esc(p.name) +
            '</b> <span class="muted small">' + esc(p.code) + '</span></span>' +
            '<span class="row"><input type="number" min="0" step="any" placeholder="Sale rate (Rs)" data-rate-for="' + p.id + '" style="width:150px">' +
            "</span></div>";
        }).join("") +
        '<div class="mt"><button class="btn" id="saveAllRates">Save All Rates</button></div></div>';
    }
    return (
      '<div class="panel"><div class="row spread"><h2>Stock / Inventory</h2>' +
      '<div class="row"><button class="btn warn" id="scanStock">Scan Karke Stock Mein Add Karein</button>' +
      '<button class="btn" id="addItem">+ Add Item</button></div></div>' +
      '<p class="small muted">Scan a product barcode: if the item already exists you can increase its quantity; ' +
      'if it is new, its name, brand, size and category are filled automatically from online product databases — nothing to type. ' +
      'The sale rate can be left empty; the item still saves and appears under “Rate set karna baqi”.</p>' +
      '<div class="row mt"><input id="stockSearch" placeholder="Search name or code…" value="' + esc(stockSearch) + '" style="max-width:280px">' +
      '<select id="stockCat" style="max-width:220px"><option>All</option>' +
      D.CATEGORIES.map(function (c) { return '<option ' + (stockCat === c ? "selected" : "") + ">" + c + "</option>"; }).join("") +
      "</select></div></div>" +
      pendingHtml +
      '<div class="panel"><table><thead><tr><th>Item</th><th>Category</th><th>Stock</th><th>Purchase</th><th>Sale</th><th>Expiry</th><th>Actions</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="muted">No items yet. Add your first item, or scan a product barcode.</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function bindStock() {
    $("#addItem").addEventListener("click", function () { openProductForm(null, {}); });
    $("#scanStock").addEventListener("click", function () {
      window.HamzaScanner.open({
        title: "Scan — Stock Mein Add Karein", continuous: false,
        onCode: function (code) { handleStockCode(code); }
      });
    });
    var s = $("#stockSearch");
    s.addEventListener("input", function () {
      stockSearch = s.value.trim().toLowerCase();
      var pos = s.selectionStart; render(); var n = $("#stockSearch");
      n.focus(); n.setSelectionRange(pos, pos);
    });
    $("#stockCat").addEventListener("change", function (e) { stockCat = e.target.value; render(); });
    var saveRates = $("#saveAllRates");
    if (saveRates) {
      saveRates.addEventListener("click", function () {
        var n = 0;
        Array.prototype.forEach.call(document.querySelectorAll("[data-rate-for]"), function (inp) {
          var v = toPaisa(inp.value);
          if (v > 0) {
            var p = D.findProduct(state, inp.getAttribute("data-rate-for"));
            if (p) { p.salePaisa = v; n++; }
          }
        });
        save(); render();
        toast(n ? n + " rate(s) saved." : "No rates entered.");
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-act]"), function (b) {
      b.addEventListener("click", function () {
        var p = D.findProduct(state, b.getAttribute("data-id"));
        if (!p) { return; }
        var act = b.getAttribute("data-act");
        if (act === "edit") { openProductForm(p, {}); }
        else if (act === "restock") { openRestock(p, null); }
        else if (act === "qr") { openQrLabel(p); }
        else if (act === "del") {
          if (confirm("Delete " + p.name + " from stock?")) {
            state.products = state.products.filter(function (x) { return x.id !== p.id; });
            save(); render(); toast("Item deleted.");
          }
        }
      });
    });
  }

  // Scan-to-stock: existing code -> restock; new code -> lookup + prefilled form
  function handleStockCode(code) {
    var existing = D.findByCode(state, code);
    if (existing) {
      toast("Item found in stock: " + existing.name);
      openRestock(existing, reopenScanner);
      return;
    }
    toast("New code — looking it up online…");
    L.lookupBarcode(code).then(function (res) {
      var pre = { code: code };
      if (res.found) {
        pre.name = res.name; pre.brand = res.brand; pre.size = res.size; pre.category = res.category;
        toast("Found online: " + res.name + " (" + res.source + "). Just confirm quantity — rate can be set later.");
      } else {
        toast("This code is not in any online database (local/unbranded item). Type the name once — every later scan will be automatic.");
      }
      openProductForm(null, { prefill: pre, scanAgain: true });
    });
  }
  function reopenScanner() {
    window.HamzaScanner.open({
      title: "Scan — Stock Mein Add Karein", continuous: false,
      onCode: function (code) { handleStockCode(code); }
    });
  }

  function categoryOptions(sel) {
    return D.CATEGORIES.map(function (c) { return '<option ' + (sel === c ? "selected" : "") + ">" + c + "</option>"; }).join("");
  }
  function unitOptions(sel) {
    return D.UNITS.map(function (u) { return '<option ' + (sel === u ? "selected" : "") + ">" + u + "</option>"; }).join("");
  }

  function openProductForm(product, opts) {
    opts = opts || {};
    var pre = product || opts.prefill || {};
    var isNew = !product;
    openModal(
      "<h3>" + (isNew ? "Add Item to Stock" : "Edit Item") + "</h3>" +
      '<label class="f">Barcode / QR code<input id="pfCode" value="' + esc(pre.code || "") + '" placeholder="Scan or type — leave empty to auto-generate"></label>' +
      '<label class="f">Item name<input id="pfName" value="' + esc(pre.name || "") + '" placeholder="e.g. Surf Excel 1 kg"></label>' +
      '<div class="grid2"><label class="f">Brand<input id="pfBrand" value="' + esc(pre.brand || "") + '"></label>' +
      '<label class="f">Pack size<input id="pfSize" value="' + esc(pre.size || "") + '" placeholder="e.g. 400 g"></label></div>' +
      '<div class="grid2"><label class="f">Category<select id="pfCat">' + categoryOptions(pre.category || "Grocery") + "</select></label>" +
      '<label class="f">Unit<select id="pfUnit">' + unitOptions(pre.unit || "piece") + "</select></label></div>" +
      '<div class="grid3"><label class="f">Purchase rate (Rs)<input id="pfPurchase" type="number" min="0" step="any" value="' + (pre.purchasePaisa ? pre.purchasePaisa / 100 : "") + '"></label>' +
      '<label class="f">Sale rate (Rs) — can be set later<input id="pfSale" type="number" min="0" step="any" value="' + (pre.salePaisa ? pre.salePaisa / 100 : "") + '"></label>' +
      '<label class="f">Stock quantity<input id="pfStock" type="number" min="0" step="any" value="' + (pre.stock != null ? pre.stock : 1) + '"></label></div>' +
      '<label class="f">Expiry date (optional)<input id="pfExpiry" type="date" value="' + esc(pre.expiry || "") + '"></label>' +
      '<div class="row mt"><button class="btn" id="pfSave">' + (isNew ? "Save Item" : "Save Changes") + "</button>" +
      (opts.scanAgain ? '<button class="btn warn" id="pfSaveNext">Save + Next Scan</button>' : "") +
      '<button class="btn-ghost" id="pfCancel">Cancel</button></div>'
    );
    $("#pfCancel").addEventListener("click", closeModal);
    var nameEl = $("#pfName");
    if (nameEl && !nameEl.value) { nameEl.focus(); }
    else { var saleEl = $("#pfSale"); if (saleEl) { saleEl.focus(); } }
    function doSave(next) {
      var name = $("#pfName").value.trim();
      if (!name) { toast("Please enter the item name."); return; }
      var data = {
        code: $("#pfCode").value.trim(),
        name: name,
        brand: $("#pfBrand").value.trim(),
        size: $("#pfSize").value.trim(),
        category: $("#pfCat").value,
        unit: $("#pfUnit").value,
        purchasePaisa: toPaisa($("#pfPurchase").value),
        salePaisa: toPaisa($("#pfSale").value),
        stock: parseFloat($("#pfStock").value) || 0,
        expiry: $("#pfExpiry").value || ""
      };
      if (product) {
        Object.keys(data).forEach(function (k) { product[k] = data[k]; });
        toast("Item updated.");
      } else {
        data.id = D.uid("prod");
        data.createdAt = nowIso();
        if (!data.code) { data.code = "HDS" + Date.now().toString(36).toUpperCase(); }
        var dup = D.findByCode(state, data.code);
        if (dup) { toast("This code already exists in stock (" + dup.name + ")."); return; }
        state.products.push(D.normalizeProduct(data));
        toast(data.salePaisa ? "Item added to stock." : "Item added to stock — rate pending (see “Rate set karna baqi”).");
      }
      save(); closeModal(); render();
      if (next) { reopenScanner(); }
    }
    $("#pfSave").addEventListener("click", function () { doSave(false); });
    var sn = $("#pfSaveNext");
    if (sn) { sn.addEventListener("click", function () { doSave(true); }); }
  }

  function openRestock(product, afterSave) {
    openModal(
      "<h3>Increase Stock — " + esc(product.name) + "</h3>" +
      '<p class="small muted">Current stock: ' + product.stock + " " + esc(product.unit) + " · Code: " + esc(product.code) + "</p>" +
      '<label class="f">Quantity to add<input id="rfQty" type="number" min="0" step="any" value="1"></label>' +
      '<label class="f">Purchase rate per ' + esc(product.unit) + ' (Rs)<input id="rfRate" type="number" min="0" step="any" value="' + (product.purchasePaisa ? product.purchasePaisa / 100 : "") + '"></label>' +
      '<label class="f">Supplier (optional)<input id="rfSupplier" placeholder="Supplier name"></label>' +
      '<div class="row mt"><button class="btn" id="rfSave">Add to Stock</button>' +
      '<button class="btn-ghost" id="rfCancel">Cancel</button></div>'
    );
    $("#rfCancel").addEventListener("click", closeModal);
    $("#rfSave").addEventListener("click", function () {
      var qty = parseFloat($("#rfQty").value) || 0;
      if (qty <= 0) { toast("Enter a quantity greater than 0."); return; }
      var rate = toPaisa($("#rfRate").value);
      if (rate > 0) { product.purchasePaisa = rate; }
      product.stock = Math.round((product.stock + qty) * 1000) / 1000;
      state.purchases.push({
        id: D.uid("pur"), date: nowIso(), supplier: $("#rfSupplier").value.trim(),
        productId: product.id, code: product.code, name: product.name,
        qty: qty, purchasePaisa: product.purchasePaisa,
        totalPaisa: Math.round(product.purchasePaisa * qty)
      });
      save(); closeModal(); render();
      toast("Stock increased: " + product.name + " is now " + product.stock + " " + product.unit + ".");
      if (typeof afterSave === "function") { afterSave(); }
    });
  }

  function openQrLabel(product) {
    var html = "<h3>QR Label</h3>" +
      '<div class="qrbox"><div id="qrTarget"></div>' +
      "<b>" + esc(product.name) + "</b><div class='small muted'>" + esc(product.code) + " · " +
      (product.salePaisa ? fmtRs(product.salePaisa) : "Rate pending") + "</div></div>" +
      '<div class="row mt" style="justify-content:center"><button class="btn" id="qrPrint">Print Label</button>' +
      '<button class="btn-ghost" id="qrClose">Close</button></div>';
    openModal(html);
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(String(product.code));
      qr.make();
      $("#qrTarget").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 8, scalable: true });
    } catch (e) {
      $("#qrTarget").innerHTML = '<p class="muted">QR could not be drawn — code: ' + esc(product.code) + "</p>";
    }
    $("#qrClose").addEventListener("click", closeModal);
    $("#qrPrint").addEventListener("click", function () {
      var w = window.open("", "_blank");
      w.document.write("<html><head><title>Label</title></head><body style='text-align:center;font-family:sans-serif'>" +
        $("#qrTarget").innerHTML + "<div><b>" + esc(product.name) + "</b></div><div>" + esc(product.code) + "</div></body></html>");
      w.document.close(); w.focus(); w.print();
    });
  }

  /* ---------------- Bill Counter ---------------- */
  function cartLines() {
    return cart.map(function (c) {
      var p = D.findProduct(state, c.productId);
      if (!p) { return null; }
      return { productId: p.id, code: p.code, name: p.name, unit: p.unit, qty: c.qty, salePaisa: p.salePaisa, purchasePaisa: p.purchasePaisa, stock: p.stock };
    }).filter(Boolean);
  }
  function addToCart(productId, qty) {
    var line = cart.filter(function (c) { return c.productId === productId; })[0];
    if (line) { line.qty = Math.round((line.qty + (qty || 1)) * 1000) / 1000; }
    else { cart.push({ productId: productId, qty: qty || 1 }); }
  }

  function viewCounter() {
    var tiles = state.products.filter(function (p) {
      return !billSearch || p.name.toLowerCase().indexOf(billSearch) >= 0 || String(p.code).indexOf(billSearch) >= 0;
    }).map(function (p) {
      return '<button class="tile" data-tile="' + p.id + '"><div class="n">' + esc(p.name) + "</div>" +
        '<div class="p">' + (p.salePaisa ? fmtRs(p.salePaisa) : "Rate pending") + "</div>" +
        '<div class="s">' + p.stock + " " + esc(p.unit) + " in stock</div>" +
        (p.salePaisa === 0 ? '<span class="tag amber">Rate set karna baqi</span>' : "") + "</button>";
    }).join("");
    var lines = cartLines();
    var totals = D.computeBillTotals(lines, toPaisa(cartDiscountRs));
    var cartHtml = lines.map(function (l, i) {
      return '<div class="cartline"><div class="nm"><b>' + esc(l.name) + "</b>" +
        (l.salePaisa === 0 ? ' <span class="tag amber">Rate pending — will bill at Rs 0</span>' : "") +
        '<div class="small muted">' + fmtRs(l.salePaisa) + " / " + esc(l.unit) + "</div></div>" +
        '<div class="qty"><button data-dec="' + i + '">−</button>' +
        '<input data-qty="' + i + '" type="number" min="0" step="any" value="' + l.qty + '">' +
        '<button data-inc="' + i + '">+</button></div>' +
        "<b>" + fmtRs(l.salePaisa * l.qty) + "</b>" +
        '<button class="btn-ghost" data-rm="' + i + '">✕</button></div>';
    }).join("");
    return (
      '<div class="counter"><div class="panel"><div class="row spread"><h2>Bill Counter</h2>' +
      '<button class="btn warn" id="scanBill">Scan Item</button></div>' +
      '<input id="billSearch" placeholder="Search items to add…" value="' + esc(billSearch) + '" class="mt">' +
      '<div class="tiles mt">' + (tiles || '<p class="muted">No items in stock yet. Add items from the Stock tab first.</p>') + "</div></div>" +
      '<div class="panel"><h3>Current Bill</h3>' +
      (cartHtml || '<p class="muted">Tap an item, or scan its barcode/QR, to add it here.</p>') +
      '<div class="mt"><label class="f">Discount (Rs)<input id="billDiscount" type="number" min="0" step="any" value="' + (cartDiscountRs || "") + '"></label>' +
      '<label class="f">Payment method<select id="billPayment">' +
      D.PAYMENT_METHODS.map(function (m) { return '<option ' + (cartPayment === m ? "selected" : "") + ">" + m + "</option>"; }).join("") + "</select></label>" +
      '<label class="f">Customer name (required for Udhaar)<input id="billCustomer" value="' + esc(cartCustomer) + '" placeholder="Walk-in customer"></label></div>' +
      '<div class="totalrow"><span>Subtotal</span><span>' + fmtRs(totals.subtotalPaisa) + "</span></div>" +
      '<div class="totalrow"><span>Discount</span><span>− ' + fmtRs(totals.discountPaisa) + "</span></div>" +
      '<div class="totalrow grand"><span>Total</span><span>' + fmtRs(totals.totalPaisa) + "</span></div>" +
      (totals.hasPendingRate ? '<div class="alert amber mt">Warning: one or more items have no sale rate yet and will be billed at Rs 0. Set rates in the Stock tab.</div>' : "") +
      '<button class="btn" id="completeBill" style="width:100%;margin-top:10px">Bill Banao — Complete Bill</button>' +
      '<button class="btn-ghost" id="clearBill" style="width:100%;margin-top:8px">Clear Bill</button>' +
      "</div></div>"
    );
  }

  function bindCounter() {
    $("#scanBill").addEventListener("click", function () {
      window.HamzaScanner.open({
        title: "Scan — Bill Mein Add Karein", continuous: true,
        onCode: function (code) {
          var p = D.findByCode(state, code);
          if (p) {
            addToCart(p.id, 1);
            toast("Added to bill: " + p.name + (p.salePaisa === 0 ? " (rate pending — Rs 0)" : ""));
            render();
          } else {
            L.lookupBarcode(code).then(function (res) {
              toast(res.found
                ? "“" + res.name + "” is not in stock yet. Add it from Stock → Scan first, then it will bill automatically."
                : "This code is not in stock. Add it from Stock → Scan first.");
            });
          }
        }
      });
    });
    var bs = $("#billSearch");
    bs.addEventListener("input", function () {
      billSearch = bs.value.trim().toLowerCase();
      var pos = bs.selectionStart, val = bs.value;
      render(); var n = $("#billSearch"); n.focus(); n.value = val; n.setSelectionRange(pos, pos);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-tile]"), function (t) {
      t.addEventListener("click", function () { addToCart(t.getAttribute("data-tile"), 1); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-inc]"), function (b) {
      b.addEventListener("click", function () {
        var line = cart[Number(b.getAttribute("data-inc"))];
        var p = D.findProduct(state, line.productId);
        var step = (p && (p.unit === "kg" || p.unit === "litre")) ? 0.25 : 1;
        line.qty = Math.round((line.qty + step) * 1000) / 1000; render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-dec]"), function (b) {
      b.addEventListener("click", function () {
        var line = cart[Number(b.getAttribute("data-dec"))];
        var p = D.findProduct(state, line.productId);
        var step = (p && (p.unit === "kg" || p.unit === "litre")) ? 0.25 : 1;
        line.qty = Math.round((line.qty - step) * 1000) / 1000;
        if (line.qty <= 0) { cart.splice(cart.indexOf(line), 1); }
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-qty]"), function (inp) {
      inp.addEventListener("change", function () {
        var line = cart[Number(inp.getAttribute("data-qty"))];
        var v = parseFloat(inp.value);
        if (!isFinite(v) || v <= 0) { cart.splice(cart.indexOf(line), 1); }
        else { line.qty = v; }
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-rm]"), function (b) {
      b.addEventListener("click", function () { cart.splice(Number(b.getAttribute("data-rm")), 1); render(); });
    });
    $("#billDiscount").addEventListener("change", function (e) { cartDiscountRs = parseFloat(e.target.value) || 0; render(); });
    $("#billPayment").addEventListener("change", function (e) { cartPayment = e.target.value; render(); });
    $("#billCustomer").addEventListener("change", function (e) { cartCustomer = e.target.value; });
    $("#clearBill").addEventListener("click", function () { cart = []; cartDiscountRs = 0; cartCustomer = ""; render(); });
    $("#completeBill").addEventListener("click", completeBill);
  }

  function completeBill() {
    var lines = cartLines();
    if (!lines.length) { toast("Add at least one item to the bill first."); return; }
    var totals = D.computeBillTotals(lines, toPaisa(cartDiscountRs));
    var over = lines.filter(function (l) { return l.qty > l.stock; });
    if (over.length && !confirm("Some items are being sold more than the stock on record (" +
      over.map(function (l) { return l.name; }).join(", ") + "). Continue anyway?")) { return; }
    if (totals.hasPendingRate && !confirm("Warning: an item in this bill has no sale rate and will be billed at Rs 0. Continue?")) { return; }

    var customerId = "";
    if (cartPayment === "Udhaar") {
      var nm = ($("#billCustomer").value || "").trim();
      if (!nm) { toast("Customer name is required for Udhaar bills."); return; }
      var cust = state.customers.filter(function (c) { return c.name.toLowerCase() === nm.toLowerCase(); })[0];
      if (!cust) {
        cust = { id: D.uid("cust"), name: nm, phone: "", balancePaisa: 0 };
        state.customers.push(cust);
      }
      customerId = cust.id;
      cust.balancePaisa += totals.totalPaisa;
    }
    var bill = {
      id: D.uid("bill"),
      number: state.settings.nextBillNumber,
      date: nowIso(),
      customerName: ($("#billCustomer").value || "").trim() || "Walk-in customer",
      customerId: customerId,
      paymentMethod: cartPayment,
      discountPaisa: totals.discountPaisa,
      totalPaisa: totals.totalPaisa,
      profitPaisa: totals.profitPaisa,
      items: lines.map(function (l) {
        return { productId: l.productId, code: l.code, name: l.name, unit: l.unit, qty: l.qty, salePaisa: l.salePaisa, purchasePaisa: l.purchasePaisa };
      })
    };
    state.settings.nextBillNumber += 1;
    if (customerId) {
      state.khataEntries.push({
        id: D.uid("khata"), customerId: customerId, date: bill.date, type: "credit",
        amountPaisa: totals.totalPaisa, note: "Bill #" + bill.number, billId: bill.id
      });
    }
    state.products = D.applyBillToStock(state.products, lines);
    state.bills.push(bill);
    cart = []; cartDiscountRs = 0; cartCustomer = "";
    save(); render();
    toast("Bill #" + bill.number + " completed — " + fmtRs(bill.totalPaisa) + ". Stock updated.");
    openReceipt(bill);
  }

  function receiptText(bill) {
    var lines = ["HAMZA DEPARTMENTAL STORE", "Bill #" + bill.number + "  " + new Date(bill.date).toLocaleString(),
      "Customer: " + bill.customerName, "--------------------------------"];
    bill.items.forEach(function (it) {
      lines.push(it.name + "  x" + it.qty + " " + it.unit + "  " + fmtRs(it.salePaisa * it.qty));
    });
    lines.push("--------------------------------");
    if (bill.discountPaisa) { lines.push("Discount: -" + fmtRs(bill.discountPaisa)); }
    lines.push("TOTAL: " + fmtRs(bill.totalPaisa), "Payment: " + bill.paymentMethod, "Thank you for shopping!");
    return lines.join("\n");
  }

  function openReceipt(bill) {
    openModal(
      "<h3>Receipt — Bill #" + bill.number + "</h3>" +
      '<pre class="small" style="white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:8px">' + esc(receiptText(bill)) + "</pre>" +
      '<div class="row mt"><button class="btn" id="rcPrint">Print Receipt</button>' +
      '<button class="btn secondary" id="rcWa">Share on WhatsApp</button>' +
      '<button class="btn-ghost" id="rcClose">Close</button></div>'
    );
    $("#rcClose").addEventListener("click", closeModal);
    $("#rcWa").addEventListener("click", function () {
      window.open("https://wa.me/?text=" + encodeURIComponent(receiptText(bill)), "_blank");
    });
    $("#rcPrint").addEventListener("click", function () {
      var rp = $("#receiptPrint");
      rp.innerHTML = "<pre>" + esc(receiptText(bill)) + "</pre>";
      rp.style.display = "block";
      window.print();
      setTimeout(function () { rp.style.display = "none"; }, 500);
    });
  }

  /* ---------------- Bills history ---------------- */
  function viewBills() {
    var rows = state.bills.slice().sort(function (a, b) { return b.number - a.number; }).map(function (b) {
      return "<tr><td><b>#" + b.number + "</b><div class='small muted'>" + esc(new Date(b.date).toLocaleString()) + "</div></td>" +
        "<td>" + esc(b.customerName) + "</td><td>" + b.items.length + " item(s)</td>" +
        "<td>" + esc(b.paymentMethod) + "</td><td><b>" + fmtRs(b.totalPaisa) + "</b></td>" +
        '<td><button class="btn small secondary" data-receipt="' + b.id + '">Receipt</button></td></tr>';
    }).join("");
    return '<div class="panel"><h2>Bill History</h2><table><thead><tr><th>Bill</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="muted">No bills yet.</td></tr>') + "</tbody></table></div>";
  }
  function bindBills() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-receipt]"), function (b) {
      b.addEventListener("click", function () {
        var bill = state.bills.filter(function (x) { return x.id === b.getAttribute("data-receipt"); })[0];
        if (bill) { openReceipt(bill); }
      });
    });
  }

  /* ---------------- Purchases ---------------- */
  function viewPurchases() {
    var rows = state.purchases.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).map(function (p) {
      return "<tr><td>" + esc(new Date(p.date).toLocaleDateString()) + "</td><td>" + esc(p.supplier || "—") +
        "</td><td><b>" + esc(p.name) + "</b></td><td>" + p.qty + "</td><td>" + fmtRs(p.purchasePaisa) +
        "</td><td>" + fmtRs(p.totalPaisa) + "</td></tr>";
    }).join("");
    var opts = state.products.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + " (" + esc(p.code) + ")</option>"; }).join("");
    return (
      '<div class="panel"><h2>Add Purchase (Stock In)</h2>' +
      (state.products.length
        ? '<div class="grid3"><label class="f">Item<select id="puItem">' + opts + '</select></label>' +
          '<label class="f">Quantity<input id="puQty" type="number" min="0" step="any" value="1"></label>' +
          '<label class="f">Purchase rate per unit (Rs)<input id="puRate" type="number" min="0" step="any"></label></div>' +
          '<label class="f">Supplier<input id="puSupplier" placeholder="Supplier / company name"></label>' +
          '<button class="btn" id="puAdd">Add Purchase — Raise Stock</button>'
        : '<p class="muted">Add an item in Stock first, then record purchases against it.</p>') +
      "</div>" +
      '<div class="panel"><h3>Purchase Record</h3><table><thead><tr><th>Date</th><th>Supplier</th><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="muted">No purchases recorded yet.</td></tr>') + "</tbody></table></div>"
    );
  }
  function bindPurchases() {
    var btn = $("#puAdd");
    if (!btn) { return; }
    btn.addEventListener("click", function () {
      var p = D.findProduct(state, $("#puItem").value);
      var qty = parseFloat($("#puQty").value) || 0;
      var rate = toPaisa($("#puRate").value);
      if (!p || qty <= 0) { toast("Select an item and enter a quantity."); return; }
      if (rate > 0) { p.purchasePaisa = rate; }
      p.stock = Math.round((p.stock + qty) * 1000) / 1000;
      state.purchases.push({
        id: D.uid("pur"), date: nowIso(), supplier: $("#puSupplier").value.trim(),
        productId: p.id, code: p.code, name: p.name, qty: qty,
        purchasePaisa: p.purchasePaisa, totalPaisa: Math.round(p.purchasePaisa * qty)
      });
      save(); render(); toast("Purchase recorded — stock raised for " + p.name + ".");
    });
  }

  /* ---------------- Khata (Udhaar) ---------------- */
  function viewKhata() {
    var cards = state.customers.map(function (c) {
      var entries = state.khataEntries.filter(function (e) { return e.customerId === c.id; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      var rows = entries.map(function (e) {
        return "<tr><td>" + esc(new Date(e.date).toLocaleDateString()) + "</td><td>" + esc(e.note || (e.type === "credit" ? "Udhaar" : "Payment")) +
          "</td><td>" + (e.type === "credit" ? "Credit" : "Payment") + "</td><td>" +
          (e.type === "credit" ? "+" : "−") + " " + fmtRs(e.amountPaisa) + "</td></tr>";
      }).join("");
      return '<div class="panel"><div class="row spread"><h3>' + esc(c.name) +
        (c.phone ? ' <span class="small muted">' + esc(c.phone) + "</span>" : "") + "</h3>" +
        '<span><b>Balance due: ' + fmtRs(c.balancePaisa) + "</b> " +
        '<button class="btn small" data-pay="' + c.id + '">Receive Payment</button></span></div>' +
        "<table><thead><tr><th>Date</th><th>Detail</th><th>Type</th><th>Amount</th></tr></thead><tbody>" +
        (rows || '<tr><td colspan="4" class="muted">No entries yet.</td></tr>') + "</tbody></table></div>";
    }).join("");
    return (
      '<div class="panel"><div class="row spread"><h2>Khata — Udhaar Customers</h2>' +
      '<button class="btn" id="addCustomer">+ Add Customer</button></div>' +
      '<p class="small muted">Customers are also created automatically when a bill is completed on Udhaar.</p></div>' +
      (cards || '<div class="panel"><p class="muted">No khata customers yet.</p></div>')
    );
  }
  function bindKhata() {
    $("#addCustomer").addEventListener("click", function () {
      openModal("<h3>Add Customer</h3>" +
        '<label class="f">Name<input id="cuName"></label>' +
        '<label class="f">Phone (optional)<input id="cuPhone"></label>' +
        '<div class="row mt"><button class="btn" id="cuSave">Save Customer</button>' +
        '<button class="btn-ghost" id="cuCancel">Cancel</button></div>');
      $("#cuCancel").addEventListener("click", closeModal);
      $("#cuSave").addEventListener("click", function () {
        var nm = $("#cuName").value.trim();
        if (!nm) { toast("Enter the customer name."); return; }
        state.customers.push({ id: D.uid("cust"), name: nm, phone: $("#cuPhone").value.trim(), balancePaisa: 0 });
        save(); closeModal(); render(); toast("Customer added.");
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), function (b) {
      b.addEventListener("click", function () {
        var c = state.customers.filter(function (x) { return x.id === b.getAttribute("data-pay"); })[0];
        if (!c) { return; }
        openModal("<h3>Receive Payment — " + esc(c.name) + "</h3>" +
          '<p class="small muted">Balance due: ' + fmtRs(c.balancePaisa) + "</p>" +
          '<label class="f">Amount received (Rs)<input id="payAmt" type="number" min="0" step="any"></label>' +
          '<div class="row mt"><button class="btn" id="paySave">Save Payment</button>' +
          '<button class="btn-ghost" id="payCancel">Cancel</button></div>');
        $("#payCancel").addEventListener("click", closeModal);
        $("#paySave").addEventListener("click", function () {
          var amt = toPaisa($("#payAmt").value);
          if (amt <= 0) { toast("Enter the amount received."); return; }
          c.balancePaisa -= amt;
          state.khataEntries.push({
            id: D.uid("khata"), customerId: c.id, date: nowIso(), type: "payment",
            amountPaisa: amt, note: "Payment received", billId: ""
          });
          save(); closeModal(); render(); toast("Payment recorded. New balance: " + fmtRs(c.balancePaisa) + ".");
        });
      });
    });
  }

  /* ---------------- Reports ---------------- */
  function reportData() {
    var byDay = {};
    state.bills.forEach(function (b) {
      var d = String(b.date).slice(0, 10);
      if (!byDay[d]) { byDay[d] = { date: d, sale: 0, profit: 0, bills: 0 }; }
      byDay[d].sale += b.totalPaisa; byDay[d].profit += b.profitPaisa; byDay[d].bills += 1;
    });
    var days = Object.keys(byDay).sort().reverse().slice(0, 30).map(function (k) { return byDay[k]; });
    var totalSale = state.bills.reduce(function (s, b) { return s + b.totalPaisa; }, 0);
    var totalProfit = state.bills.reduce(function (s, b) { return s + b.profitPaisa; }, 0);
    var qtyByName = {};
    state.bills.forEach(function (b) {
      b.items.forEach(function (it) { qtyByName[it.name] = (qtyByName[it.name] || 0) + it.qty; });
    });
    var top = Object.keys(qtyByName).map(function (n) { return { name: n, qty: qtyByName[n] }; })
      .sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    return { days: days, totalSale: totalSale, totalProfit: totalProfit, top: top };
  }
  function viewReports() {
    var r = reportData();
    var rows = r.days.map(function (d) {
      return "<tr><td>" + d.date + "</td><td>" + d.bills + "</td><td>" + fmtRs(d.sale) + "</td><td>" + fmtRs(d.profit) + "</td></tr>";
    }).join("");
    var top = r.top.map(function (t) { return "<tr><td>" + esc(t.name) + "</td><td>" + t.qty + "</td></tr>"; }).join("");
    return (
      '<div class="cards">' + card("Total Sale (all time)", fmtRs(r.totalSale)) +
      card("Total Profit (est., all time)", fmtRs(r.totalProfit)) +
      card("Total Bills", state.bills.length) +
      card("Udhaar Outstanding", fmtRs(state.customers.reduce(function (s, c) { return s + c.balancePaisa; }, 0))) + "</div>" +
      '<div class="panel"><h3>Daily Sales — Last 30 Days</h3><table><thead><tr><th>Date</th><th>Bills</th><th>Sale</th><th>Profit (est.)</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="muted">No sales yet.</td></tr>') + "</tbody></table></div>" +
      '<div class="panel"><h3>Top Selling Items</h3><table><thead><tr><th>Item</th><th>Qty Sold</th></tr></thead><tbody>' +
      (top || '<tr><td colspan="2" class="muted">No sales yet.</td></tr>') + "</tbody></table></div>" +
      '<div class="panel"><h3>Backup / Export (CSV)</h3><div class="row">' +
      '<button class="btn secondary" id="expProducts">Products CSV</button>' +
      '<button class="btn secondary" id="expBills">Bills CSV</button>' +
      '<button class="btn secondary" id="expPurchases">Purchases CSV</button>' +
      '<button class="btn secondary" id="expKhata">Khata CSV</button>' +
      '<button class="btn" id="expAll">Full Backup (JSON)</button></div>' +
      '<p class="small muted mt">Keep a backup file safe. The JSON backup can be restored from Settings.</p></div>'
    );
  }
  function bindReports() {
    $("#expProducts").addEventListener("click", function () {
      var rows = [["code", "name", "brand", "size", "category", "unit", "purchase_rate_rs", "sale_rate_rs", "stock", "expiry"]];
      state.products.forEach(function (p) { rows.push([p.code, p.name, p.brand, p.size, p.category, p.unit, p.purchasePaisa / 100, p.salePaisa / 100, p.stock, p.expiry]); });
      download("hamza-products.csv", toCsv(rows), "text/csv");
    });
    $("#expBills").addEventListener("click", function () {
      var rows = [["bill_number", "date", "customer", "payment", "discount_rs", "total_rs", "items"]];
      state.bills.forEach(function (b) {
        rows.push([b.number, b.date, b.customerName, b.paymentMethod, b.discountPaisa / 100, b.totalPaisa / 100,
          b.items.map(function (i) { return i.name + " x" + i.qty; }).join("; ")]);
      });
      download("hamza-bills.csv", toCsv(rows), "text/csv");
    });
    $("#expPurchases").addEventListener("click", function () {
      var rows = [["date", "supplier", "code", "item", "qty", "rate_rs", "total_rs"]];
      state.purchases.forEach(function (p) { rows.push([p.date, p.supplier, p.code, p.name, p.qty, p.purchasePaisa / 100, p.totalPaisa / 100]); });
      download("hamza-purchases.csv", toCsv(rows), "text/csv");
    });
    $("#expKhata").addEventListener("click", function () {
      var rows = [["customer", "phone", "balance_due_rs"]];
      state.customers.forEach(function (c) { rows.push([c.name, c.phone, c.balancePaisa / 100]); });
      state.khataEntries.forEach(function (e) {
        var c = state.customers.filter(function (x) { return x.id === e.customerId; })[0];
        rows.push([c ? c.name : "", e.date, e.type, e.amountPaisa / 100, e.note]);
      });
      download("hamza-khata.csv", toCsv(rows), "text/csv");
    });
    $("#expAll").addEventListener("click", function () {
      download("hamza-backup-" + todayStr() + ".json", JSON.stringify(state, null, 2), "application/json");
    });
  }

  /* ---------------- Settings ---------------- */
  function viewSettings() {
    return (
      '<div class="panel"><h2>Settings</h2>' +
      '<div class="grid2"><label class="f">Low-stock alert threshold (qty)<input id="stLow" type="number" min="0" step="any" value="' + state.settings.lowStockThreshold + '"></label>' +
      '<label class="f">Expiry alert (days ahead)<input id="stExp" type="number" min="0" step="1" value="' + state.settings.expiryAlertDays + '"></label></div>' +
      '<button class="btn" id="stSave">Save Settings</button></div>' +
      '<div class="panel"><h3>Shop PIN</h3>' +
      '<div class="grid2"><label class="f">Current PIN<input id="stPinCur" type="password" inputmode="numeric"></label>' +
      '<label class="f">New PIN (at least 4 digits)<input id="stPinNew" type="password" inputmode="numeric"></label></div>' +
      '<button class="btn secondary" id="stPinBtn">Change PIN</button>' +
      '<p class="small muted mt">The PIN is a simple shop gate. It is stored only as a basic hash in the synced data — do not reuse an important password as the shop PIN.</p></div>' +
      '<div class="panel"><h3>Data</h3>' +
      '<p class="small">Current mode: <b>' + (store.getMode() === "firebase" ? "Cloud (Firebase) — the same data opens on laptop and phone" : "Local (this browser only) — add a Firebase config to sync across devices; see README.md") + '</b></p>' +
      '<div class="row mt"><button class="btn secondary" id="stExport">Export Full Backup (JSON)</button>' +
      '<label class="btn secondary" style="cursor:pointer">Restore Backup (JSON)<input id="stImport" type="file" accept=".json,application/json" style="display:none"></label></div>' +
      '<div class="mt"><button class="btn danger" id="stClear">Clear All Shop Data</button></div></div>'
    );
  }
  function bindSettings() {
    $("#stSave").addEventListener("click", function () {
      state.settings.lowStockThreshold = parseFloat($("#stLow").value) || 0;
      state.settings.expiryAlertDays = Math.max(0, Math.round(parseFloat($("#stExp").value) || 0));
      save(); toast("Settings saved.");
    });
    $("#stPinBtn").addEventListener("click", function () {
      var cur = $("#stPinCur").value.trim(), nw = $("#stPinNew").value.trim();
      if (state.settings.pin && simpleHash(cur) !== state.settings.pin) { toast("Current PIN is wrong."); return; }
      if (nw.length < 4) { toast("New PIN must be at least 4 digits."); return; }
      state.settings.pin = simpleHash(nw);
      save(); toast("PIN changed.");
    });
    $("#stExport").addEventListener("click", function () {
      download("hamza-backup-" + todayStr() + ".json", JSON.stringify(state, null, 2), "application/json");
    });
    $("#stImport").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { return; }
      var r = new FileReader();
      r.onload = function () {
        try {
          state = D.normalizeState(JSON.parse(String(r.result)));
          save(); render(); toast("Backup restored.");
        } catch (err) { toast("That file could not be read as a backup."); }
      };
      r.readAsText(f);
    });
    $("#stClear").addEventListener("click", function () {
      if (!confirm("Delete ALL shop data (stock, bills, khata)? This cannot be undone.")) { return; }
      if (!confirm("Are you sure? Export a backup first if you need this data.")) { return; }
      var pin = state.settings.pin;
      state = D.emptyState();
      state.settings.pin = pin;
      cart = [];
      save(); render(); toast("All shop data cleared.");
    });
  }

  /* ---------------- init ---------------- */
  store.onRemote(function (remoteState) {
    state = remoteState;
    if (loaded) { render(); }
  });
  store.init().then(function (initial) {
    state = initial;
    loaded = true;
    showGate();
    render();
  });
})();
