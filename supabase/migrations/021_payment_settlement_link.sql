-- =============================================
-- timetable_payment_postings에 정산(입금) 연결 컬럼 추가
-- 미수금 계정은 거래처가 없어(counterparty null) /clearings의 거래처별 그룹핑이
-- 의미가 없다. 건별로 "찍힌 것 vs 실제 입금"만 보는 전용 화면(/receivables)을 위해
-- 어느 승인 posting이 어느 정산 전표로 정리됐는지 직접 연결한다.
-- =============================================
ALTER TABLE timetable_payment_postings
  ADD COLUMN IF NOT EXISTS settlement_journal_id uuid REFERENCES journals(id);
