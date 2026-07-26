-- =============================================
-- 미지급금(영업) 계정과목 — 이미 프로덕션 DB에 존재(venue-fee가 참조 중)했으나
-- 마이그레이션 파일이 없어 재현 불가능했음. 기존 DB 값 그대로 채번(idempotent).
-- =============================================
INSERT INTO accounts (name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, note)
VALUES ('미지급금(영업)', '영업', 'credit', '비용발생', '비용발생', '반제처리', '비용집행', '미지급금')
ON CONFLICT (name) DO NOTHING;
