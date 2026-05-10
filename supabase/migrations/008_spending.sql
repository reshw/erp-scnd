-- 지출계획 시스템 (260421)

-- ── spending_plans: 지출예정 마스터 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS spending_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('one_time', 'recurring')),
  amount          numeric NOT NULL,
  recurrence_day  integer,          -- recurring: 매월 N일
  planned_date    date,             -- one_time: 지급예정일
  account_id      uuid REFERENCES accounts(id),
  counterparty_id uuid REFERENCES counterparties(id),
  project_id      uuid REFERENCES projects(id),
  note            text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── spending_executions: 집행 내역 (대출+지출예정 통합) ─────────────────
CREATE TABLE IF NOT EXISTS spending_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     text NOT NULL CHECK (source_type IN ('loan', 'plan')),
  source_id       uuid NOT NULL,    -- loan.id 또는 spending_plan.id
  planned_date    date NOT NULL,    -- 지급예정일
  amount          numeric NOT NULL,
  interest        numeric,          -- 대출 이자 (source_type='loan'일 때)
  repayment       numeric,          -- 대출 원금 (source_type='loan'일 때)
  description     text,             -- 표시 이름 (예: "IM뱅크 장기대출 2026-05")
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'postponed', 'cancelled')),
  note            text,
  journal_id      uuid REFERENCES journals(id) ON DELETE SET NULL,
  executed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spending_executions_planned_date ON spending_executions(planned_date);
CREATE INDEX IF NOT EXISTS idx_spending_executions_status ON spending_executions(status);
CREATE INDEX IF NOT EXISTS idx_spending_executions_source ON spending_executions(source_type, source_id);
