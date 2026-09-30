<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 수기 전표 발행

사용자가 자연어로 입출금·카드결제 내역을 주고 "전표 발행해줘"라고 하면(코드 작업이 아니라
DB에 직접 전표를 쓰는 작업), **`erp` MCP 서버를 쓴다** — `_tmp_*.mjs` 스크립트를 새로 짜지
않는다(`src/mcp/README.md` 참조). 순서:

1. `erp_search_journals` — 같은 거래처·비슷한 적요를 과거에 어떤 계정으로 찍었는지 먼저
   찾는다. 임의로 새 패턴을 만들지 않는다.
2. `erp_conventions` — 계정 선택이 헷갈리면 목차를 보고 해당 절만 가져온다. 양석환
   개인자금/우미사업비/하나카드가 얽힌 사업비 정산은 계정을 잘못 고르기 쉬우니 반드시 확인.
   (`docs/manual-posting-conventions.md`를 통째로 읽지 말 것 — 19,000자다.)
3. `erp_preview_journal` — 표를 만들어 **사용자에게 보여주고 확인받는다**. 차대·계정·중복
   검증은 서버가 하므로 직접 계산하지 않는다. `classification`/`activity_type`/
   `activity_subtype`은 서버가 계정 정상측에서 도출하니 채우지 않는다.
4. 확인받은 뒤 `erp_commit_journal`(확정 발행) 또는 `erp_create_draft`(승인 대기열).
5. 통장 라인이 있으면 `erp_balance(account:"보통예금", group_by:"counterparty")`로 실제 은행
   잔액과 대조한다. 여러 장 작업했으면 `erp_integrity_check`로 마무리.

MCP가 못 하는 작업(스키마 변경, 대량 데이터 보정 등)만 스크립트로 처리하고, 그때도 루트에
`_tmp_*.mjs`로 만들어 실행 후 반드시 삭제한다.

# 직원 AI 전표 대기열 승인

사용자가 "대기열 확인해줘"/"NADIA 상신 뭐 있어?" 같은 요청을 하면 `erp_drafts` 툴로 조회해서
보여준다(직원용 DB 키가 여기까지만 쓸 수 있고,
`journals`/`journal_lines`엔 직접 못 쓴다 — `supabase/migrations/026_staff_access_and_drafts.sql`
참조). 웹 화면은 `/journal-drafts`(관리자 전용)에도 동일하게 있다.

승인/반려 지시를 받으면 `erp_review_draft(draft_id, action:"approve"|"reject", reason?)`를 쓴다 —
`POST /api/journal-drafts/{id}/approve`와 동일한 절차(채번·롤백·activity_type 검증)를 서버가
밟는다. 조회는 `erp_drafts`.

새 직원에게 접근 권한을 발급/차단하는 건 `/staff-access`(관리자 전용) 화면에서 처리한다 —
AI용 DB 키(Postgres role)와 웹 로그인을 함께 발급하고, `staff_access` 테이블에 프로젝트
스코프가 기록된다. 직원용 AI 에이전트 키트는 `D:\dev\erp-ai-agent\`(별도 repo)에 있다.

# 프로젝트 간 메시지

세션 시작 시 `D:\dev\_shared\inbox\erp\` 를 확인한다. 처리한 메시지는 `D:\dev\_shared\inbox\_archive\erp\` 로 옮긴다.
다른 프로젝트에 보낼 때는 `D:\dev\_shared\inbox\<수신처>\from-erp__<YYMMDD>-<주제>.md` 로 작성한다.
규칙은 `D:\dev\_shared\inbox\README.md` 참조.
