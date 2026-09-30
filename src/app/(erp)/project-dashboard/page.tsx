import { createAdminClient } from '@/lib/supabase/admin'
import { getProjectDashboardData } from '@/lib/reports/projectDashboard'
import Link from 'next/link'
import ProjectPicker from './ProjectPicker'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function ProjectDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; month?: string }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const { data: projects } = await (supabase as any)
    .from('projects').select('id, code').eq('is_active', true).order('code')
  const projectList = projects ?? []
  const projectId = params.project_id && projectList.some((p: any) => p.id === params.project_id)
    ? params.project_id
    : projectList[0]?.id

  if (!projectId) {
    return (
      <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
        활성 프로젝트가 없습니다.
      </div>
    )
  }

  const project = projectList.find((p: any) => p.id === projectId)
  const d = await getProjectDashboardData(supabase, projectId, params.month)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">{project?.code ?? ''} 잔액/손익</h2>
          <div className="flex items-center gap-1.5 mt-1">
            <Link
              href={`/project-dashboard?project_id=${projectId}&month=${d.prevMonth}`}
              className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
            >◀</Link>
            <span className="text-sm text-gray-700 font-medium tabular-nums w-16 text-center">{d.monthKey}</span>
            {d.isCurrentMonth ? (
              <span className="px-2 py-0.5 text-sm text-gray-300">▶</span>
            ) : (
              <Link
                href={`/project-dashboard?project_id=${projectId}&month=${d.nextMonth}`}
                className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
              >▶</Link>
            )}
            <span className="text-xs text-gray-400 ml-1">잔액은 {d.asOfDate} 기준</span>
          </div>
        </div>
        <ProjectPicker projects={projectList} value={projectId} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link
          href={`/project-dashboard/ledger?project_id=${projectId}&type=revenue&month=${d.monthKey}`}
          className="border rounded-lg p-4 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs text-gray-500 mb-1">{d.monthKey} 매출 (부가세 포함)</div>
          <div className="text-xl font-bold tabular-nums">{fmt(d.revenueGross)}</div>
          <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
            (순매출 {fmt(d.revenue)} / 부가세 {fmt(d.vat)})
          </div>
        </Link>
        <Link
          href={`/project-dashboard/ledger?project_id=${projectId}&type=expense&month=${d.monthKey}`}
          className="border rounded-lg p-4 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs text-gray-500 mb-1">{d.monthKey} 비용 (부가세 포함)</div>
          <div className="text-xl font-bold tabular-nums">{fmt(d.opexGross)}</div>
          <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
            (순비용 {fmt(d.opex)} / 부가세 {fmt(d.vatInput)})
          </div>
        </Link>
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-xs text-gray-500 mb-1">가용잔액 (운영 가능 자금, {d.asOfDate} 기준)</div>
        <div className={`text-2xl font-bold tabular-nums ${d.availableBalance < 0 ? 'text-red-600' : ''}`}>{fmt(d.availableBalance)}</div>
        <div className="text-xs text-gray-400 mt-1 tabular-nums">
          보통예금+현금 {fmt(d.bankTotal + d.cashTotal)} − 부가세 {fmt(d.vatPayable)} − 대표자 관련 순채무 {fmt(d.founderPayable)} − 미지급금(매입) {fmt(d.apPayable)}
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-xs text-gray-500 mb-1">예정잔고 (가용잔액 + 미수금 예정입금, {d.asOfDate} 기준)</div>
        <div className={`text-2xl font-bold tabular-nums ${d.projectedBalance < 0 ? 'text-red-600' : ''}`}>{fmt(d.projectedBalance)}</div>
        <div className="text-xs text-gray-400 mt-1 tabular-nums">
          가용잔액 {fmt(d.availableBalance)} + 미수금(신용카드/무통장입금/PG) {fmt(d.receivablesTotal)}
        </div>
      </div>

      {d.payoutForecast && (
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-1">예상 가용잔액 (대관료·강사료 지급예정 반영, 추정치)</div>
          <div className={`text-2xl font-bold tabular-nums ${d.payoutForecast.expectedAvailable < 0 ? 'text-red-600' : ''}`}>{fmt(d.payoutForecast.expectedAvailable)}</div>
          <div className="text-xs text-gray-400 mt-1 tabular-nums">
            가용잔액 {fmt(d.availableBalance)} − 대관료 예정 {fmt(d.payoutForecast.venueTotal)} + 대관료 부가세 환입 {fmt(d.payoutForecast.venueVat)} − 강사료 예정 {fmt(d.payoutForecast.instructorTotal)}
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="text-left px-3 py-2">통장</th><th className="text-right px-3 py-2">잔고</th></tr>
          </thead>
          <tbody className="divide-y">
            {Object.entries(d.bankBalance).map(([name, bal]) => (
              <tr key={name}>
                <td className="px-3 py-2">{name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(bal)}</td>
              </tr>
            ))}
            {Object.keys(d.bankBalance).length === 0 && (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="text-left px-3 py-2">미결잔액 계정</th><th className="text-right px-3 py-2">잔액</th></tr>
          </thead>
          <tbody className="divide-y">
            {d.balanceRows.map(r => (
              <tr key={r.name}>
                <td className="px-3 py-2">{r.name}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.balance < 0 ? 'text-red-600' : ''}`}>{fmt(r.balance)}</td>
              </tr>
            ))}
            {d.balanceRows.length === 0 && (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">미결 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
