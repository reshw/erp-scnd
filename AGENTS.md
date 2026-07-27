<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 수기 전표 발행

사용자가 자연어로 입출금·카드결제 내역을 주고 "전표 발행해줘"라고 하면(코드 작업이 아니라
DB에 직접 전표를 쓰는 작업), 계정 선택 전에 반드시 `docs/manual-posting-conventions.md`를
먼저 읽는다. 특히 양석환 개인자금/우미사업비/하나카드가 얽힌 사업비 정산 케이스는 계정을
잘못 고르기 쉽다.

# 프로젝트 간 메시지

세션 시작 시 `D:\dev\_shared\inbox\erp\` 를 확인한다. 처리한 메시지는 `D:\dev\_shared\inbox\_archive\erp\` 로 옮긴다.
다른 프로젝트에 보낼 때는 `D:\dev\_shared\inbox\<수신처>\from-erp__<YYMMDD>-<주제>.md` 로 작성한다.
규칙은 `D:\dev\_shared\inbox\README.md` 참조.
