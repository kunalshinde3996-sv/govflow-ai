# GovFlow AI - One Case Engine, Many Government Services

Office of the Collector, North Goa District - Goa AI Hackathon, Team NullCoders.

## Run locally (no database setup needed)
    cd backend  && npm install && npm start      # API on :4000 (in-memory Postgres-compatible DB, auto-seeded)
    cd frontend && npm install && npm run dev     # UI on :5173 (proxies /api)
    cd backend  && npm test                       # 24 tests: rule engine, end-to-end (real OCR), assistant

Demo accounts (password `Demo@1234`): `citizen@govflow.demo`, `ramesh@example.in` (citizen with a case in review),
`officer@govflow.demo`, `admin@govflow.demo`.
Sample documents for a live demo are in `sample-documents/` (`valid-set/` reads cleanly and is eligible;
`blurry-scan/` triggers the Manual Review flag).

## Architecture (each concern is its own module)
| Concern | Path | Notes |
|---|---|---|
| Case engine (state machine, CRUD) | `backend/src/engine/caseEngine.js` | Generic; every transition validated and audited |
| Rule engine (eligibility + compensation) | `backend/src/rules/ruleEngine.js` | Pure, DB-free, unit-tested; config in `rules/configs/*.json` |
| OCR + confidence + manual-review fallback | `backend/src/ocr/ocrService.js` | Tesseract.js; never guesses, flags instead |
| Audit (hash-chained, append-only) | `backend/src/audit/auditService.js` | AsyncLocalStorage actor context; DB trigger on real Postgres |
| GovFlow Assist (grounded assistant) | `backend/src/services/assistant/` | Read-only; context, provider, fallback, sanitiser, rate limit |
| Orchestration | `backend/src/services/pipeline.js` | Wires OCR -> rules -> engine |
| Schema | `backend/src/db/schema.sql` | users, cases, documents, rule_configs, audit_logs (+ case_milestones) |

Modules: Land Acquisition (flagship) and Disaster Relief run on the identical engine with different JSON
rule-sets; Revenue Administration and Scheme Implementation are sample configs shown in the admin
"Modules & Rules" screen. Admins can publish new, versioned rule-sets there.

## Deploy
Backend: Render blueprint `render.yaml` (PostgreSQL + web service). Frontend: Vercel, root `frontend`,
env `VITE_API_URL=https://<api>.onrender.com`. Set `CORS_ORIGIN` on the API to the Vercel URL.
Note: uploaded files use local disk (ephemeral on Render free tier); use object storage for production.

## GovFlow Assist (grounded AI assistant)
Endpoint: `POST /api/assistant/chat { message, caseId?, language?, task? }` (and `GET /api/assistant/status`).
Citizens get a floating chat panel scoped to the case they are viewing (English, Hindi, Marathi, Konkani). Officers get
the same panel with queue and analytics answers, plus a **Summarise this case** brief on the review screen.

**Environment variables (backend):** `ANTHROPIC_API_KEY` (Anthropic API via the official SDK), `ASSISTANT_MODEL`
(default `claude-opus-5-5`; choose a faster model for lower latency), `ASSISTANT_RATE_LIMIT` (questions per user per
minute, default 20).

**Fallback (Basic mode):** with no key, or if the API errors, refuses, or takes longer than 8 seconds, answers are
produced deterministically from the same case data: status, documents, why flagged or rejected, compensation breakdown,
what happens next; for officers, the manual-review count, bottleneck and queue. The UI shows a "Basic mode" label.
Basic mode answers in English.

**Safety rules**
- Grounding only: the model receives the case record, milestones, stored eligibility trail, compensation breakdown, the
  scheme rule-set and (staff only) analytics computed by the backend. The system prompt forbids answering outside that
  context, promising approval or amounts beyond the stored calculation, and taking actions.
- Access control is server-side: a citizen requesting another citizen's case gets 403; citizens never receive queue or
  analytics context; summaries are officer-only.
- Read-only: the module has no write path to case data.
- OCR and applicant text is sanitised (length-capped, instruction-like text removed) and passed as data.
- Every exchange is written to the hash-chained audit log as `ASSISTANT_QUERY` (actor, case, question, mode, truncated
  answer and a short hash; never API keys). Per-user rate limiting applies.
