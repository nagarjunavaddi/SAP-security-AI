# IK° Kontrol — Deployment Runbook

Connecting IK° Kontrol to a **new client system that already has SAP**.
We do NOT install SAP — we deploy the tool + its DB, then point it at the
client's existing SAP via OData.

Repo: `https://github.com/nagarjunavaddi/SAP-security-AI`

---

## What each new deployment needs — quick table

| # | Component | Where | Who | Time |
|---|-----------|-------|-----|------|
| **APP** |||||
| 1 | Node.js v18+ | New app server | You / IT | 15 min |
| 2 | IK° Kontrol code (git clone / ZIP) | App server | You | 5 min |
| 3 | `npm install` (6 deps) | Project folder | You | 10 min |
| 4 | `.env` file (16 keys — see below) | Project root | You | 15 min |
| **DATABASE** |||||
| 5 | PostgreSQL v14+ | App server or DB host | You / IT | 30 min |
| 6 | Create DB + run 5 setup scripts + date SQL | Project folder | You | 15 min |
| 7 | Seed data (users, roles, approval matrix) | via migrate-data.js or manual | You | 30 min |
| **SAP (client's existing system — config only)** |||||
| 8 | Import ABAP objects (SEGW OData + classes) as a transport | Client SAP | Client Basis | 2–4 hr |
| 9 | Register + activate OData services (`/IWFND/MAINT_SERVICE`) | Client SAP | Client Basis | 30 min |
| 10 | Create SAP service user for the tool | Client SAP | Client Security | 30 min |
| 11 | Grant auth objects to service user (user create, role assign, SU53 read) | Client SAP | Client Security | 1–2 hr |
| **NETWORK** |||||
| 12 | Open app-server → SAP gateway port (e.g. 8009) | Client network | Client Network | varies |

**Realistic totals**
- App + DB only (SAP already prepared): **~2–3 hours**
- Full first-time incl. SAP ABAP transport: **~1–2 days** (SAP side is the long pole; depends on client Basis/Security)
- Later clients (transport already built): **~half a day**

---

## `.env` template (16 keys)

Create `/.env` in the project root. Never commit it (already git-ignored).

```
# ---- Database ----
DATABASE_URL=postgresql://USER:PASS@HOST:5432/ikkontrol

# ---- SAP connection (client's existing system) ----
SAP_HOST=<client-sap-hostname>
SAP_PORT=<gateway-port, e.g. 8009>
SAP_CLIENT=<e.g. 800>
SAP_USER=<service-user>
SAP_PASSWORD=<service-user-password>

# ---- AI (SU53 scoring + inline chat) ----
GROQ_API_KEY=<key>
GROQ_MODEL=<model id>
GEMINI_API_KEY=<key>

# ---- Email notifications ----
SMTP_HOST=<host>
SMTP_PORT=<e.g. 587>
SMTP_USER=<user>
SMTP_PASS=<pass>
SMTP_FROM=<from address>

# ---- App ----
PORT=3000
SESSION_SECRET=<long-random-string>
```

> **Note:** After `patch-sapconfig-env.js` is applied, `SAP_CONFIG` in
> server.js reads all five SAP values from these env vars. Before the patch
> they were hardcoded in server.js — do not rely on that.

---

## Step-by-step

### A. App server
1. Install Node.js v18+ (`node -v` to confirm).
2. Get the code:
   ```
   git clone https://github.com/nagarjunavaddi/SAP-security-AI.git
   cd SAP-security-AI
   ```
   (or download ZIP and extract.)
3. Install dependencies:
   ```
   npm install
   ```
   Installs: axios, dotenv, express, express-session, nodemailer, pg.
4. Create `.env` from the template above.

### B. Database (PostgreSQL)
5. Install PostgreSQL v14+, create an empty database (name must match
   `DATABASE_URL`, e.g. `ikkontrol`).
6. Run the setup scripts **in this order** from the project folder:
   ```
   node setup-database.js
   node setup-user-create-table.js
   node setup-user-lock-request-table.js
   node setup-uar-tables.js
   node setup-uar-admin-pool.js
   ```
   Then apply the date columns (via psql or your DB tool):
   ```
   psql "%DATABASE_URL%" -f add-date-columns.sql
   ```
   (These scripts read `DATABASE_URL` from `.env`.)
7. Seed data:
   - If migrating from an existing IK° Kontrol DB: `pg_dump` the old DB and
     restore into the new one (brings users, roles, requests, campaigns).
   - If starting fresh: create at least an admin user in `ik_users`, plus the
     approval matrix in `data/approval-matrix.json` (see `migrate-data.js`).

### C. SAP side (client's existing SAP — no install)
8. Package the ABAP objects in `abap-segw/` (SEGW OData project + the
   `*_CREATE_ENTITY` classes) into a **transport request** and import it into
   the client SAP system. (Client Basis.)
9. In the client SAP, register + activate the OData services in
   `/IWFND/MAINT_SERVICE` (e.g. `ZUSER_LOCK_SRV_SRV` and the user-create
   service). Clear GW caches: `/IWFND/CACHE_CLEANUP` + `/IWBEP/CACHE_CLEANUP`.
10. Create a dedicated **SAP service user** for the tool (the one in
    `SAP_USER`). Communication/dialog per client policy.
11. Grant that user the authorizations the tool actually calls:
    - User create (SU01 create, logon data / validity),
    - Role assignment (BAPI_USER_ACTGROUPS_ASSIGN),
    - SU53 / auth-failure reads,
    - Lock/unlock (if used).
12. Open the network path from the app server to the SAP gateway host:port.

### D. Start + verify
13. Start the server:
    ```
    node server.js
    ```
    (or a process manager like pm2 for production.)
14. Open `http://<app-server>:3000`, log in as admin.
15. Verify:
    - Dashboard `/api/dashboard/summary` returns real counts.
    - A test user-create → check SU01 in SAP (validity dates land).
    - SU53 inbox pulls auth failures.

---

## Deployment gotchas (learned)
- **CRLF:** project files are CRLF-encoded on Windows; keep that consistent.
- **GW cache:** after activating/adjusting OData, always run
  `/IWFND/CACHE_CLEANUP` + `/IWBEP/CACHE_CLEANUP` or new fields (e.g. date
  fields) won't appear.
- **SESSION_SECRET:** set a real random value in prod (don't leave the
  server.js default).
- **AI keys optional-ish:** without GROQ/GEMINI keys, SU53 AI scoring +
  inline chat won't work, but the rest of the app runs.
- **SAP password in code:** ensure `patch-sapconfig-env.js` is applied so the
  password lives only in `.env`, not in server.js / git.

---

## Minimum to run WITHOUT SAP (UI/DB demo)
For a demo where SAP isn't connected: do steps A + B only, leave `SAP_*`
blank/dummy in `.env`. The app + dashboard + DB-backed screens run; any
live-SAP action (create user, assign role, SU53) will fail until SAP is wired
per section C.
