-- =============================================
-- ERP DB 스키마 (복식부기 기반)
-- Supabase: akdltdkcdkbutxtgxirp
-- =============================================

-- =============================================
-- 1. 계정과목 (Chart of Accounts)
-- =============================================
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  activity_type   text NOT NULL CHECK (activity_type IN ('영업', '재무', '투자', '개인', '현금', '세무')),
  normal_side     text NOT NULL CHECK (normal_side IN ('debit', 'credit')),
  increase_type   text NOT NULL,
  increase_label  text NOT NULL,
  decrease_type   text NOT NULL,
  decrease_label  text NOT NULL,
  note            text,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

-- =============================================
-- 2. 프로젝트
-- =============================================
CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- =============================================
-- 3. 법인/사업체
-- =============================================
CREATE TABLE entities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  type       text DEFAULT 'corporate' CHECK (type IN ('corporate', 'personal')),
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- 4. 거래처
-- =============================================
CREATE TABLE counterparties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  representative  text,
  business_no     text,
  email           text,
  bank_name       text,
  bank_account_no text,
  registered_at   date,
  note            text,
  created_at      timestamptz DEFAULT now()
);

-- =============================================
-- 5. 통장/계좌
-- =============================================
CREATE TABLE bank_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  bank        text NOT NULL,
  account_no  text,
  entity_id   uuid REFERENCES entities(id),
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- =============================================
-- 6. 전표 헤더 (Journal Entry)
-- =============================================
CREATE TABLE journals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_no   integer NOT NULL,
  date         date NOT NULL,
  description  text,
  project_id   uuid REFERENCES projects(id),
  entity_id    uuid REFERENCES entities(id),
  is_cancelled boolean DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_journals_no_date ON journals(journal_no, date);

-- =============================================
-- 7. 전표 명세 (Journal Lines) - 복식부기 핵심
-- =============================================
CREATE TABLE journal_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id        uuid NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  date              date NOT NULL,
  classification    text NOT NULL,
  activity_type     text NOT NULL CHECK (activity_type IN ('영업', '재무', '투자', '개인', '현금', '세무')),
  activity_subtype  text NOT NULL,
  account_id        uuid NOT NULL REFERENCES accounts(id),
  debit             numeric(15, 0) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            numeric(15, 0) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  counterparty_id   uuid REFERENCES counterparties(id),
  counterparty_name text,
  note              text,
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT one_side_only CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

-- =============================================
-- 8. 대출
-- =============================================
CREATE TABLE loans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  counterparty_id uuid REFERENCES counterparties(id),
  project_id      uuid REFERENCES projects(id),
  principal       numeric(15, 0),
  interest_rate   numeric(8, 6),
  start_date      date,
  end_date        date,
  loan_type       text,
  created_at      timestamptz DEFAULT now()
);

-- =============================================
-- 인덱스
-- =============================================
CREATE INDEX idx_journal_lines_journal_id  ON journal_lines(journal_id);
CREATE INDEX idx_journal_lines_date        ON journal_lines(date);
CREATE INDEX idx_journal_lines_account_id  ON journal_lines(account_id);
CREATE INDEX idx_journals_date             ON journals(date);
CREATE INDEX idx_journals_project_id       ON journals(project_id);

-- =============================================
-- Views
-- =============================================

-- 계정별 잔액
CREATE VIEW account_balances AS
SELECT
  a.id            AS account_id,
  a.name          AS account_name,
  a.activity_type,
  a.normal_side,
  COALESCE(SUM(jl.debit),  0) AS total_debit,
  COALESCE(SUM(jl.credit), 0) AS total_credit,
  CASE a.normal_side
    WHEN 'debit'  THEN COALESCE(SUM(jl.debit), 0)  - COALESCE(SUM(jl.credit), 0)
    WHEN 'credit' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
  END AS balance
FROM accounts a
LEFT JOIN journal_lines jl ON jl.account_id = a.id
GROUP BY a.id, a.name, a.activity_type, a.normal_side;

-- 프로젝트별 잔액
CREATE VIEW project_balances AS
SELECT
  p.id                        AS project_id,
  p.code                      AS project_code,
  p.name                      AS project_name,
  COALESCE(SUM(jl.debit),  0) AS total_debit,
  COALESCE(SUM(jl.credit), 0) AS total_credit
FROM projects p
LEFT JOIN journals j    ON j.project_id = p.id
LEFT JOIN journal_lines jl ON jl.journal_id = j.id
GROUP BY p.id, p.code, p.name;

-- 월별 현금흐름
CREATE VIEW monthly_cashflow AS
SELECT
  date_trunc('month', jl.date)::date AS month,
  j.project_id,
  jl.activity_type,
  jl.activity_subtype,
  SUM(jl.debit)  AS total_debit,
  SUM(jl.credit) AS total_credit
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;

-- =============================================
-- RLS (Row Level Security)
-- =============================================
ALTER TABLE accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE journals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users" ON accounts       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON projects       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON entities       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON counterparties FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON bank_accounts  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON journals       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON journal_lines  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated users" ON loans          FOR ALL USING (auth.role() = 'authenticated');
