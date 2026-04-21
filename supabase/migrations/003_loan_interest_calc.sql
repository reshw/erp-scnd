-- #13 대출 이자 계산 방식 커스텀 컬럼 추가
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS interest_calc text NOT NULL DEFAULT 'monthly'
    CHECK (interest_calc IN ('monthly', 'daily_30', 'daily_actual'));

COMMENT ON COLUMN loans.interest_calc IS
  'monthly: 전월잔고×연이율/12 (은행표준) | daily_30: 연이율/365×30 | daily_actual: 연이율/365×실일수';
