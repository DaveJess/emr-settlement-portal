# Frontend guide

This guide describes the React frontend in `frontend/src`: how it starts, how its pages and role checks fit together, and how the EMR and wallet workflows work. It is written for someone new to the codebase.

## What the frontend does

The app is a browser-based hospital accounting prototype. It provides three workspaces:

- **Finance** creates and assigns cashier accounts, audits EMR records, reviews daily accounts, and confirms cash receipts.
- **Facility Manager** reviews EMR and daily account submissions and issues cashier top-ups for assigned hospitals.
- **Cashier** records EMR and TAP totals, acknowledges top-ups, and submits a daily wallet account.

The three roles use the same browser-local dataset, with pages and actions filtered or guarded by role and hospital assignment.

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

## Sign-in and demo accounts

The sign-in page is `src/pages/LoginPage.tsx`. It supports email/password login and buttons for the seeded demo accounts. Each seeded account uses password `Lunar123!`:

| Role | Email | Home route |
| --- | --- | --- |
| Finance | `finance@lunar.demo` | `/finance` |
| Facility Manager | `manager@lunar.demo` | `/facility-manager` |
| Cashier | `cashier@lunar.demo` | `/cashier` |

Demo users and hospitals are defined in `src/data/demoData.ts`. If no app data is saved in the browser yet, the app creates this initial dataset.

## How the app is structured

```text
src/
  main.tsx                 Browser entry point and global CSS
  App.tsx                  Router, role-specific routes, default redirect
  context/
    AppContext.ts          Shared app state contract
    AppProvider.tsx        Loads state, login/logout, persists updates
  hooks/useApp.ts          Convenient, checked access to shared state
  components/
    ProtectedRoute.tsx     Requires a signed-in user with an allowed role
  layouts/DashboardLayout.tsx  Sidebar, role navigation, page outlet
  pages/                   Login, dashboard, cashiers, EMR, top-up, daily account
  utils/                   Browser storage, role mapping, permissions, calculations,
                           and workflow operations
  types/index.ts           Shared TypeScript data model
  data/demoData.ts         Initial demo hospitals, users, and empty records
```

### Starting point and routing

`main.tsx` attaches `<App />` to the HTML root element inside React Strict Mode. `App.tsx` wraps routes in `BrowserRouter` and `AppProvider`. It maps the finance, facility manager, and cashier URL trees to shared pages. An unknown URL redirects to the signed-in user's role home or to `/login`.

`ProtectedRoute` checks for a current active user and the required role. A signed-out visitor goes to login; a user with the wrong role is redirected to their own home. `DashboardLayout` provides the common sidebar and header and renders the selected page through React Router's `<Outlet />`.

### Shared state and persistence

`AppProvider` owns `AppData` and the current user. Pages call `useApp()` to read `data` and `currentUser`, sign in/out, or make a data update. For an update, the provider clones the existing dataset, applies the page's updater, saves the result, and only then publishes it to React state.

`src/utils/storage.ts` stores:

- The full dataset in `localStorage` under `lunar_accounting_data_v1`.
- The signed-in user's ID in `sessionStorage` under `lunar_accounting_session_v1`.

Data remains in that browser profile across reloads; the login session lasts for the browser tab session. Clearing the app's site storage removes the demo data and starts it over from `createDemoData()` on the next load.

**Prototype limitation:** this frontend currently authenticates against browser-stored user records, and user passwords are included in that data. It does not call a server API for authentication, authorization, or persistence. Browser-side role checks are useful for the prototype UI but are not a security boundary for production. The backend directory is separate; this guide describes the frontend behavior only.

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
