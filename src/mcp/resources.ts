/**
 * 읽기 전용 Resource.
 *
 * 주의: Claude Code에서 MCP Resource는 툴처럼 모델이 스스로 가져오지 못하고 사용자가
 * `@`로 붙여야 읽힌다. 그래서 "추론 중에 필요한 지식"은 전부 Tool로도 노출해 두었고
 * (erp_master / erp_conventions / erp_available_cashflow), Resource는 사람이 대화에
 * 통째로 첨부하고 싶을 때를 위한 보조 창구로 둔다. 같은 함수를 공유하므로 값은 항상 같다.
 */
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { supabase, getAccounts, resolveProject } from './db.ts'
import { collectDocs } from './tools/query.ts'
import { getProjectDashboardData } from '../lib/reports/projectDashboard.ts'

export function registerResources(server: any) {
  server.registerResource(
    'chart-of-accounts',
    'erp://chart-of-accounts',
    {
      title: '계정과목표',
      description: '전체 계정과목 — id/이름/활동유형/정상측/증감 라벨. 라인의 classification은 여기서 도출된다.',
      mimeType: 'application/json',
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            (await getAccounts()).map((a) => ({
              account_id: a.id,
              name: a.name,
              activity_type: a.activity_type,
              normal_side: a.normal_side,
              increase_label: a.increase_label,
              decrease_label: a.decrease_label,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  )

  server.registerResource(
    'posting-conventions',
    new ResourceTemplate('erp://conventions/{project_id}', { list: undefined }),
    {
      title: '전표 발행 관행',
      description:
        '프로젝트별 회계 관행(posting_conventions 테이블) + 저장소의 수기 전표 관행 문서. project_id 자리엔 프로젝트 코드(NADIA 등)도 쓸 수 있다.',
      mimeType: 'text/markdown',
    },
    async (uri: URL, { project_id }: { project_id: string }) => {
      const p = await resolveProject(Array.isArray(project_id) ? project_id[0] : project_id)
      const { data } = await supabase
        .from('posting_conventions')
        .select('topic, body')
        .eq('project_id', p.id)
        .order('topic')
      const dbPart = (data ?? []).map((r: any) => `## ${r.topic}\n\n${r.body}`).join('\n\n')
      const docPart = (await collectDocs('posting')).map((d) => d.body).join('\n\n')
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: `# ${p.code} 전표 발행 관행\n\n${dbPart || '(DB에 등록된 프로젝트 관행 없음)'}\n\n---\n\n# 공통 수기 전표 관행\n\n${docPart}`,
          },
        ],
      }
    },
  )

  server.registerResource(
    'project-dashboard',
    new ResourceTemplate('erp://balances/{project_id}/dashboard', { list: undefined }),
    {
      title: '가용잔액/예정잔고 스냅샷',
      description: 'ERP 웹의 잔액/손익 화면과 동일한 계산 결과(JSON).',
      mimeType: 'application/json',
    },
    async (uri: URL, { project_id }: { project_id: string }) => {
      const p = await resolveProject(Array.isArray(project_id) ? project_id[0] : project_id)
      const d = await getProjectDashboardData(supabase, p.id)
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ project: p.code, ...d }, null, 2) },
        ],
      }
    },
  )
}
