-- GovFlow AI schema. Kept to a portable SQL subset so it runs on PostgreSQL
-- (production) and pg-mem (zero-setup local dev). Statements are split on ';'.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL,              -- citizen | officer | admin
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Versioned, JSON-configurable rule-sets. One active version per scheme_type.
-- The case engine is generic; everything scheme-specific lives in `config`.
CREATE TABLE IF NOT EXISTS rule_configs (
  id          uuid PRIMARY KEY,
  scheme_type text NOT NULL,
  version     integer NOT NULL,
  name        text NOT NULL,
  config      jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id                    uuid PRIMARY KEY,
  case_number           text NOT NULL UNIQUE,
  scheme_type           text NOT NULL,
  applicant_id          uuid NOT NULL REFERENCES users(id),
  status                text NOT NULL,
  needs_manual_review   boolean NOT NULL DEFAULT false,
  manual_review_reasons jsonb,
  form_data             jsonb NOT NULL,
  eligibility           jsonb,              -- outcome + full explanation trail
  compensation          jsonb,              -- itemised breakdown (+ override)
  decision              jsonb,              -- final officer decision + reason
  rule_config_version   integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  submitted_at          timestamptz,
  status_entered_at     timestamptz NOT NULL DEFAULT now()
);

-- Stage history: powers the timeline UI and per-stage processing-time analytics.
CREATE TABLE IF NOT EXISTS case_milestones (
  id         serial PRIMARY KEY,
  case_id    uuid NOT NULL REFERENCES cases(id),
  status     text NOT NULL,
  entered_at timestamptz NOT NULL,
  exited_at  timestamptz,
  actor_name text,
  note       text
);

CREATE TABLE IF NOT EXISTS documents (
  id                 uuid PRIMARY KEY,
  case_id            uuid NOT NULL REFERENCES cases(id),
  doc_type           text NOT NULL,
  original_name      text NOT NULL,
  stored_name        text NOT NULL,
  mime               text,
  size               integer,
  ocr_status         text NOT NULL DEFAULT 'pending',  -- pending | done | failed | skipped
  ocr_text           text,
  extracted          jsonb,                            -- {field: {value, confidence, source}}
  overall_confidence numeric,
  needs_review       boolean NOT NULL DEFAULT false,
  review_reasons     jsonb,
  verified_by        text,
  verified_at        timestamptz,
  superseded         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Append-only, hash-chained audit log. See src/audit/auditService.js.
CREATE TABLE IF NOT EXISTS audit_logs (
  id         serial PRIMARY KEY,
  ts         timestamptz NOT NULL,
  case_id    uuid,
  case_number text,
  actor_id   text,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  reason     text,
  prev_hash  text,
  hash       text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_applicant ON cases(applicant_id);
CREATE INDEX IF NOT EXISTS idx_docs_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_logs(case_id);
