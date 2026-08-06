-- 직원 상신 전표 대기열: 본인 건 취소(cancel) 허용
--
-- 026에서는 "한번 올린 대기열은 취소가 아니라 반려로 처리"로 설계했으나, 실사용해보니
-- AI 에이전트가 인코딩 오류/재시도로 잘못 올린 건까지 매번 관리자가 반려해야 하는 게
-- 비효율적이었다. status에 'cancelled'를 추가해 직원 본인이 웹(/staff/drafts)에서
-- pending 건을 직접 취소할 수 있게 한다 — DB 권한 변경 없음(웹 라우트는 admin client로
-- 처리하고 본인 소유 확인은 애플리케이션 레이어에서 함, approve/reject와 동일 패턴).
-- rejected(관리자 반려)와 cancelled(본인 취소)를 구분해 사유를 남긴다.

ALTER TABLE journal_drafts DROP CONSTRAINT journal_drafts_status_check;
ALTER TABLE journal_drafts ADD CONSTRAINT journal_drafts_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

COMMENT ON COLUMN journal_drafts.status IS
  'pending=대기, approved=승인(journals에 반영됨, approved_journal_id 참조),
   rejected=관리자 반려(rejected_reason 확인), cancelled=상신자 본인 취소';
