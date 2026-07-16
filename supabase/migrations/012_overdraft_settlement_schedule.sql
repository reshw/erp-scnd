-- 마이너스통장 정산 기산일 방식 (날짜기준 / 특정요일기준)

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS settlement_type text NOT NULL DEFAULT 'date' CHECK (settlement_type IN ('date', 'weekday')),
  ADD COLUMN IF NOT EXISTS settlement_day smallint CHECK (settlement_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS settlement_weekday smallint CHECK (settlement_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS settlement_week_of_month smallint CHECK (settlement_week_of_month BETWEEN 1 AND 5);

COMMENT ON COLUMN loans.settlement_type IS
  '마이너스통장 정산 기산일 방식: date(날짜기준) | weekday(특정요일기준). settlement_type=date이고 settlement_day가 NULL이면 기존 방식(매월 1일~말일 전체) 유지';
COMMENT ON COLUMN loans.settlement_day IS
  'settlement_type=date일 때 매월 정산 기준일(1~31, 말일 초과 시 그 달 말일로 조정)';
COMMENT ON COLUMN loans.settlement_weekday IS
  'settlement_type=weekday일 때 기준 요일 (ISO: 1=월요일 ... 7=일요일)';
COMMENT ON COLUMN loans.settlement_week_of_month IS
  'settlement_type=weekday일 때 몇 번째 요일인지 (1~5, 달력상 단순 카운트). 기산일이 주말이면 부과일(전표)은 익영업일로 이월';
