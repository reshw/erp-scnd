-- =============================================
-- 대시보드 "통장별 잔고" 표시 순서 — 잔고 많은 순으로 자꾸 바뀌는 게 헷갈린다는 지적으로
-- 고정 순서 컬럼 신설. bank_accounts 테이블과는 별개(그쪽은 데이터가 대시보드에 실제
-- 찍히는 counterparty_name과 완전히 일치하지 않아 순서 전용 테이블로 분리).
-- =============================================
CREATE TABLE IF NOT EXISTS bank_display_order (
  name       text PRIMARY KEY,
  sort_order integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bank_display_order (name, sort_order) VALUES
  ('통장-IM뱅크', 1),
  ('통장-기업_마음디자인랩', 2),
  ('통장-기업-레저', 3),
  ('통장-케이뱅크', 4)
ON CONFLICT (name) DO NOTHING;
