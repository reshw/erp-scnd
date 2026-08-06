<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 수기 전표 발행

사용자가 자연어로 입출금·카드결제 내역을 주고 "전표 발행해줘"라고 하면(코드 작업이 아니라
DB에 직접 전표를 쓰는 작업), 계정 선택 전에 반드시 `docs/manual-posting-conventions.md`를
먼저 읽는다. 특히 양석환 개인자금/우미사업비/하나카드가 얽힌 사업비 정산 케이스는 계정을
잘못 고르기 쉽다.

# 직원 AI 전표 대기열 승인

사용자가 "대기열 확인해줘"/"NADIA 상신 뭐 있어?" 같은 요청을 하면 `journal_drafts` 테이블에서
`status='pending'`인 행을 조회해서 보여준다(직원용 DB 키가 여기까지만 쓸 수 있고,
`journals`/`journal_lines`엔 직접 못 쓴다 — `supabase/migrations/026_staff_access_and_drafts.sql`
참조). 웹 화면은 `/journal-drafts`(관리자 전용)에도 동일하게 있다.

승인 지시를 받으면 `POST /api/journal-drafts/{id}/approve`와 동일한 절차를 밟는다: draft +
draft_lines를 조회해 다음 journal_no로 채번한 뒤 `journals`/`journal_lines`에 그대로 insert하고,
draft를 `status='approved'`+`approved_journal_id`로 갱신한다(수기 전표 발행 때와 같은
채번·롤백 패턴). 반려 지시를 받으면 `status='rejected'`+사유로 갱신한다.

새 직원에게 접근 권한을 발급/차단하는 건 `/staff-access`(관리자 전용) 화면에서 처리한다 —
AI용 DB 키(Postgres role)와 웹 로그인을 함께 발급하고, `staff_access` 테이블에 프로젝트
스코프가 기록된다. 직원용 AI 에이전트 키트는 `D:\dev\erp-ai-agent\`(별도 repo)에 있다.

# 프로젝트 간 메시지

세션 시작 시 `D:\dev\_shared\inbox\erp\` 를 확인한다. 처리한 메시지는 `D:\dev\_shared\inbox\_archive\erp\` 로 옮긴다.
다른 프로젝트에 보낼 때는 `D:\dev\_shared\inbox\<수신처>\from-erp__<YYMMDD>-<주제>.md` 로 작성한다.
규칙은 `D:\dev\_shared\inbox\README.md` 참조.
