-- #13-2 시작월 일할이자 옵션 추가
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS first_month_partial boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN loans.first_month_partial IS
  '시작일이 월 1일이 아닌 경우 첫 회차를 잔여일수 일할이자만 납부 (default ON)';
