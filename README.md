# Hamza Departmental Store — Terminal

A standalone static web version of the Hamza Departmental Store terminal.
It opens from a direct link — no Muse account needed — on a laptop or a
phone, and starts **empty** (no sample data).

## What it does

- **Dashboard** — today's sale, profit estimate, stock value, low-stock and
  expiry alerts, 7-day sales chart, outstanding udhaar.
- **Bill Counter (POS)** — tap items or scan them with the camera, kg/litre
  quantities, discount, Cash / Card / JazzCash / EasyPaisa / Udhaar, stock
  auto-deducts when a bill completes, printable receipt + WhatsApp share.
- **Stock** — departmental categories, units (piece/pack/kg/litre), purchase
  and sale rates, expiry dates, printable QR label per item.
- **Scan Karke Stock Mein Add Karein** — scan a product barcode:
  existing item → increase-quantity screen; new item → name, brand, size and
  category are auto-filled from online barcode databases (Open Food Facts /
  Open Products Facts, free, no key). Sale rate may be left empty — the item
  still saves and waits in the **“Rate set karna baqi”** list, where all
  pending rates can be set in bulk. A rate is never invented from a database:
  rates are the shop's own.
- **Purchases** — supplier entries that raise stock.
- **Khata** — udhaar customers, ledger, payments (udhaar bills create the
  customer automatically).
- **Bills** — full bill history with receipts.
- **Reports** — daily sales/profit, top sellers, CSV export (products,
  bills, purchases, khata) and a full JSON backup (restore in Settings).
- **PIN gate** — a simple shop PIN is set on first open and can be changed
  in Settings. It is a convenience gate, not bank-grade security.

## Run it locally

Any static server works, e.g.:

```bash
cd hamza-store
python3 -m http.server 8000
# open http://localhost:8000
```

> Camera scanning needs HTTPS (or localhost) — browsers block camera
> access on plain HTTP sites. GitHub Pages / Vercel are HTTPS by default.

## Deploy (no build step)

### GitHub Pages
1. Put this folder's files in a GitHub repository (files at repo root).
2. Repo → Settings → Pages → deploy from the `main` branch, `/ (root)`.
3. The site is live at `https://<user>.github.io/<repo>/`.

### Vercel
1. Import the repository in Vercel (framework preset: **Other**).
2. No build command, output directory = repo root. Deploy.

## Cloud data (Supabase) — laptop and phone share one record

Cloud sync is **connected by default** in this build. The shop's whole
state (stock, bills, customers, khata, purchases, settings) lives in a
free [Supabase](https://supabase.com) project, in one table
`public.hamza_state` with a single row (`id = 1`) whose `state` jsonb
column holds the entire record. Any device that opens this site —
laptop, phone, a new device — loads that same row, so changing the
device loses nothing.

**How sync works**

- **On load:** the app fetches the cloud row. If it has data, the
  cloud state wins and is shown. If the cloud row is still empty
  (`state = '{}'`) and this device already has shop data in its
  browser, this device's data is kept and pushed up instead
  (first-device seeding). If both are empty, the shop starts empty.
- **On every change:** the state is written to the browser immediately
  (offline copy) and upserted to the cloud row, debounced by ~800 ms.
- **While open:** the app re-checks the cloud row every ~45 seconds;
  if another device saved something newer, this device reloads it and
  re-renders automatically.
- **Offline / cloud unreachable:** nothing breaks and nothing is lost.
  The app keeps working from the browser copy, the header honestly
  says so (“Offline — saved on this device…”), and sync retries
  automatically on the next change or poll. When the cloud is active
  the header reads “Data: Cloud (Supabase) — synced on all devices”.

**Configuration** lives in `supabase-config.js`
(`window.HAMZA_SUPABASE_CONFIG = { url, anonKey }`), loaded before
`data.js`. The adapter talks to the Supabase REST API with plain
`fetch` (no SDK): `GET /rest/v1/hamza_state?id=eq.1&select=state,updated_at`
to read, and a `POST` upsert (`Prefer: resolution=merge-duplicates`)
to save. Adapter priority: **Supabase → Firebase → localStorage**.

**Security notes**

- The `anonKey` in the config is Supabase's **public** client key,
  designed to ship in browser apps. What actually controls access is
  row-level security (RLS) on the table — this project's policies
  allow anon select/insert/update on the single row. Never put the
  `service_role` key in any client file; it bypasses all security.
- Anyone who can read this site's source can read that anon key, and
  with the current open RLS policies could read or overwrite the shop
  row. That is an accepted trade-off for a single trusted shop in v1;
  tighten it later with Supabase Auth if the shop ever needs real
  per-user access control.
- The shop **PIN is a convenience gate, not strong security** — it
  keeps counter staff honest, it does not protect the data like a
  real login would.

**Firebase fallback (optional, not used in this build):** if the
Supabase config is emptied and `firebase-config.js` is filled with a
Firebase project's `firebaseConfig` (Realtime Database), the adapter
falls back to Firebase at the path `hamzaStore/stateV2`; with neither
config present it runs on localStorage only (that one device).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell, CDN libraries, script order |
| `styles.css` | All styling (responsive: counter layout on laptop, stacked on phone; receipt print styles) |
| `app.js` | The terminal UI and all shop workflows |
| `data.js` | Data layer: state schema + `normalizeState`, bill/stock maths, dashboard summary, Supabase ⇄ Firebase ⇄ localStorage adapter (whole-state sync, REST via plain fetch). Also runs in Node for tests |
| `lookup.js` | Online barcode lookup (Open Food Facts / Open Products Facts) + category mapping. Also runs in Node for tests |
| `scanner.js` | Real camera scanning: `getUserMedia` + `BarcodeDetector`, jsQR fallback, scanner-gun/keyboard-wedge + type-the-code fallback |
| `supabase-config.js` | Supabase project URL + public anon key — cloud sync is active when these are filled (they are, in this build) |
| `firebase-config.js` | Fallback Firebase config (empty placeholders; only used if the Supabase config is removed) |
| `tests/run-tests.js` | Release checks — run `node tests/run-tests.js` |

## Known limitations (v1)

- Whole-state cloud sync is **last-write-wins**: if two devices save
  within the same second, the later save replaces the earlier one
  wholesale (there is no per-record merge). Fine for one counter,
  noted for later.
- Cloud access relies on the public anon key + open RLS policies (see
  the security notes above); the shop PIN is stored as a basic hash
  inside the synced data — treat it as a shop gate, not strong
  security, and never reuse an important password as the PIN.
- Local/unbranded products (loose atta, chini…) are in no online
  database; their name is typed once, then every scan is automatic.
- Camera scanning cannot work over plain HTTP (browser rule) — deploy
  on HTTPS.
