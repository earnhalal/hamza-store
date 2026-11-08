/*
 * Hamza Departmental Store — release checks (plain Node, no deps)
 * Run:  node tests/run-tests.js
 *
 * Tests the REAL shipped modules (data.js, lookup.js) by requiring
 * them — not copies of their logic. Covers:
 *  1. Loader shape contract: normalizeState (the initializer) against
 *     empty / legacy / current stored states, and the dashboard
 *     consumer (computeDashboard) rendering from each shape.
 *  2. Bill totals + stock deduction for piece and kg items.
 *  3. Barcode lookup parsing with a real Open Food Facts response.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const D = require("../data.js");
const L = require("../lookup.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("  ok - " + name);
}
function assertStateShape(s, label) {
  assert.ok(s && typeof s === "object", label + ": state is object");
  ["products", "bills", "customers", "khataEntries", "purchases"].forEach((k) => {
    assert.ok(Array.isArray(s[k]), label + ": " + k + " is a plain array (not a wrapper/map)");
  });
  assert.ok(s.settings && typeof s.settings === "object", label + ": settings object");
  assert.strictEqual(typeof s.settings.nextBillNumber, "number", label + ": nextBillNumber numeric");
}

console.log("1) Loader shape contract (empty / legacy / current)");

check("empty store: null input -> plain empty collections", () => {
  const s = D.normalizeState(null);
  assertStateShape(s, "empty(null)");
  assert.strictEqual(s.products.length, 0);
  assert.strictEqual(s.settings.nextBillNumber, 1001);
});
check("empty store: undefined / junk string -> empty collections", () => {
  assertStateShape(D.normalizeState(undefined), "empty(undefined)");
  assertStateShape(D.normalizeState("garbage"), "empty(string)");
  assertStateShape(D.normalizeState({}), "empty({})");
});

const legacyV1 = {
  // v1: collections as id->object maps, alias field names, config instead of settings
  items: {
    a1: { code: "8964000101", name: "Surf Excel 1 kg", category: "Household", unit: "pack", purchasePaisa: 95000, salePaisa: 105000, stock: 12 },
    a2: { code: "HDS-MILK", name: "Fresh Milk", category: "Dairy & Bread", unit: "litre", purchasePaisa: 22000, salePaisa: 26000, stock: 20, expiry: "2999-01-01" }
  },
  sales: [
    { id: "b1", number: 1001, date: new Date().toISOString(), customerName: "Walk-in customer", paymentMethod: "Cash", totalPaisa: 105000, profitPaisa: 10000, items: [{ productId: "a1", name: "Surf Excel 1 kg", qty: 1, salePaisa: 105000, purchasePaisa: 95000 }] }
  ],
  khata_entries: [{ id: "k1", customerId: "c1", date: new Date().toISOString(), type: "credit", amountPaisa: 50000 }],
  customers: { c1: { name: "Ahmed", phone: "0300", balancePaisa: 50000 } },
  config: { nextBillNumber: 2050, lowStockThreshold: 3 }
};
check("legacy v1 (maps + aliases) -> plain arrays, ids injected, settings migrated", () => {
  const s = D.normalizeState(legacyV1);
  assertStateShape(s, "legacy");
  assert.strictEqual(s.products.length, 2);
  assert.strictEqual(s.products[0].id, "a1", "map key becomes id");
  assert.strictEqual(s.bills.length, 1);
  assert.strictEqual(s.khataEntries.length, 1);
  assert.strictEqual(s.customers.length, 1);
  assert.strictEqual(s.settings.nextBillNumber, 2050);
  assert.strictEqual(s.settings.lowStockThreshold, 3);
});

const current = D.emptyState();
current.products.push(D.normalizeProduct({ id: "p1", code: "3017620422003", name: "Nutella 400 g", category: "Snacks & Biscuits", unit: "piece", purchasePaisa: 80000, salePaisa: 95000, stock: 10 }));
current.products.push(D.normalizeProduct({ id: "p2", code: "HDS-CHINI", name: "Chini (Sugar)", category: "Grocery", unit: "kg", purchasePaisa: 14000, salePaisa: 0, stock: 50 })); // rate pending
current.settings.nextBillNumber = 1042;
check("current v2 state round-trips unchanged in shape and counts", () => {
  const s = D.normalizeState(JSON.parse(JSON.stringify(current)));
  assertStateShape(s, "current");
  assert.strictEqual(s.products.length, 2);
  assert.strictEqual(s.settings.nextBillNumber, 1042);
  assert.strictEqual(D.findByCode(s, "3017620422003").name, "Nutella 400 g");
  assert.strictEqual(D.findByCode(s, "does-not-exist"), null);
});

check("dashboard consumer renders from empty / legacy / current shapes without throwing", () => {
  const today = new Date().toISOString().slice(0, 10);
  [null, legacyV1, current].forEach((input, i) => {
    const dash = D.computeDashboard(D.normalizeState(input), today);
    assert.strictEqual(typeof dash.todaySalePaisa, "number", "shape " + i + " todaySalePaisa");
    assert.ok(Array.isArray(dash.lowStock) && Array.isArray(dash.pendingRates), "shape " + i + " alert arrays");
    assert.strictEqual(dash.last7Days.length, 7, "shape " + i + " 7-day chart data");
  });
  const dashCurrent = D.computeDashboard(D.normalizeState(current), today);
  assert.strictEqual(dashCurrent.pendingRates.length, 1, "rate-pending product is reported");
  assert.strictEqual(dashCurrent.stockValuePaisa, 80000 * 10 + 14000 * 50, "stock value at purchase rate");
});

console.log("2) Bill totals + stock deduction (piece + kg)");

check("bill total Rs 2,125 exactly; stock 20->18 pc and 50->48.5 kg", () => {
  const products = [
    D.normalizeProduct({ id: "A", code: "A1", name: "Cooking Oil 5 litre", unit: "piece", purchasePaisa: 60000, salePaisa: 80000, stock: 20 }),
    D.normalizeProduct({ id: "B", code: "B1", name: "Chini (Sugar)", unit: "kg", purchasePaisa: 20000, salePaisa: 35000, stock: 50 })
  ];
  const lines = [
    { productId: "A", qty: 2, salePaisa: 80000, purchasePaisa: 60000 },
    { productId: "B", qty: 1.5, salePaisa: 35000, purchasePaisa: 20000 }
  ];
  const totals = D.computeBillTotals(lines, 0);
  assert.strictEqual(totals.totalPaisa, 212500, "Rs 2,125 total");
  assert.strictEqual(totals.profitPaisa, 2 * 20000 + Math.round(1.5 * 15000), "profit estimate");
  const after = D.applyBillToStock(products, lines);
  assert.strictEqual(after.find((p) => p.id === "A").stock, 18, "piece deduction");
  assert.strictEqual(after.find((p) => p.id === "B").stock, 48.5, "kg deduction");
  assert.strictEqual(products[0].stock, 20, "original array not mutated");
});
check("discount cannot exceed subtotal; rate-less line flags hasPendingRate", () => {
  const t = D.computeBillTotals([{ productId: "X", qty: 1, salePaisa: 0, purchasePaisa: 100 }], 5000);
  assert.strictEqual(t.totalPaisa, 0);
  assert.strictEqual(t.hasPendingRate, true);
});

console.log("3) Barcode lookup parsing");

check("real Open Food Facts response: Nutella 3017620422003", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "off-nutella.json"), "utf8"));
  const r = L.parseLookupResponse(fixture, "Open Food Facts");
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.code, "3017620422003");
  assert.strictEqual(r.name, "Nutella 400 g");
  assert.strictEqual(r.brand, "Ferrero");
  assert.strictEqual(r.size, "400 g");
  assert.strictEqual(r.category, "Snacks & Biscuits");
});
check("Coca-Cola maps to Cold Drinks; 'chocolate' must NOT match 'cola'", () => {
  const coke = {
    code: "5449000000996", status: 1,
    product: { product_name_en: "Coca-Cola Original", brands: "Coca-Cola", quantity: "330 ml",
      categories_tags: ["en:beverages", "en:carbonated-drinks", "en:sodas", "en:colas"] }
  };
  const r = L.parseLookupResponse(coke, "Open Food Facts");
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.category, "Cold Drinks & Juices");
  assert.ok(!L.tokens("chocolate").includes("cola"), "whole-token matching");
  assert.strictEqual(L.mapCategory(L.tokens("chocolate spread")), "Snacks & Biscuits");
});
check("unknown code -> honest found:false", () => {
  const r = L.parseLookupResponse({ code: "8964000111111", status: 0, status_verbose: "product not found" }, "Open Food Facts");
  assert.strictEqual(r.found, false);
  assert.strictEqual(L.parseLookupResponse(null).found, false);
});

console.log("\nAll " + passed + " checks passed.");
