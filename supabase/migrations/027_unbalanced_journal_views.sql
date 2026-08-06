-- 대시보드 "차대 불균형" 무결성 체크를 DB에서 계산하도록 뷰로 옮긴다.
--
-- 기존엔 journal_lines 전체를 애플리케이션으로 가져와 journal_id/project_id별로 JS에서
-- 합산했다. 행이 늘어날수록(현재 1천여 행) 렌더할 때마다 전체 테이블을 읽어야 해서
-- 비효율적이고, PostgREST의 서버 max-rows 제한(기본 1000)에 걸려 실제로 오탐 버그까지
-- 냈었다(docs/decisions.md 참고). SUM/GROUP BY/HAVING을 Postgres에 맡기면 인덱스
-- (idx_journal_lines_journal_id, idx_journals_project_id)를 타고 훨씬 가볍게 돌고,
-- 애플리케이션은 "불균형인 것만"(정상 상태면 0건) 받아오면 되므로 행 수 걱정이 없어진다.

CREATE VIEW unbalanced_journals AS
SELECT
  journal_id,
  SUM(debit)  AS total_debit,
  SUM(credit) AS total_credit,
  SUM(debit) - SUM(credit) AS diff
FROM journal_lines
GROUP BY journal_id
HAVING SUM(debit) <> SUM(credit);

CREATE VIEW unbalanced_project_totals AS
SELECT
  j.project_id,
  SUM(jl.debit)  AS total_debit,
  SUM(jl.credit) AS total_credit,
  SUM(jl.debit) - SUM(jl.credit) AS diff
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id
GROUP BY j.project_id
HAVING SUM(jl.debit) <> SUM(jl.credit);
