-- =============================================
-- timetable 결제원장 커서 동기화
-- timetable(나디아요가)의 읽기전용 API에서 승인/취소 건을 당겨 매출전표를 자동 발행한다.
-- =============================================

-- 외부 연동 커서 보관. 동기화 대상이 늘면 key만 추가한다.
CREATE TABLE sync_state (
  key        text PRIMARY KEY,
  cursor     timestamptz,
  synced_at  timestamptz,
  note       text
);

INSERT INTO sync_state (key, note) VALUES
  ('timetable_payments', 'timetable /api/erp/payments 의 updated_at 커서')
ON CONFLICT (key) DO NOTHING;

-- 발행 이력. external_id가 유니크라 같은 결제를 두 번 전표화하지 않는다(멱등).
-- journal_id가 null이면 "수신했으나 전표 대상이 아님"(테스트 건, 0원 무료부여).
CREATE TABLE timetable_payment_postings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id  text NOT NULL UNIQUE,
  group_id     text,
  journal_id   uuid REFERENCES journals(id),
  skipped      text,
  payload      jsonb NOT NULL,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX timetable_payment_postings_group_idx ON timetable_payment_postings (group_id);
