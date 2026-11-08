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

## Connect cloud data (Firebase) — so laptop and phone share one record

By default the app stores data in the browser's localStorage (that
device only — fine for a demo). To sync the same data on every device:

1. Go to https://console.firebase.google.com and create a free project.
2. In the project: **Build → Realtime Database → Create database**
   (start in test mode for the shop's own use; tighten rules later).
3. **Project settings → Your apps → Web app (</>)** — register an app and
   copy its `firebaseConfig` values.
4. Paste those values into `firebase-config.js` in this folder
   (`window.HAMZA_FIREBASE_CONFIG`) and re-deploy / commit.
5. Open the site anywhere — the header will read
   “Data: Cloud (Firebase) — synced on all devices”, and stock, bills and
   khata stay the same on laptop and phone. Changing the device loses
   nothing.

Data is stored at the Realtime Database path `hamzaStore/stateV2`
(whole-state sync, v1 — simple and adequate for a single shop counter).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell, CDN libraries, script order |
| `styles.css` | All styling (responsive: counter layout on laptop, stacked on phone; receipt print styles) |
| `app.js` | The terminal UI and all shop workflows |
| `data.js` | Data layer: state schema + `normalizeState`, bill/stock maths, dashboard summary, localStorage ⇄ Firebase adapter. Also runs in Node for tests |
| `lookup.js` | Online barcode lookup (Open Food Facts / Open Products Facts) + category mapping. Also runs in Node for tests |
| `scanner.js` | Real camera scanning: `getUserMedia` + `BarcodeDetector`, jsQR fallback, scanner-gun/keyboard-wedge + type-the-code fallback |
| `firebase-config.js` | Your Firebase config goes here (empty placeholders by default) |
| `tests/run-tests.js` | Release checks — run `node tests/run-tests.js` |

## Known limitations (v1)

- Whole-state cloud sync: two devices editing at the exact same second
  can overwrite each other; fine for one counter, noted for later.
- The shop PIN is stored as a basic hash inside the synced data — treat
  it as a shop gate, never reuse an important password.
- Local/unbranded products (loose atta, chini…) are in no online
  database; their name is typed once, then every scan is automatic.
- Camera scanning cannot work over plain HTTP (browser rule) — deploy
  on HTTPS.
