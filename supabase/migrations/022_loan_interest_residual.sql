-- =============================================
-- 마통 이자 정액/잔여 배분
-- 같은 계좌(account_id)+거래처(counterparty_id)를 여러 프로젝트가 나눠쓰는 마통에서,
-- 특정 프로젝트는 기존 정밀 계산(일별잔액×금리이력)을 "정액"으로 신뢰하고,
-- 나머지 하나(잔여 프로젝트)는 실제 은행 청구 총액에서 정액분을 뺀 나머지로 역산한다.
-- 이유: 마통에 잦은 입출금(예: 매출정산금 임시 예치)이 섞이는 프로젝트는 일별잔액을
-- 정밀 추적하기 번거로워, 실제 청구액 기준 역산이 더 현실적이라 판단.
-- =============================================
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS is_interest_residual boolean NOT NULL DEFAULT false;

-- "일반" 마통(project 일반)을 잔여 프로젝트로 지정
UPDATE loans SET is_interest_residual = true
WHERE name = '마이너스통장 경남은행(일반)';
