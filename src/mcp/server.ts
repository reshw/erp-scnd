/**
 * ERP MCP 서버 (stdio).
 *
 * 실행: node src/mcp/server.ts   (Node 22+ 타입 스트리핑, 별도 트랜스파일러 불필요)
 * 등록: 저장소 루트 .mcp.json 참고.
 *
 * 모드 (ERP_MCP_MODE):
 *   admin (기본) — 전체 툴. 관리자 머신에서 service role 키로 돈다.
 *   staff        — 확정 장부 쓰기(erp_commit_journal/erp_cancel_journal)와 승인
 *                  (erp_review_draft)을 등록하지 않는다. 다만 이건 어디까지나 관례일 뿐
 *                  경계가 아니다 — 실제 직원 배포는 026 마이그레이션의 프로젝트 스코프
 *                  Postgres role로 접속해서 DB가 권한을 강제해야 한다.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerResources } from './resources.ts'
import { queryTools } from './tools/query.ts'
import { previewTool } from './preview.ts'
import { draftTools, reviewDraftTool } from './tools/drafts.ts'
import { journalWriteTools } from './tools/journals.ts'
import { reportTools } from './tools/reports.ts'

const MODE = process.env.ERP_MCP_MODE === 'staff' ? 'staff' : 'admin'

interface ToolDef {
  name: string
  config: { description: string; inputSchema: Record<string, unknown> }
  handler: (args: any) => Promise<string>
}

const tools: ToolDef[] = [
  ...queryTools,
  previewTool,
  ...reportTools,
  ...(MODE === 'admin'
    ? [...draftTools, ...journalWriteTools]
    : draftTools.filter((t) => t.name !== reviewDraftTool.name)),
] as ToolDef[]

const server = new McpServer(
  { name: 'erp', version: '1.0.0' },
  {
    instructions:
      '이 서버는 복식부기 ERP 장부를 다룬다. 전표를 만들 때는 항상 (1) erp_search_journals 로 같은 거래처·비슷한 적요의 과거 처리를 먼저 찾고, ' +
      '(2) 계정 선택이 헷갈리면 erp_conventions 로 해당 관행을 확인한 뒤, (3) erp_preview_journal 로 표를 만들어 사용자에게 보여주고 확인받고, ' +
      '(4) 그 토큰으로 erp_create_draft(승인 대기) 또는 erp_commit_journal(확정 발행)을 호출한다. ' +
      'classification/activity_type/activity_subtype 은 서버가 계정 정상측에서 도출하므로 직접 채우지 않는다. ' +
      '통장 라인이 들어간 전표를 쓴 뒤에는 erp_balance 로 거래처별 보통예금 잔액을 실제 은행 잔액과 대조한다.',
  },
)

for (const tool of tools) {
  server.registerTool(tool.name, tool.config as any, async (args: any) => {
    try {
      return { content: [{ type: 'text' as const, text: await tool.handler(args ?? {}) }] }
    } catch (e) {
      // 검증 실패는 모델이 스스로 고쳐 재시도할 수 있게 사람이 읽는 메시지로 돌려준다.
      return { content: [{ type: 'text' as const, text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true }
    }
  })
}

registerResources(server)

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write(`[erp-mcp] mode=${MODE} tools=${tools.length}\n`)
