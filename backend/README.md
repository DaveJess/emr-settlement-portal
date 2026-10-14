# Backend: facilities and users

The backend persists facilities, users, sessions, EMR submissions, and activity logs in MongoDB. Top-up and daily-account features are not implemented yet.

## Requirements and startup

- Node.js 22.13 or newer.
- A MongoDB deployment and connection URI.
- npm.

From this directory:

```bash
npm install
```

Set `MONGODB_URI` to your MongoDB connection URI and optionally set `MONGODB_DATABASE` (defaults to the database in the URI). Set `API_ADMIN_TOKEN` to a cryptographically random secret with at least 32 bytes. It is used only for initial Finance bootstrap and facility provisioning; normal API requests use user sessions. `HOST` and `PORT` are optional; defaults are `127.0.0.1` and `4000`. Keep secrets in a local environment or secret manager and never commit them. For example, in PowerShell for the current terminal:

```powershell
$env:API_ADMIN_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$env:MONGODB_URI = "mongodb+srv://<username>:<password>@<cluster>/<database>?retryWrites=true&w=majority"
npm run dev
```

The API binds to loopback by default. If it is exposed beyond the local machine, put it behind TLS and a trusted network boundary, set a strong secret, and restrict access to the administrative endpoints. The bootstrap token is not a user session and cannot be used for normal API requests.

## API

Except `GET /health`, login, and the documented bootstrap endpoints, requests require `Authorization: Bearer <session-token>`. JSON request bodies must use `Content-Type: application/json`; the maximum body size is 64 KiB. Successful responses use `{ "data": ... }`; errors use `{ "error": "..." }`. Passwords are accepted only during account creation or sign-in, hashed with Node's scrypt implementation and a fresh random salt, and never included in responses or list queries. Opaque session tokens are generated from 256 bits of randomness; only their SHA-256 digests are stored. Sessions expire after eight hours, are revoked at logout, and are immediately invalidated when an account is deactivated. Sign-in failures are rate-limited per direct client IP.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness response |
| `POST /api/auth/login` | Sign in with `{ "email": "...", "password": "..." }`; returns a session and public user |
| `GET /api/auth/me` | Return the current session's public user |
| `POST /api/auth/logout` | Revoke the current session |
| `GET /api/bootstrap/status` | (Bootstrap token) Report whether the first Finance user is needed |
| `POST /api/bootstrap/finance` | (Bootstrap token) Create the first Finance user; works only before any Finance account exists |
| `POST /api/facilities` | (Bootstrap token) Create facility with `{ "name": "..." }` |
| `GET /api/facilities` | List only the signed-in user's assigned facilities |
| `GET /api/users` | List only users in the signed-in user's scope; optional `role`, `status`, and `facilityId` filters |
| `GET /api/users/:id` | Read a user only when within the signed-in user's scope (cashiers can read only themselves) |
| `POST /api/users` | (Finance) Create user with `name`, `phone`, `email`, `password`, `role`, and non-empty `facilityIds` within Finance's assigned facilities |
| `POST /api/cashiers` | (Finance) Create an active cashier with `name`, `phone`, `email`, `password`, and non-empty `facilityIds`; role is set by the server |
| `PATCH /api/users/:id/status` | (Finance) Set `{ "status": "active" }` or `{ "status": "inactive" }` for an in-scope user |
| `PUT /api/users/:id/facilities` | (Finance) Replace assignment using `{ "facilityIds": ["..."] }`, limited to Finance's assigned facilities |
| `GET /api/emr` | List records visible to the session; optional `facilityId`, `cashierId`, `date`, and `remark` filters |
| `POST /api/emr` | (Cashier) Submit a daily EMR/TAP record |
| `GET /api/emr/:id` | Read an EMR record after cashier-owner and facility checks |
| `PUT /api/emr/:id` | (Owning Cashier) Correct an editable record; date and facility cannot change |
| `POST /api/emr/:id/reviews` | (Facility Manager, then Finance) Review using `{ "status": "Confirmed" | "Not Confirmed", "comment"?: "..." }` |
| `PUT /api/emr/:id/resolution` | (Finance) Save `{ "resolution": "..." }` |

Allowed roles are `cashier`, `facility_manager`, and `finance`. Email addresses are normalized to lowercase and unique. Facility names are case-insensitively unique. Passwords must contain 12–128 characters. User assignments must refer to existing facilities and contain at least one facility.

Inactive accounts remain persisted with `status = 'inactive'` and can be listed with `?status=inactive`. There is no delete endpoint, which avoids dropping identity records that later accounting records may reference. The last active Finance account cannot deactivate itself or be deactivated.


EMR submissions allow one record per cashier per date and reject future dates. Counts must be non-negative safe integers; amounts must be non-negative with at most two decimals. The server calculates the automatic `Good` / `Check Record` remark. Cashier corrections keep the original date/facility and reset both reviews to Pending. After Facility Manager confirmation, the cashier cannot edit unless Finance returned the record as `Not Confirmed`. Facility Manager review precedes Finance review; confirmation requires EMR and TAP to tally. Finance alone may enter a resolution. Each submission, correction, review, and resolution writes an activity log.

## Storage layout

- `src/database.ts` connects to MongoDB and creates the required indexes.
- `src/entity/` contains the facility and user types and role/status definitions.
- `src/repository/` owns MongoDB persistence operations.
- `src/users/service.ts` validates inputs and coordinates persistence.
- `src/auth/password.ts` hashes and verifies passwords with scrypt.
- `src/auth/service.ts` signs users in and manages expiring sessions.
- `src/auth/authorization.ts` contains reusable role, record-owner, and facility guards.
- `src/emr/service.ts` validates EMR values and enforces the submission/review workflow.
- `src/repository/emrRepository.ts` persists EMR records and activity entries.
- `src/http/server.ts` exposes the HTTP API and applies request, session, role, and scope checks.

Use your MongoDB deployment's backup and access controls. Unique indexes protect normalized emails, facility names, and one EMR record per cashier per date.

For an isolated Identity workflow walkthrough and API checks, see [`IDENTITY_E2E_GUIDE.md`](IDENTITY_E2E_GUIDE.md). The guide uses a disposable MongoDB database and documents cleanup.
