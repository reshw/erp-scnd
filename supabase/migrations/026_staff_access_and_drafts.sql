-- 직원용 ERP AI 에이전트: 프로젝트 스코프 DB 키 + 전표 대기열(승인 게이트)
--
-- 배경: 직원(회계팀 아닌 영업직)이 자기 Claude Code에 이 마이그레이션이 만드는 DB 키를
-- 물려서 자연어로 전표를 요청하게 한다. 방어선은 애플리케이션 레이어가 아니라
-- Postgres 권한 자체 — 이 키로는 journals/journal_lines에 INSERT 권한이 아예 없어서
-- AI가 무엇을 시도하든 DB가 거부한다. 실제로 쓸 수 있는 건 journal_drafts뿐이고,
-- 관리자가 승인해야 journals/journal_lines에 정식 반영된다(SAP 문서 파킹과 동일한 원리).
--
-- 기존 RLS 정책("authenticated users", auth.role()='authenticated')은 Supabase Auth의
-- JWT 컨텍스트를 읽는 함수라, 이 마이그레이션이 만드는 role처럼 Supabase Auth를 거치지
-- 않는 순수 Postgres 접속에는 적용되지 않는다 — 안전하게 격리됨. 이 role을 위한 정책은
-- 전부 새로 짠다.

-- ── 1. 관리 테이블 ──────────────────────────────────────────────────────────

CREATE TABLE staff_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id),
  db_role text UNIQUE NOT NULL,
  auth_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
COMMENT ON TABLE staff_access IS
  'AI용 DB 키(Postgres role)와 웹 로그인 계정을 프로젝트 하나에 매핑. 직원 1명 = 이 행 1개.
   AI 키 발급: CREATE ROLE <db_role> LOGIN PASSWORD ...; GRANT project_scoped_agent TO <db_role>;
   회수: ALTER ROLE <db_role> PASSWORD ...(교체) 또는 revoked_at 세팅 + 애플리케이션에서 차단.';

CREATE TABLE posting_conventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  topic text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE posting_conventions IS
  '프로젝트별 전표 발행 관행. 직원 AI 에이전트가 자기 프로젝트(staff_access.project_id) 것만
   읽어가서 계정과목/거래처 선택 기준으로 삼는다. docs/manual-posting-conventions.md 같은
   문서를 폴더로 배포하는 대신 여기 저장 — 배포물이 프로젝트 지식을 하드코딩하지 않게 함.';

-- ── 2. 전표 대기열 ──────────────────────────────────────────────────────────

CREATE TABLE journal_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  description text,
  project_id uuid NOT NULL REFERENCES projects(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by_role text NOT NULL DEFAULT current_user,
  reviewed_at timestamptz,
  rejected_reason text,
  approved_journal_id uuid REFERENCES journals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE journal_drafts IS
  '전표 대기열. 확정 장부(journals)가 아님 — 여기 넣은 뒤 사용자에게
   "대기열에 올렸습니다. 승인되면 정식 반영됩니다"라고 안내할 것. journal_no는 없음
   (관리자 승인 시 journals에 정식 채번되어 들어감). 승인/반려는 관리자가 ERP 웹
   (/journal-drafts)에서 처리.';
COMMENT ON COLUMN journal_drafts.status IS
  'pending=대기, approved=승인(journals에 반영됨, approved_journal_id 참조), rejected=반려(rejected_reason 확인)';

CREATE TABLE journal_draft_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES journal_drafts(id) ON DELETE CASCADE,
  date date NOT NULL,
  classification text NOT NULL,
  activity_type text NOT NULL,
  activity_subtype text NOT NULL DEFAULT '',
  account_id uuid NOT NULL REFERENCES accounts(id),
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  counterparty_id uuid,
  counterparty_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE journal_draft_lines IS
  'journal_lines와 동일한 컬럼 구성(차변/대변 라인). classification/activity_type은
   accounts.increase_label/decrease_label 규칙을 그대로 따라 채울 것 — 차변인지 대변인지에
   따라 increase_label(정상측과 같은 방향) 또는 decrease_label을 쓴다.';

-- ── 3. 직원 AI 전용 role ────────────────────────────────────────────────────

CREATE ROLE project_scoped_agent NOLOGIN;
COMMENT ON ROLE project_scoped_agent IS
  '직원 AI 키(개별 LOGIN role)들이 소속되는 그룹. 정책/권한을 이 그룹 하나에만 걸어두면
   새 직원 추가 시 GRANT project_scoped_agent TO <새 role> 한 줄로 끝난다.';

-- 마스터 데이터: 전체 조회 허용 (프로젝트 스코프 무의미 — 계정과목/거래처 이름 정도 노출 무방)
-- 주의: accounts/projects/counterparties는 001_schema.sql에서 이미 RLS가 켜져 있고
-- "authenticated users" 정책만 있어(Supabase Auth 세션 전용) 이 role엔 적용 안 됨 —
-- GRANT만으론 부족하고 아래 4번 섹션에서 이 role 전용 정책을 별도로 추가해야 실제로 보인다.
GRANT SELECT ON accounts, projects, counterparties TO project_scoped_agent;

-- 확정 장부: 조회만, 그것도 자기 프로젝트만. INSERT/UPDATE/DELETE는 GRANT 자체를 안 함
-- (RLS 이전 단계의 원천 차단 — RLS 정책이 뚫려도 이 권한 자체가 없으면 쓰기 시도는 항상 실패)
GRANT SELECT ON journals, journal_lines TO project_scoped_agent;
COMMENT ON TABLE journals IS
  '확정 장부. project_scoped_agent 그룹 키는 자기 프로젝트 것만 조회 가능하고 INSERT/UPDATE/
   DELETE 권한이 없다(DB가 거부). 전표 발행 요청은 journal_drafts/journal_draft_lines에
   넣을 것 — journals에 직접 쓰려는 시도는 하지 말 것(성공하지 않는다).';

-- 대기열: 조회 + 삽입만 (수정/삭제 불가 — 한번 올린 대기열은 취소가 아니라 반려로 처리)
GRANT SELECT, INSERT ON journal_drafts, journal_draft_lines TO project_scoped_agent;

GRANT SELECT ON posting_conventions TO project_scoped_agent;
GRANT SELECT ON staff_access TO project_scoped_agent;

-- ── 4. RLS 활성화 + 정책 ────────────────────────────────────────────────────

ALTER TABLE journal_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_draft_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_conventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_access ENABLE ROW LEVEL SECURITY;

-- journals/journal_lines: 이미 RLS 활성화돼 있음(001_schema.sql) — 정책만 추가
CREATE POLICY "project scoped agent read own project" ON journals
  FOR SELECT TO project_scoped_agent
  USING (project_id IN (
    SELECT sa.project_id FROM staff_access sa
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ));

CREATE POLICY "project scoped agent read own project" ON journal_lines
  FOR SELECT TO project_scoped_agent
  USING (journal_id IN (
    SELECT j.id FROM journals j
    JOIN staff_access sa ON sa.project_id = j.project_id
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ));

CREATE POLICY "project scoped agent rw own drafts" ON journal_drafts
  FOR ALL TO project_scoped_agent
  USING (project_id IN (
    SELECT sa.project_id FROM staff_access sa
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ))
  WITH CHECK (project_id IN (
    SELECT sa.project_id FROM staff_access sa
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ));

CREATE POLICY "project scoped agent rw own draft lines" ON journal_draft_lines
  FOR ALL TO project_scoped_agent
  USING (draft_id IN (
    SELECT d.id FROM journal_drafts d
    JOIN staff_access sa ON sa.project_id = d.project_id
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ))
  WITH CHECK (draft_id IN (
    SELECT d.id FROM journal_drafts d
    JOIN staff_access sa ON sa.project_id = d.project_id
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ));

CREATE POLICY "project scoped agent read own conventions" ON posting_conventions
  FOR SELECT TO project_scoped_agent
  USING (project_id IN (
    SELECT sa.project_id FROM staff_access sa
    WHERE sa.db_role = current_user AND sa.revoked_at IS NULL
  ));

CREATE POLICY "project scoped agent read own access row" ON staff_access
  FOR SELECT TO project_scoped_agent
  USING (db_role = current_user);

-- accounts/projects/counterparties는 001_schema.sql에서 이미 RLS 활성화 + "authenticated
-- users" 정책만 있음(Supabase Auth 세션 전용, 이 role엔 안 걸림) — 마스터 데이터 전체 조회
-- 정책을 이 role 전용으로 추가
CREATE POLICY "project scoped agent read master data" ON accounts
  FOR SELECT TO project_scoped_agent USING (true);
CREATE POLICY "project scoped agent read master data" ON projects
  FOR SELECT TO project_scoped_agent USING (true);
CREATE POLICY "project scoped agent read master data" ON counterparties
  FOR SELECT TO project_scoped_agent USING (true);

-- 관리자(웹, service_role 경유)는 RLS를 우회하므로 journal_drafts/posting_conventions/
-- staff_access에 "authenticated" 정책은 필요 없음 — 전부 admin client(service_role)로 접근.

-- ── 5. NADIA 관행 시딩 ──────────────────────────────────────────────────────

INSERT INTO posting_conventions (project_id, topic, body) VALUES
(
  '905bf801-8caa-4088-a2eb-5436fb24dc7d',
  'PG/카드/현금 결제 매출',
  '수강료 등 매출은 결제수단별로 미수금 계정이 다르다: 신용카드→미수금(신용카드),
   무통장입금→미수금(무통장입금), PG(포트원/NHN)→미수금(PG). 실제 입금 확인 시
   /receivables에서 실입금액을 입력하면 자동정산 로직이 수수료(gross-net 차이)를
   판관비(지급수수료)로 잡는다 — 이 과정은 이미 자동화돼 있으니 수기로 수수료 전표를
   따로 찍지 말 것.'
),
(
  '905bf801-8caa-4088-a2eb-5436fb24dc7d',
  '대관료(임차료) 지급',
  '매월 초 대관료 60% 산정 결과가 자동으로 지급임차료(차변)/부가세대급금(차변)/
   미지급금(매입)(대변) 전표로 발행된다(venue-fee 자동화). 수기로 중복 발행하지 말 것 —
   이미 접수됐는지 헷갈리면 확인부터.'
),
(
  '905bf801-8caa-4088-a2eb-5436fb24dc7d',
  '마케팅/광고 용역비',
  '사진촬영·영상제작·SNS광고 등은 광고선전비 계정을 쓴다(판관비/지급수수료로 퉁치지 말 것).
   일반 매입(용역·임차 등) 미지급은 미지급금(매입), 대출 원리금은 미지급금(원리금) —
   NADIA 업무에서 대출 관련은 거의 없을 것이므로 대부분 미지급금(매입).'
);
