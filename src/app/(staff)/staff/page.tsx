import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import { getProjectDashboardData } from '@/lib/reports/projectDashboard'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

function sfmt(n: number) {
  return `${n > 0 ? '+' : ''}${fmt(n)}`
}

export default async function StaffDashboard({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const scope = await getScope()
  if (scope.role !== 'employee') return null
  const projectId = scope.allowedProjectId
  const supabase = createAdminClient()

  const { data: project } = await (supabase as any).from('projects').select('code').eq('id', projectId).single()
  const { month: requestedMonth } = await searchParams
  const d = await getProjectDashboardData(supabase, projectId, requestedMonth)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{project?.code ?? ''} 잔액/손익</h2>
        <div className="flex items-center gap-1.5 mt-1">
          <Link
            href={`/staff?month=${d.prevMonth}`}
            className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
          >◀</Link>
          <span className="text-sm text-gray-700 font-medium tabular-nums w-16 text-center">{d.monthKey}</span>
          {d.isCurrentMonth ? (
            <span className="px-2 py-0.5 text-sm text-gray-300">▶</span>
          ) : (
            <Link
              href={`/staff?month=${d.nextMonth}`}
              className="px-2 py-0.5 rounded border text-sm text-gray-600 hover:bg-gray-50"
            >▶</Link>
          )}
          <span className="text-xs text-gray-400 ml-1">잔액은 {d.asOfDate} 기준</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link
          href={`/staff/ledger?type=revenue&month=${d.monthKey}`}
          className="border rounded-lg p-4 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs text-gray-500 mb-1">{d.monthKey} 매출 (부가세 포함)</div>
          <div className="text-xl font-bold tabular-nums">{fmt(d.revenueGross)}</div>
          <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
            (순매출 {fmt(d.revenue)} / 부가세 {fmt(d.vat)})
          </div>
        </Link>
        <Link
          href={`/staff/ledger?type=expense&month=${d.monthKey}`}
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
        <div className="text-xs text-gray-500 mb-1">{d.monthKey} 영업이익 (순매출 − 순비용, 전표 기준{d.isCurrentMonth ? ', 진행 중' : ''})</div>
        <div className={`text-2xl font-bold tabular-nums ${d.operatingProfit < 0 ? 'text-red-600' : ''}`}>{fmt(d.operatingProfit)}</div>
        <div className="text-xs text-gray-400 mt-1 tabular-nums">
          순매출 {fmt(d.revenue)} − 순비용 {fmt(d.opex)}
        </div>
        {d.payoutForecast && (
          <div className={`text-xs mt-1 tabular-nums ${d.payoutForecast.expectedProfit < 0 ? 'text-red-600' : 'text-gray-500'}`}>
            예상 영업이익 {fmt(d.payoutForecast.expectedProfit)} <span className="text-gray-400">(이번 달 대관료·강사료 예정분 반영, 추정)</span>
          </div>
        )}
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
        {d.projectedDelta !== null && d.prevProjectedBalance !== null && (
          <div className={`text-xs mt-1 tabular-nums ${d.projectedDelta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
            전월말({d.prevMonth}) 예정잔고 {fmt(d.prevProjectedBalance)} 대비 {sfmt(d.projectedDelta)}
            {!d.isCurrentMonth && ' (= 영업이익)'}
          </div>
        )}
      </div>

      {d.payoutForecast && (
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-xs text-gray-500 mb-1">예상 가용잔액 (대관료·강사료 지급예정 반영, 추정치)</div>
          <div className={`text-2xl font-bold tabular-nums ${d.payoutForecast.expectedAvailable < 0 ? 'text-red-600' : ''}`}>{fmt(d.payoutForecast.expectedAvailable)}</div>
          <div className="text-xs text-gray-400 mt-1 tabular-nums">
            가용잔액 {fmt(d.availableBalance)} − 대관료 예정 {fmt(d.payoutForecast.venueTotal)} + 대관료 부가세 환입 {fmt(d.payoutForecast.venueVat)} − 강사료 예정 {fmt(d.payoutForecast.instructorTotal)}
          </div>
          <div className="mt-3 pt-3 border-t">
            <div className="text-xs text-gray-500 mb-1">예상 예정잔고 (예상 가용잔액 + 미수금)</div>
            <div className={`text-2xl font-bold tabular-nums ${d.payoutForecast.expectedProjected < 0 ? 'text-red-600' : ''}`}>{fmt(d.payoutForecast.expectedProjected)}</div>
            {d.payoutForecast.expectedDelta !== null && d.payoutForecast.prevAdjustedProjected !== null && (
              <div className={`text-xs mt-1 tabular-nums ${d.payoutForecast.expectedDelta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                전월말({d.prevMonth}) 예정잔고 {fmt(d.payoutForecast.prevAdjustedProjected)}(지난달 강사료 발생분 반영) 대비 {sfmt(d.payoutForecast.expectedDelta)} = 이번 달 예상 영업이익
              </div>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">아직 전표가 없는 이번 달(및 미발행 지난달) 분을 timetable 산정값으로 미리 뺀 값입니다.</div>
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
