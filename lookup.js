/*
 * Hamza Departmental Store — online barcode lookup
 * ------------------------------------------------
 * When a NEW company barcode is scanned, look it up in free,
 * key-free, CORS-enabled product databases:
 *   1. Open Food Facts        https://world.openfoodfacts.org
 *   2. Open Products Facts    https://world.openproductsfacts.org
 * and auto-fill name / brand / pack size / category.
 *
 * A shop's sale/purchase RATE is never taken from any database —
 * prices are the shop's own and exist in no product database.
 *
 * parseLookupResponse is pure and runs in Node for tests.
 * Category matching is WHOLE-TOKEN based on purpose: the token
 * "cola" must match Coca-Cola but must NOT match "chocolate".
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (root) { root.HamzaLookup = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function tokens(text) {
    return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (t) {
      return t.length > 1 && t !== "en" && t !== "fr";
    });
  }

  // Ordered: first rule with a whole-token hit wins.
  var CATEGORY_RULES = [
    ["Cold Drinks & Juices", ["cola", "soda", "sodas", "juice", "juices", "beverage", "beverages", "drink", "drinks", "lemonade", "squash", "energy"]],
    ["Dairy & Bread", ["milk", "cheese", "yogurt", "yoghurt", "butter", "bread", "breads", "dairy", "cream", "eggs", "egg", "paneer", "lassi"]],
    ["Frozen", ["frozen", "icecream", "gelato", "sorbet"]],
    ["Baby Care", ["baby", "infant", "diaper", "diapers", "nappy", "nappies"]],
    ["Personal Care", ["shampoo", "toothpaste", "deodorant", "lotion", "perfume", "razor", "sanitary", "conditioner", "facewash"]],
    ["Household", ["detergent", "cleaner", "cleaners", "cleaning", "dishwash", "dishwashing", "laundry", "bleach", "disinfectant", "tissues", "tissue"]],
    ["Snacks & Biscuits", ["snack", "snacks", "biscuit", "biscuits", "cookie", "cookies", "chocolate", "chocolates", "chips", "crisps", "candy", "candies", "confectionary", "confectionery", "spreads", "spread", "cake", "cakes", "wafer", "wafers", "nuts", "cocoa"]],
    ["Grocery", ["rice", "flour", "sugar", "lentils", "lentil", "spice", "spices", "oil", "oils", "tea", "coffee", "pasta", "sauce", "sauces", "salt", "honey", "cereal", "cereals", "grain", "grains", "beans", "wheat"]]
  ];

  function mapCategory(tokenList) {
    var set = {};
    tokenList.forEach(function (t) { set[t] = true; });
    // "soap" is ambiguous: bar soap -> Personal Care, unless detergent context.
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var cat = CATEGORY_RULES[i][0], words = CATEGORY_RULES[i][1];
      for (var j = 0; j < words.length; j++) {
        if (set[words[j]]) { return cat; }
      }
    }
    if (set["soap"] && !set["detergent"]) { return "Personal Care"; }
    if (set["soap"]) { return "Household"; }
    return "Other";
  }

  function cleanQuantity(q) {
    // "400 g e" -> "400 g"; "330 ml" stays; trims estimate marks.
    return String(q || "").replace(/\s+e\s*$/i, "").replace(/\s+/g, " ").trim();
  }

  function parseLookupResponse(json, source) {
    if (!json || typeof json !== "object" || !json.product ||
        (json.status !== undefined && Number(json.status) === 0)) {
      return { found: false, code: json && json.code ? String(json.code) : "", source: source || "" };
    }
    var p = json.product;
    var code = String(json.code || p._id || p.code || "");
    var name = String(p.product_name_en || p.product_name || p.generic_name || "").trim();
    if (!name) { return { found: false, code: code, source: source || "" }; }

    var size = cleanQuantity(p.quantity || p.net_quantity || "");
    var displayName = name;
    if (size && !/[0-9]/.test(name)) { displayName = name + " " + size; }

    var brands = String(p.brands || "").split(",").map(function (b) { return b.trim(); })
      .filter(function (b) { return b.length > 0; });
    var brand = "";
    for (var i = brands.length - 1; i >= 0; i--) {
      if (brands[i].toLowerCase() !== name.toLowerCase()) { brand = brands[i]; break; }
    }

    var toks = []
      .concat(tokens(name))
      .concat(tokens(p.categories || ""))
      .concat((Array.isArray(p.categories_tags) ? p.categories_tags : [])
        .reduce(function (acc, t) { return acc.concat(tokens(String(t).replace(/^[a-z]{2}:/, ""))); }, []))
      .concat(tokens(p.generic_name || ""));

    return {
      found: true,
      code: code,
      name: displayName,
      brand: brand,
      size: size,
      category: mapCategory(toks),
      source: source || ""
    };
  }

  var SOURCES = [
    { name: "Open Food Facts", base: "https://world.openfoodfacts.org" },
    { name: "Open Products Facts", base: "https://world.openproductsfacts.org" }
  ];

  function fetchJson(url, timeoutMs) {
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) { if (timer) { clearTimeout(timer); } return j; });
  }

  // Browser-only: tries each source in order, returns first hit or
  // {found:false}. Never throws.
  function lookupBarcode(code) {
    var clean = String(code || "").trim();
    if (!clean) { return Promise.resolve({ found: false, code: "" }); }
    var chain = Promise.resolve({ found: false, code: clean });
    SOURCES.forEach(function (src) {
      chain = chain.then(function (prev) {
        if (prev && prev.found) { return prev; }
        return fetchJson(src.base + "/api/v2/product/" + encodeURIComponent(clean) + ".json")
          .then(function (json) {
            var parsed = parseLookupResponse(json, src.name);
            parsed.code = parsed.code || clean;
            return parsed.found ? parsed : { found: false, code: clean };
          });
      });
    });
    return chain;
  }

  return {
    tokens: tokens,
    mapCategory: mapCategory,
    cleanQuantity: cleanQuantity,
    parseLookupResponse: parseLookupResponse,
    lookupBarcode: lookupBarcode,
    SOURCES: SOURCES
  };
});
