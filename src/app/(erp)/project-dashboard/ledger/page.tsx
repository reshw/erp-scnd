import { createAdminClient } from '@/lib/supabase/admin'
import { getProjectLedgerData } from '@/lib/reports/projectDashboard'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function ProjectDashboardLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; type?: string; month?: string }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  if (!params.project_id) {
    return (
      <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
        프로젝트가 지정되지 않았습니다.
      </div>
    )
  }

  const { data: project } = await (supabase as any)
    .from('projects').select('code').eq('id', params.project_id).single()

  const type = params.type === 'expense' ? 'expense' : 'revenue'
  const d = await getProjectLedgerData(supabase, params.project_id, type, params.month)
  const title = type === 'revenue' ? '매출' : '비용'

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/project-dashboard?project_id=${params.project_id}&month=${d.monthKey}`} className="text-sm text-gray-500 hover:text-black">← 잔액/손익으로</Link>
        <h2 className="text-xl font-bold mt-1">{project?.code ?? ''} {d.monthKey} {title} 내역</h2>
        <div className="flex items-center gap-1.5 mt-1">
          <Link
            href={`/project-dashboard/ledger?project_id=${params.project_id}&type=${type}&month=${d.prevMonth}`}
            className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
          >◀</Link>
          <span className="text-sm text-gray-700 font-medium tabular-nums w-16 text-center">{d.monthKey}</span>
          {d.isCurrentMonth ? (
            <span className="px-2 py-0.5 text-sm text-gray-300">▶</span>
          ) : (
            <Link
              href={`/project-dashboard/ledger?project_id=${params.project_id}&type=${type}&month=${d.nextMonth}`}
              className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
            >▶</Link>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-xs text-gray-500 mb-1">{d.monthKey} {title} 합계 (부가세 포함)</div>
        <div className="text-xl font-bold tabular-nums">{fmt(d.totalGross)}</div>
        <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
          (공급가액 {fmt(d.totalNet)} / 부가세 {fmt(d.totalVat)})
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">날짜</th>
              <th className="text-left px-3 py-2">계정</th>
              <th className="text-left px-3 py-2">내역</th>
              <th className="text-right px-3 py-2">공급가액</th>
              <th className="text-right px-3 py-2">부가세</th>
              <th className="text-right px-3 py-2">합계</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.rows.map(r => (
              <tr key={r.journalId}>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.date}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.account}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.net < 0 ? 'text-red-600' : ''}`}>{fmt(r.net)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmt(r.vat)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.gross < 0 ? 'text-red-600' : ''}`}>{fmt(r.gross)}</td>
              </tr>
            ))}
            {d.rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">내역 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
