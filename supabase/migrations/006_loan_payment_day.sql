-- #13 납부일 필드 추가 (매월 납부 기준일)
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS payment_day integer;

COMMENT ON COLUMN loans.payment_day IS
  '매월 납부일 (1~31). null이면 대출 시작일의 날짜를 사용. 예: 18 → 매월 18일 납부';
