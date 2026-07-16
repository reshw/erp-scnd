-- =============================================
-- 사업자(entities) 정보 확장 + 프로젝트 소속 사업자 매핑
-- 부가세 신고를 사업자 단위로 뽑기 위한 기반
-- =============================================

ALTER TABLE entities
  ADD COLUMN business_no text,
  ADD COLUMN opened_at   date,
  ADD COLUMN biz_type    text,
  ADD COLUMN biz_item    text;

ALTER TABLE projects
  ADD COLUMN entity_id uuid REFERENCES entities(id);

INSERT INTO entities (name, business_no, opened_at, biz_type, biz_item) VALUES
  ('마음디자인랩',       '687-36-01616', '2026-01-19', '제조업',       '그외 기타 봉제의복 제조업'),
  ('JH308',              '188-17-02548', '2024-08-21', '서비스업',     '광고대행업'),
  ('나디아 요가 퍼블릭', '174-12-02919', '2026-06-22', '교육서비스업', '기타 스포츠 교육기관');
