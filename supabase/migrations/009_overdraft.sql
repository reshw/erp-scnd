-- #16 마이너스통장(한도대출) 지원

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS overdraft_limit numeric,
  ADD COLUMN IF NOT EXISTS include_draw_day boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);

COMMENT ON COLUMN loans.overdraft_limit IS '마이너스통장 한도 (loan_type=마이너스통장일 때 사용)';
COMMENT ON COLUMN loans.include_draw_day IS '당일 인출분을 당일 이자 계산에 포함할지 여부 (default ON)';
COMMENT ON COLUMN loans.account_id IS '잔액 추적 계정과목 (마이너스통장: 장기차입금 등)';
