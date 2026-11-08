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

---

# Update — Supabase cloud sync (2026-11-08)

Scope: wired the live Supabase project into the standalone terminal
(local code only — nothing pushed or deployed in this pass). Command:
`node tests/run-tests.js` → **all 21 checks passed** (10 pre-existing +
11 new); `node --check` passed for every shipped JS file, including the
new `supabase-config.js`.

## What changed

- `supabase-config.js` (new) — `window.HAMZA_SUPABASE_CONFIG`
  (project URL + public anon key), loaded in `index.html` **before**
  `data.js`. No `service_role` key anywhere in the client.
- `data.js` — Supabase adapter with priority
  **Supabase → Firebase → localStorage**, plain `fetch` against the
  REST API (no SDK): GET `hamza_state?id=eq.1`, upsert POST with
  `Prefer: resolution=merge-duplicates`. Saves are debounced ~800 ms
  (localStorage copy written immediately); a ~45 s poll reloads newer
  remote state through the same `normalizeState` + `onRemote` path.
  Failed network calls fall back to localStorage and flip the mode to
  an honest offline/local status.
- `app.js` — header now reads “Data: Cloud (Supabase) — synced on all
  devices” when cloud is active, and an explicit offline message when
  it is not; the old “local demo mode” wording is gone. Settings shows
  the same status in detail.

## New checks — section 4 of `tests/run-tests.js` (mock fetch only)

Following `app_creation_release_checks`, the Supabase path runs the
**real** shipped shaping functions (`supabaseSelectUrl`,
`supabaseHeaders`, `supabaseUpsertRequest`, `parseSupabaseRows`,
`resolveInitialState`, `createSupabaseClient`) plus the real
`normalizeState`, against empty / legacy / current shapes:

- Request shapes: exact select URL, `apikey` + `Authorization: Bearer`
  headers, upsert body `[{id: 1, state, updated_at}]` carrying the
  whole normalized state. ✔
- `parseSupabaseRows`: no rows → `state: null`; the `'{}'` seed row →
  empty object; a real row → state + `updated_at` preserved. ✔
- Both empty → source `empty`, nothing pushed; dashboard consumer
  renders the shape. ✔
- **Seeding case:** remote `'{}'` + local data → local wins,
  `shouldPush: true`; end-to-end with a mock fetch, the local
  products (2) and settings are POSTed up verbatim into row id 1. ✔
- **Remote-wins case:** a current v2 remote beats local data
  (`nextBillNumber` 1042 kept); a **legacy-shaped** remote
  (id→object maps + alias fields) normalizes to plain arrays, wins,
  and renders in `computeDashboard`. ✔
- Client failure modes: HTTP 500 and a thrown network error both
  reject cleanly from `fetchRemote`/`pushState` — the exact signal
  the store uses to fall back to localStorage. ✔
- **Bill regression through the Supabase-shaped state:** remote state
  resolved via the adapter path → totals **Rs 2,125 exactly**
  (212500 paisa), stock **20 → 18 pieces** and **50 → 48.5 kg**. ✔
- Bundle check: `supabase-config.js` exports the config with the
  project URL, and `index.html` loads it before `data.js`. ✔

## Live check (one attempt, as scoped)

One `curl --max-time 10` GET to
`https://egacvztkqztcvuvjrysv.supabase.co/rest/v1/hamza_state?id=eq.1&select=state,updated_at`
with the anon key: **timed out after 10 s, 0 bytes received
(HTTP 000)** from this sandbox. Sandbox egress to `supabase.co` is
unreliable (an earlier probe timed out the same way), so this is
**not** evidence the project is broken — the project was verified
Healthy in the Supabase dashboard when created. The live round-trip
(first-device seeding + cross-device poll) still needs one real-world
confirmation from the owner's laptop/phone once this build is
deployed: open the site, add one item, and watch it appear on the
second device within ~45 s.

## Could NOT verify here

- Live Supabase read/write from this sandbox (egress timeout, above).
- Camera scanning on a real device (unchanged from the section above).
- Nothing was pushed or deployed in this pass — the GitHub Pages site
  still serves the previous commit until the owner approves a push.
