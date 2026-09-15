# IK° Kontrol — Project Context Card
**Paste or upload this file as the FIRST message in every new chat.**
Last updated: 2026-09-14 (work state as of 2026-09-14)

---

## 0. How to use this file

Start a new chat with:

> "Here is my IK° Kontrol project context. Read it, then we continue.
> Today's task: <describe task>"

...and attach/paste this file. Then update the **Section 7 (Open Items)** and
**Section 8 (Changelog)** at the end of each session so the next chat starts current.

---

## 1. Product

| Item | Value |
|---|---|
| Product name | **IK° Kontrol** (formerly IKAegis / CerberuS) |
| Category | SAP Security / GRC / Access Governance |
| Parent brand | InfoKrafts — Swiss SAP-GRC consultancy |
| Brand values | Trust · Quality · Performance |
| Target market | European enterprise |
| 5 Pillars | SoD Embedded · Workflow · Analytics · Accelerators · GRC Leading Org Value |

---

## 2. Environment

| Item | Value |
|---|---|
| GitHub repo | `nagarjunavaddi/SAP-security-AI` |
| Working path | `C:\Users\iksec2\Desktop\SAP-security-AI` |
| Machine | RDP box, Windows Server 2016, user `iksec2` |
| Backend | Node.js / Express |
| SAP system | S/4HANA — `s4hana2020.support.com`, client **800**, port **8009** |
| Integration | OData / SEGW + RFC |
| Key SEGW service | `ZUSER_LOCK_SRV_SRV` |
| SU53 ABAP program | `ZKONTROL_SU53` (pushes auth failures to Node) |
| Database | Supabase PostgreSQL — project `IKAegis-DB` |
| AI | Groq (Security Query agent loop — **Kimi K2**), Gemini (fallback + `aifix.js`) |

### Tooling constraint — IMPORTANT
- **VS Code terminal is broken on this server.** Only **CMD + notepad.exe** are usable.
- Code changes are applied via **`aifix.js`** (Gemini-based edit tool) or **automated
  `patch-*.js` node scripts** — **NOT manual edits**.
- Any code I deliver must therefore be shipped as a **self-contained patch script or a
  full new file**, never as "open this file and change line 42".
- **Copy commands must be ONE block** (Downloads → project folder + run combined),
  never split.
- User **cannot upload files** — instead I say which file to open (CMD/notepad path),
  user copy-pastes content into chat.

---

## 3. GOLDEN RULE (never break this)

> **Every new feature must be 100% additive.**
> Extend via **new files / new routes**. Touch an existing file only when unavoidable,
> and then only **one line**, applied through a **patch script** that:
> 1. takes a **backup** first,
> 2. is **idempotent** (safe to run twice),
> 3. verifies the change after applying.

`server.js` is touched **only** for route-mount additions.

---

## 4. Modules built & verified live

1. **SoD Embedded (core risk engine)** — 4 risk types: Action Level, Permission Level,
   Critical Action, Critical Permission. Wired across Role + User, single + bulk analysis,
   Excel export.
2. **Approval Workflow Engine** — dual-level approval (Manager → Role Owner), SAP role
   auto-assignment, email notifications, PostgreSQL-backed.
3. **Generic OData / RFC layer** — `RFC_READ_TABLE` + BAPI calls via SEGW; AI agent loop
   (Security Query chatbot).
4. **UAR — User Access Review** — periodic access recertification: campaigns, 3-level
   drill-down, ADMIN-pool for orphan roles, bulk actions, inline SoD-conflict overlay,
   finalize + Excel audit report.
5. **Dashboard restructure** — 11 flat tiles → 5 module hubs (Risk Analysis, Access Requests,
   Access Reviews, Reports & Monitoring, Security Query AI). Mirrors SAP GRC ARA/ARM/EAM/BRM.
6. **SU53 Agent (agentic AI)** — production-working. SAP auth failure → `ZKONTROL_SU53`
   pushes to Node → agent finds matching roles from real `AGR_1251` → SoD-checks each →
   ranks clean-first → central admin inbox (`su53-inbox.html`).
7. **User Lock/Unlock** — end-to-end, working (2026-09). SEGW `UserLockAction` entity +
   `BAPI_USER_LOCK`/`BAPI_USER_UNLOCK`. Node core (`user-lock.js`), DB table
   `user_lock_requests`, approval workflow (`routes/user-lock-requests.js`), UI page
   (`user-lock-request.html`), requests-hub tile + dashboard quick-action (wired to the
   page), unified approval queue integration, approver routing = **target user's manager**.

---

## 5. Key files (all in the GitHub repo)

### Core
- `server.js` — core; **route-mount additions only**
- `db.js`, `db-uar.js` — DB helpers (user_managers, role_owners, defaultApprover, audit_log)

### Routes
- `routes/uar-routes.js`
- `routes/su53-routes.js`
- `routes/ai-routes.js` — **Security Query AI agent (see §9)**
- `routes/user-lock-requests.js`, `routes/user-lock-routes.js` — User Lock/Unlock
- `rfc-routes.js`

### SU53 agent
- `su53/su53-agent.js`, `su53/su53-data.js`

### UI — feature pages
- `SOD.html`
- `approvals.html`, `approval-config.html`, `audit-log.html`
- `uar-inbox.html`, `uar-admin.html`
- `su53-agent.html`, `su53-inbox.html`
- `user-lock-request.html`

### UI — hub landing pages
- `risk-hub.html`, `requests-hub.html`, `reviews-hub.html`, `reports-hub.html`
- `index.html` (main dashboard)

### Data / rulesets
- `data/sod-ruleset.json`, `data/sod-ruleset-permissionlevel.json`
- `data/critical-actions.json`, `data/critical-permissions.json`

### Tooling
- `aifix.js` — Gemini-based code-edit tool
- `patch-*.js` — idempotent, backup-generating automated patchers (**preferred method**)

### Design / demo
- `ik-kontrol-client-demo.html` — v3 UI style (Navy `#0C2438` · Brass `#B0894F` · Fraunces).
  Plan: re-skin whole app in this style (**parked**).

---

## 6. What to tell me at the start of each new chat

1. **Today's task** — which module / which file.
2. **Any change made since this file was last updated.**
3. **The current content of the file(s) we're editing** (paste — I can't read your repo).
4. **Any error text / console output**, verbatim.
5. Whether the previous session's patch was **verified working or still pending**.

---

## 7. Open items (as of 2026-09-14)

| # | Item | Status |
|---|---|---|
| 1 | `su53-inbox.html` SoD-badge fix — `patch-su53-inbox-sodfix.js` | Delivered, **verification pending** |
| 2 | **Wildcard risk (Issue 3)** — `ACTVT='*'` must flag in SU53 agent scoring → `su53/su53-agent.js` | **Not built** |
| 3 | SU53 dashboard tile in `index.html` / hub | **Not added** |
| 4 | UAR: due-date email reminders | **Not built** |
| 5 | UAR: filter chips + search box on L2 drill-down | **Not built** |
| 6 | Whole-app UI re-skin to v3 (navy/brass/Fraunces) | **Parked** |
| 7 | **Groq free-tier TPM (8,000/min)** — big multi-hop AI queries (e.g. "all users with FB03") can hit the limit → Gemini fallback covers it, but consider **Groq Dev tier** ($0 minimum, ~10x limits) for production | **Decision pending** |
| 8 | Cleanup: many `.bak-*` files in repo + `routes/` from this session | Safe to `del *.bak-*` once all verified |
| 9 | **Rotate the Groq API key** — it was exposed during a debugging session | **Pending** — revoke at console.groq.com/keys, put fresh key in `.env` |

---

## 8. Session changelog

_Append one line per session: date — what changed — files touched — verified?_

- 2026-08-21 — SU53 inbox SoD-badge fix delivered — `patch-su53-inbox-sodfix.js` — verification pending
- 2026-09-09 — Context card created — `IK-KONTROL-CONTEXT.md` — n/a
- 2026-09-12 — User Lock/Unlock built end-to-end (SEGW + BAPI + Node + DB + approval + UI) — `user-lock.js`, `routes/user-lock-requests.js`, `routes/user-lock-routes.js`, `user-lock-request.html`, `server.js` (route-mount), `unified-approvals.js` — VERIFIED working
- 2026-09-14 — Dashboard "coming soon" toast → wired Lock/Unlock quick-action to `user-lock-request.html` (`index.html`) — VERIFIED
- 2026-09-14 — Fixed `readRequests is not defined` crash — neutralised dead legacy `/api/requests` route in `server.js` — VERIFIED
- 2026-09-14 — Security Query AI overhaul (`routes/ai-routes.js`): deprecated Groq model fixed → model now env-configurable (`GROQ_MODEL`); Gemini fallback added (`callGemini`/`callAI`); reasoning tuning (max_tokens 8192 + reasoning_effort low); token optimization (`slimResult` — strip OData metadata + truncate 60 rows); `get_locked_users` filtered to LockStatus=Locked; anti-hallucination prompt rules; **switched model to Kimi K2** which fixed tool-calling — VERIFIED (locked-users query returns correct 13 users incl. NAG1)

---

## 9. Security Query AI — agent internals (routes/ai-routes.js)

- **Architecture:** agentic loop, `MAX_LOOPS=3`. AI returns **prompt-based JSON**
  (`{"action":"tool_call"|"final_answer", ...}`) — NOT native Groq function-calling.
  Code parses the JSON, executes tools, feeds results back, loops until `final_answer`.
- **Model:** **Kimi K2** (`moonshotai/kimi-k2-instruct`), set via `GROQ_MODEL` in `.env`.
  - Why: `gpt-oss-120b` (a reasoning model) **skips tool calls** in this prompt-based loop
    and hallucinates data (returned fake "USER1/USER2"). Kimi K2 is agentic/tool-calling
    strong and calls tools correctly.
  - Model is env-configurable so future Groq deprecations = `.env` change, no code edit.
- **Fallback:** `callAI()` tries Groq → on ANY failure (expired key, rate limit, parse
  error) falls back to **Gemini 2.5-flash** (`callGemini`, uses `GEMINI_API_KEY`).
  Tested working: Groq "Invalid API Key" → Gemini completed the full loop.
- **Token optimization:** `slimResult()` strips `__metadata`/`uri`/`type` from OData rows
  and truncates results to `TOKOPT_MAX_ROWS = 60` (adjustable), keeping a true count note.
- **Tools:** `table_read` (generic SAP table via `GenericTableReadSet` — clean, no metadata),
  `get_locked_users` (UserLockSet **filtered to LockStatus=Locked**), `get_user_roles`.
- **Env keys required:** `GROQ_API_KEY`, `GEMINI_API_KEY`, `GROQ_MODEL`, plus SAP creds
  (`SAP_HOST`, `SAP_PORT`, `SAP_USER`, `SAP_PASS`/`SAP_PASSWORD`).

### GOTCHAS learned this session
- **Groq models deprecate fast.** `llama-3.3-70b-versatile` + `llama-3.1-8b-instant`
  were decommissioned 2026-08-16. Always check console.groq.com/docs/deprecations.
- **Reasoning models (gpt-oss-20b/120b) are weak at prompt-based agentic tool-loops** —
  they skip tools and hallucinate. Use **Kimi K2** for the agent loop.
- **Groq free tier = 30 RPM / 1,000 RPD / 8,000 TPM / 200,000 TPD** (per org, per model;
  daily/per-minute reset, keys don't expire). TPM (8k/min) is the binding limit for
  agentic loops on large SAP datasets.
- **`.env` can hold unlimited keys** (GROQ, GEMINI, OpenAI, etc.) — names must match
  `process.env.XXX` exactly.
