-- #13 중도상환 테이블
CREATE TABLE IF NOT EXISTS loan_prepayments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id    uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  date       date NOT NULL,          -- 중도상환 실행일
  amount     numeric NOT NULL,       -- 상환 원금
  note       text,
  journal_id uuid REFERENCES journals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loan_prepayments IS '중도상환 내역 (스케줄 외 원금 선상환)';
