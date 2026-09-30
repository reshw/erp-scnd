# ERP MCP 서버

이 ERP의 장부를 AI가 직접 조회·발행할 수 있게 하는 로컬 MCP(Model Context Protocol) 서버.

## MCP가 뭘 바꾸나 (솔직한 버전)

"MCP를 쓰면 평소엔 0토큰"이라는 설명이 흔한데 **정확하지 않다**. 툴 이름·설명·파라미터
스키마는 대화 내내 상주한다. 실측치:

| | 크기 | 주입 방식 |
|---|---|---|
| MCP 툴 정의 13개 | 8,854자 | 상주 (매 대화) |
| `docs/manual-posting-conventions.md` | 19,244자 | 기존: 전표 작업마다 통째로 읽음 |
| `docs/decisions.md` | 46,652자 | 기존: grep해서 부분적으로 |

진짜 이득은 "0토큰"이 아니라 **누가 무엇을 언제 가져오느냐가 바뀌는 것**이다.

1. **지식 66,000자가 push → pull로 이동한다.** `erp_conventions`를 topic 없이 부르면
   목차 1,100자만 오고, 필요한 절만 900자쯤 추가로 가져온다. 예전엔 "가수금이 맞나?"를
   확인하려고 19,244자를 통째로 읽었다.
2. **정적 문서가 라이브 DB로 바뀐다.** "과거에 이 거래처를 어떻게 찍었나"는 문서에
   적힌 규칙이 아니라 `erp_search_journals`가 실제 전표에서 찾아온다.
3. **스크립트 왕복이 사라진다.** 예전엔 `_tmp_xxx.mjs`를 작성 → 실행 → 결과 읽기 →
   삭제까지 4턴이 걸렸고, 그 스크립트 코드 자체가 매번 컨텍스트를 먹었다.
4. **검증이 코드가 아니라 서버에 산다.** 차대 일치, 원 단위 정수, `activity_type` CHECK
   제약, 중복 발행 탐지가 AI의 기억력이 아니라 서버 코드에 있다.

## 실행

```bash
npm run mcp:server        # 수동 실행(디버깅용). 보통은 Claude Code가 알아서 띄운다
```

Node 22+ 의 타입 스트리핑으로 `.ts`를 그대로 실행하므로 tsx/ts-node가 필요 없다.
접속 정보는 저장소 루트 `.env.local`에서 읽는다(`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SECRET_KEY`). 등록은 루트 `.mcp.json`.

## 툴

### 조회 — 쓰기 전에 근거를 모으는 쪽

| 툴 | 용도 |
|---|---|
| `erp_master` | 계정과목/프로젝트/거래처 마스터. 계정명·프로젝트 코드가 UNIQUE라 UUID를 내보내지 않는다 |
| `erp_search_journals` | 과거 전표 검색(적요·계정·거래처·금액·기간·전표번호). **발행 전 거의 항상 먼저** |
| `erp_balance` | 계정별/거래처별/프로젝트별 차대합계·잔액. 통장 잔액 대조의 기본 도구 |
| `erp_integrity_check` | 차대 불균형 전표/프로젝트 (정상이면 0건) |
| `erp_conventions` | 발행 관행·결정 기록을 **목차 → 본문** 순으로 |
| `erp_available_cashflow` | 가용잔액/예정잔고 — 웹 화면과 같은 계산 코드 |
| `erp_monthly_pnl` | 월 손익. 잔액성 subtype 제외 규칙이 강제됨 |

### 발행 — 토큰 게이트

```
erp_preview_journal  →  검증 통과 시에만 preview_token 발급
      ├─ erp_create_draft(token)     대기열 상신 → 관리자 승인 필요
      └─ erp_commit_journal(token)   확정 장부에 즉시 발행/정정
```

`erp_preview_journal`이 하는 일:

- 계정명 → 계정 확정 (모호하면 후보를 던져 되묻게 함)
- `classification` / `activity_type` / `activity_subtype`을 **계정의 정상측에서 서버가 도출**
  — AI가 직접 채우게 했다가 `activity_type` 자리에 subtype 값이 들어가 승인이 DB CHECK
  제약으로 거부된 실사고가 있었다(2026-08-23)
- 차대 일치 / 원 단위 정수 / 금액 0 검사
- 거래처가 마스터에 없으면 과거 유사 표기를 경고로 붙임(오타로 새 표기가 생기는 걸 방지)
- **같은 날짜·같은 총액의 기존 전표가 있으면 중복 경고** (2026-08-19 중복발행 실사고)

토큰은 확정된 payload를 그대로 들고 있어서, 커밋 단계에서 AI가 계정이나 금액을 다시
해석할 여지가 없다. 사용자가 확인한 표와 DB에 들어가는 값이 같음이 구조적으로 보장된다.
유효기간 30분, 서버 프로세스 재시작 시 소멸.

나머지: `erp_drafts`(대기열 조회), `erp_review_draft`(승인/반려), `erp_cancel_journal`(취소 처리).

## 왜 확정 장부 직접 쓰기를 남겼나

최초 설계안은 "확정 장부 직접 쓰기 툴은 절대 제공하지 않고 전부 대기열 경유"였다.
그 원칙은 **직원용 배포에서는 옳지만 관리자용인 이 서버에는 맞지 않다**:

- 이 서버는 관리자 머신에서 service role 키로 돈다. 툴을 안 만들어도 그 키로는 뭐든 할 수
  있으므로, 툴을 빼는 건 **경계(boundary)가 아니라 관례**다.
- 관리자 본인이 승인자다. 본인이 상신하고 본인이 승인하는 큐는 통제가 아니라 의식이고,
  전표 한 장마다 브라우저를 여는 비용만 남는다.
- 직원에 대한 진짜 경계는 이미 `026_staff_access_and_drafts.sql`이 Postgres 권한으로
  강제한다 — 그 role엔 `journals` INSERT 권한이 아예 없어서 AI가 뭘 시도하든 DB가 거부한다.

그래서 통제 지점을 **preview → 사용자 확인 → commit** 게이트로 옮겼고, 대기열 경로는
승인 흔적을 남기고 싶을 때 쓰도록 함께 제공한다.

`ERP_MCP_MODE=staff`로 띄우면 확정 장부 쓰기와 승인 툴이 등록되지 않는다. 다만 이건
편의 스위치일 뿐 보안 경계가 아니다 — 실제 직원 배포는 스코프 role로 접속해야 한다
(`D:\dev\erp-ai-agent`, 별도 repo).

## Resources

`erp://chart-of-accounts`, `erp://conventions/{project_id}`, `erp://balances/{project_id}/dashboard`.

주의: Claude Code에서 Resource는 툴과 달리 모델이 스스로 가져오지 못하고 사용자가 `@`로
붙여야 읽힌다. 그래서 추론 중 필요한 지식은 전부 툴로도 노출해 뒀고, Resource는 사람이
대화에 통째로 첨부하고 싶을 때의 보조 창구다.

## 구조

```
src/mcp/
  server.ts          진입점 — stdio 트랜스포트, 모드별 툴 등록
  db.ts              Supabase 클라이언트 · 계정/프로젝트/거래처 해석 · 페이징 · 포맷
  preview.ts         검증 + 미리보기 토큰 (모든 쓰기의 유일한 관문)
  journalWrite.ts    확정 장부 insert (채번 재시도 + 롤백)
  resources.ts       읽기 전용 Resource 3종
  tools/query.ts     조회 툴
  tools/drafts.ts    대기열 상신·조회·승인/반려
  tools/journals.ts  확정 발행·정정·취소
  tools/reports.ts   가용잔액·월손익 (src/lib/reports/projectDashboard.ts 재사용)
```

잔액/손익 계산은 여기서 새로 짜지 않고 웹 화면과 같은 코드를 호출한다 — 화면과 AI가
다른 숫자를 말하는 순간 둘 다 못 믿게 된다.
