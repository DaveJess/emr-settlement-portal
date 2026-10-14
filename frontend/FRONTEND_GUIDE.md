# Frontend guide

This guide describes the React frontend in `frontend/src`: how it starts, how its pages and role checks fit together, and how the EMR and wallet workflows work. It is written for someone new to the codebase.

## What the frontend does

The app is a browser-based hospital accounting prototype. It provides three workspaces:

- **Finance** creates and assigns cashier accounts, audits EMR records, reviews daily accounts, and confirms cash receipts.
- **Facility Manager** reviews EMR and daily account submissions and issues cashier top-ups for assigned hospitals.
- **Cashier** records EMR and TAP totals, acknowledges top-ups, and submits a daily wallet account.

Identity is served by the backend: MongoDB is the source of truth for users, roles, account status, facility assignments, and sign-in sessions. The accounting pages still use the browser-local dataset; their API migration is separate work.

## Start and build

Run these commands from the `frontend` directory:

```bash
npm install
npm run dev
```

Vite prints a local URL to open in a browser. Other available scripts are:

```bash
npm run build    # TypeScript project build, then Vite production bundle
npm run preview  # Serve the production bundle locally
npm run lint     # Oxlint
```

The frontend uses React, TypeScript, React Router, Vite, Tailwind CSS, and Lucide icons. `src/main.tsx` mounts the app and global styles; `vite.config.ts` configures Vite and its plugins.

## Sign-in and identity setup

The sign-in page is `src/pages/LoginPage.tsx`. It posts credentials to `POST /api/auth/login`, keeps the returned opaque session token in `sessionStorage`, and restores the session through the backend on reload. Finance must first be created through the backend bootstrap endpoint; Finance then creates cashier accounts from the Cashiers page. There are no working browser-only demo credentials.

For local development, start the backend on port 4000 and the frontend Vite server. Vite proxies `/api` requests to the backend. Set up MongoDB, `API_ADMIN_TOKEN`, the first Finance user, and facilities using the instructions in [`../backend/README.md`](../backend/README.md).

## How the app is structured

```text
src/
  main.tsx                 Browser entry point and global CSS
  App.tsx                  Router, role-specific routes, default redirect
  context/
    AppContext.ts          Shared app state contract
    AppProvider.tsx        Loads state, login/logout, persists updates
  hooks/useApp.ts          Convenient, checked access to shared state
  api/identity.ts          Backend sign-in, session, and cashier API calls
  components/
    ProtectedRoute.tsx     Requires a signed-in user with an allowed role
  layouts/DashboardLayout.tsx  Sidebar, role navigation, page outlet
  pages/                   Login, dashboard, cashiers, EMR, top-up, daily account
  utils/                   Browser storage, role mapping, permissions, calculations,
                           and workflow operations
  types/index.ts           Shared TypeScript data model
  data/demoData.ts         Initial local accounting data and empty records
```

### Starting point and routing

`main.tsx` attaches `<App />` to the HTML root element inside React Strict Mode. `App.tsx` wraps routes in `BrowserRouter` and `AppProvider`. It maps the finance, facility manager, and cashier URL trees to shared pages. An unknown URL redirects to the signed-in user's role home or to `/login`.

`ProtectedRoute` checks for a current active user and the required role. A signed-out visitor goes to login; a user with the wrong role is redirected to their own home. `DashboardLayout` provides the common sidebar and header and renders the selected page through React Router's `<Outlet />`.

### Shared state and persistence

`AppProvider` owns the local accounting `AppData` and current signed-in identity. It loads the current user, scoped users, and assigned facilities from the backend. Finance's cashier creation, status changes, and facility assignment changes are API requests; a successful operation refreshes the scoped Identity data.

`src/utils/storage.ts` stores:

- The full dataset in `localStorage` under `lunar_accounting_data_v1`.
- The backend-issued session token in `sessionStorage` under `lunar_accounting_session_v1`.

Local accounting data remains in that browser profile across reloads; the backend login session lasts for the browser tab session. Clearing site storage removes the local accounting cache and initializes an empty one.

The browser cache is not the authority for Identity; protected backend requests validate sessions and enforce role/facility rules. Old cached demo passwords are stripped when the app loads. EMR, top-up, and daily-account screens still use local browser operations and are not yet connected to their corresponding backend workflows. Client-side route checks only control navigation and are not a security boundary.

## Pages and workflows

| Page | Route suffix | Main purpose |
| --- | --- | --- |
| Dashboard | role home | Today's role-specific activity and cashier wallet figures |
| Cashiers | `/cashiers` | Finance-managed cashier creation/status/assignment; visible to non-cashier roles |
| EMR Accounting | `/emr` | Enter, compare, review, and resolve EMR/TAP daily records |
| Top Up | `/top-up` | Issue wallet funds and let cashiers acknowledge them |
| Daily Wallet Accounts | `/daily-accounts` | Report daily collections, reconcile wallet balance, review and confirm receipt |

The cashier navigation intentionally omits Cashiers. All roles share the underlying page implementations, while the page logic and utility functions determine which records and actions are available.

### EMR accounting

Cashiers submit daily EMR and TAP transaction counts and amounts. `src/utils/emr.ts` validates the date and values, prevents duplicate daily records, and calculates the automatic remark. `compareEmrRecord()` in `accounting.ts` considers the two sets a match when both transaction counts and rounded amounts agree.

Review proceeds from Facility Manager to Finance. A record can be confirmed only when EMR and TAP tally. A manager can confirm or return the record and add a comment. Finance reviews after the manager, and can save a resolution. If returned for correction, the cashier can resubmit while edits remain allowed; resubmission resets both reviews to Pending. A cashier edit is locked after manager confirmation.

### Top-ups and daily wallet accounts

An active Finance or Facility Manager user can issue a positive, two-decimal top-up to an active cashier in an assigned hospital. A cashier acknowledges each top-up. The top-up workflow can create the day's draft account as needed; top-ups are blocked after that account has been submitted.

The cashier's daily account records opening balance and collections by bank transfer, cash, and card, plus the actual closing balance. The `accounting.ts` helpers summarize these figures:

- **Total available** = opening balance + top-ups for that account's date.
- **Total spent** = bank transfers + cash collected + card payments.
- **Expected closing balance** = total available − total spent.
- **Variance** = actual closing balance − expected closing balance, when actual closing is entered.
- **Tallies** is true when actual and expected closing balances match to the cent; it is `null` until an actual balance is provided.

The next account's opening balance carries forward from the prior submitted account's actual closing balance when available; otherwise it uses the prior account's expected closing balance. The workflow prevents creating a later account while an earlier account remains unsubmitted. Manager and Finance reviews are recorded separately, and Finance can confirm receipt of collected cash.

### Activity history

Workflow operations append entries to `AppData.activityLogs`, recording the actor, hospital, action, related record, and time. The current app model therefore keeps a lightweight in-browser audit history alongside the accounting records.

## Shared data model

`src/types/index.ts` defines the principal records:

- `Hospital` and `User` define facilities, role, account status, and hospital assignments.
- `EmrRecord` stores EMR and TAP values, cashier remark, two reviews, and a Finance resolution.
- `TopUp` stores amount, issuer, timestamp, and cashier acknowledgement.
- `DailyAccount` stores opening/closing figures, collection channels, submission status, two reviews, and cash receipt confirmation.
- `ActivityLog` records key actions.
- `AppData` groups the hospitals, users, EMR records, top-ups, daily accounts, and activity logs.

## Where to make common changes

- Add/change a URL or role route: `src/App.tsx` and `src/utils/roles.ts`.
- Change sidebar links or shared workspace chrome: `src/layouts/DashboardLayout.tsx`.
- Change shared state or session behavior: `src/context/AppProvider.tsx` and `src/utils/storage.ts`.
- Change a screen's UI: the matching file in `src/pages/`.
- Change permissions, validations, calculations, or workflow transitions: the matching module in `src/utils/`.
- Change model fields: `src/types/index.ts`; update demo data and any affected storage/workflow code too.

## Styling

`src/index.css` contains global Tailwind setup and shared design tokens; `src/App.css` contains app-level styling. Components primarily use Tailwind utility classes. The project uses Vite's Tailwind plugin.
