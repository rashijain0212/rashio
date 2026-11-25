# Rashio

A private, free-tier personal earnings tracker for contract work.
Paste the text of your earnings page, and Rashio parses it,
syncs it to your own Firestore space without creating duplicates, and shows
earnings by **work period** (not payout date) on a pastel dashboard.

Live: https://rashio.web.app

## Features

- **Smart importer:** deterministic parser (no AI APIs) for summary cards,
  projects and every payout row: contract, type, work period, hours, earnings,
  rate, status, and payout and release dates. It handles both table copies and
  one-cell-per-line copies.
- **Safe sync:** matches on contract, type and work period, never on amounts or
  hours. Changed amounts, hours and statuses update in place. Legitimate twin
  incentives are kept. Unclear cases go to a review screen. Missing rows are
  never deleted. Each import is one Firestore transaction guarded by a revision
  number, so concurrent imports or stale previews are rejected. Import history
  supports undo.
- **Calculations:** money is stored as integer cents. Earnings can be viewed by
  calendar month, 21st-to-21st (configurable) cycle, custom range or lifetime.
  Views cover paid and pending, hourly, incentives and work trials, hours,
  effective rate, and per-contract and per-project totals. When a work period
  crosses a month, it is split by days and marked *est.*, or you can enter the
  exact split.
- **Pages:** Overview, Monthly, All payments (search, filter, add, edit,
  delete, inline status), Import & Sync, Analytics, and Settings (rates, cycle
  day, CSV and JSON export, JSON restore).

## Stack

React 19, TypeScript, Vite, Tailwind CSS v4, shadcn-style components, Recharts,
Firebase Auth (Google), Cloud Firestore and Firebase Hosting (Spark plan, no
Cloud Functions), and Vitest.

## Setup

1. `cp .env.example .env.local` and fill in your Firebase web app settings.
2. `cp .firebaserc.example .firebaserc` and set your project and hosting site ids.

## Development

```bash
npm install
npm run dev            # http://localhost:5173  (add ?demo for synthetic data, dev only)
npm run check          # lint + typecheck + unit tests + build
npm run test:rules     # Firestore rules tests (needs Java for the emulator)
```

## Deploy

```bash
npm run build
npx firebase-tools deploy --only hosting,firestore:rules
```

CI (`.github/workflows/ci.yml`) runs every check on each push. To turn on
automatic deploys from `main`, add a repository secret named
`FIREBASE_SERVICE_ACCOUNT`. It should hold the JSON key of a
service account that has only the **Firebase Hosting Admin** role.

## Data & privacy

- All data lives under `/users/{uid}/…`. Firestore rules deny everyone except
  the signed-in owner (see `firestore.rules` and `tests/rules`).
- The repository contains only **synthetic** test fixtures. Real exports belong
  in `private/` (git-ignored).
- No analytics or tracking.

## Migrating the old spreadsheet

```bash
python3 scripts/sheet_to_backup.py "Earnings spreadsheet.xlsx" private/backup.json
```

Then go to **Settings → Restore from JSON backup**.
