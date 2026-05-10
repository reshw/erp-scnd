-- #13-3 대출 Scheduled/Settled 시스템
CREATE TABLE IF NOT EXISTS loan_settlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id     uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  month       text NOT NULL,           -- 'YYYY-MM'
  actual_interest  numeric NOT NULL,   -- 실제 납부 이자 (금리변동 반영 가능)
  actual_repayment numeric,            -- 실제 원금상환 (null = 스케줄대로)
  note        text,
  journal_id  uuid REFERENCES journals(id) ON DELETE SET NULL,
  settled_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(loan_id, month)
);

COMMENT ON TABLE loan_settlements IS '대출 월별 실제 납부 확정 내역 (Scheduled → Settled)';
COMMENT ON COLUMN loan_settlements.actual_repayment IS 'null이면 계산된 스케줄 원금 그대로 사용';
