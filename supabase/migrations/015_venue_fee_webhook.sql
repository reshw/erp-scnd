-- =============================================
-- 대관료(임차료) 자동전표 웹훅 지원
-- timetable 프로젝트가 매월 초 전표발행용 값을 POST로 보내옴
-- =============================================

-- 계정과목: 지급임차료 (나디아요가 대관료 지급)
INSERT INTO accounts (name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, note)
VALUES ('지급임차료', '영업', 'debit', '매입', '영업 - 매입', '취소', '영업 - 취소', 'timetable 대관료 자동전표 (60% of 공급가액)')
ON CONFLICT (name) DO NOTHING;

-- 월별 중복 발행 방지용 접수 기록 (period = 'YYYY-MM' 유니크)
CREATE TABLE venue_fee_postings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period     text NOT NULL UNIQUE,
  journal_id uuid REFERENCES journals(id),
  payload    jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
