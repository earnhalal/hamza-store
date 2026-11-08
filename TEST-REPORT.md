# Hamza Departmental Store (standalone) — Test Report

Date: 2026-11-08 · Environment: Node v24 (tests), live Open Food Facts API
(checks). Command: `node tests/run-tests.js` → **all 10 checks passed**;
`node --check` passed for every shipped JS file.

## 1. Loader shape contract — data.js `normalizeState` (the real initializer)

Following `app_creation_release_checks`: the initializer's return shapes
were listed first (it must always return plain arrays for `products`,
`bills`, `customers`, `khataEntries`, `purchases`, plus a `settings`
object — never a wrapper object or id→object map), then the extracted
real function was run against all three stored states, and the consumer
(`computeDashboard`, the function the Dashboard renders from) was run
against each result:

- **Empty** — `null`, `undefined`, a junk string, and `{}` all normalize
  to empty collections, `nextBillNumber` 1001. ✔
- **Legacy (v1)** — collections stored as Firebase-style id→object maps,
  alias fields (`items`→products, `sales`→bills, `khata_entries`→
  khataEntries, `config`→settings) migrate to plain arrays, map keys
  become record ids, `nextBillNumber` 2050 and thresholds preserved. ✔
- **Current (v2)** — a JSON round-trip preserves shape, counts, and
  settings; `findByCode` finds by exact code and returns `null` for an
  unknown code. ✔
- **Consumer** — `computeDashboard` renders without throwing from all
  three shapes; on the current fixture it reports the rate-pending
  product and the exact stock value (Rs 800×10 + Rs 140×50 paisa math). ✔

## 2. Bill maths + stock deduction (logic the Complete-Bill flow uses)

- Lines: 2 × Rs 800 (piece) + 1.5 kg × Rs 350/kg → total **Rs 2,125
  exactly** (212500 paisa), profit estimate correct.
- `applyBillToStock`: stock **20 → 18 pieces** and **50 → 48.5 kg**;
  input array not mutated.
- Discount is clamped to the subtotal; a rate-less line bills at Rs 0
  and sets `hasPendingRate` (the warning path used in the UI). ✔

## 3. Barcode lookup parsing — lookup.js `parseLookupResponse`

- **Real fixture** (`tests/fixtures/off-nutella.json`, trimmed from the
  live Open Food Facts response for EAN **3017620422003**):
  found → name **“Nutella 400 g”**, brand **Ferrero**, size **400 g**,
  category **Snacks & Biscuits**. ✔
- **Live check** against the real API for Coca-Cola EAN **5449000000996**
  (run at build time): found → “Coca-Cola 330 ml”, category **Cold
  Drinks & Juices**. ✔
- Whole-token category matching verified: `chocolate` does **not**
  match the `cola` token (the substring bug the prototype once had).
- Unknown code (API `status: 0`) → honest `found: false`; `null`
  response → `found: false`. ✔

## 4. Bundle / file checks

- Every file `index.html` references exists in the folder; CDN
  libraries: jsQR, qrcode-generator, Firebase compat SDK (app +
  database). No stale assets; the store **seeds no data** — the first
  open shows an empty shop.
- PIN gate, all eight tabs, and every workflow are wired in `app.js`
  (syntax-checked; UI code paths share the exact tested pure functions
  for totals, stock deduction, dashboard, and lookup parsing).

## Could NOT verify here

- **Camera scanning on a real device.** The sandbox has no camera.
  `scanner.js` uses the standard pipeline (getUserMedia →
  BarcodeDetector, jsQR canvas fallback, scanner-gun/typed-code
  fallback) and an honest permission-error state, but the live scan
  must be confirmed on the owner's phone/laptop: open Stock →
  “Scan Karke Stock Mein Add Karein” → allow camera → scan a branded
  packet. Note the lookup runs over the network once a code is
  decoded, so that half is already live-verified (section 3).
- **Firebase sync** — no Firebase project exists yet by design
  (task scope: config file only). The adapter activates automatically
  once `firebase-config.js` is filled; until then the site runs on
  localStorage and the header says so.
- Full in-browser click-through (no browser in this sandbox); the
  risky logic is covered by the Node tests above instead.
