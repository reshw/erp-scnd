-- =============================================
-- 미지급금(기타) 계정과목 — 원리금균등 대출 이자·원금 자동선발행용.
-- 미지급금(영업)과 동일 패턴(019_ap_operating_account.sql 참조), 대출 쪽과 구분하기 위해
-- 별도 계정으로 신설.
-- =============================================
INSERT INTO accounts (name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, note)
VALUES ('미지급금(기타)', '영업', 'credit', '비용발생', '비용발생', '반제처리', '비용집행', '미지급금')
ON CONFLICT (name) DO NOTHING;
