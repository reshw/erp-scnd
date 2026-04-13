import { createAdminClient } from '@/lib/supabase/admin'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

const ACTIVITY_TYPES = ['현금', '영업', '재무', '투자', '개인', '세무']

const ACTIVITY_COLOR: Record<string, string> = {
  현금: 'bg-blue-50 text-blue-700',
  영업: 'bg-green-50 text-green-700',
  재무: 'bg-purple-50 text-purple-700',
  투자: 'bg-orange-50 text-orange-700',
  개인: 'bg-gray-50 text-gray-700',
  세무: 'bg-red-50 text-red-700',
}

type CashflowRow = {
  month: string
  project_id: string | null
  activity_type: string
  activity_subtype: string
  total_debit: number
  total_credit: number
}

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; year?: string }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const year = params.year ?? new Date().getFullYear().toString()

  // 프로젝트 목록
  const { data: projects } = await (supabase as any)
    .from('projects')
    .select('id, code')
    .order('code') as { data: Array<{ id: string; code: string }> | null }

  // monthly_cashflow 조회
  let query = (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, activity_subtype, total_debit, total_credit')
    .gte('month', `${year}-01-01`)
    .lte('month', `${year}-12-31`)
    .order('month')

  if (params.project) {
    const proj = (projects ?? []).find(p => p.code === params.project)
    if (proj) query = query.eq('project_id', proj.id)
  }

  const { data: rawRows } = await query as { data: CashflowRow[] | null }
  const rows = rawRows ?? []

  // 월 목록 추출
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    return `${year}-${m}-01`
  })

  // 집계: month × activity_type → { debit, credit }
  const agg: Record<string, Record<string, { debit: number; credit: number }>> = {}
  for (const r of rows) {
    const monthKey = r.month.slice(0, 7) // YYYY-MM
    if (!agg[monthKey]) agg[monthKey] = {}
    if (!agg[monthKey][r.activity_type]) agg[monthKey][r.activity_type] = { debit: 0, credit: 0 }
    agg[monthKey][r.activity_type].debit  += Number(r.total_debit)  ?? 0
    agg[monthKey][r.activity_type].credit += Number(r.total_credit) ?? 0
  }

  // 월별 순계 (debit - credit)
  const monthNetByType = (monthKey: string, type: string) => {
    const d = agg[monthKey]?.[type]
    if (!d) return 0
    return d.debit - d.credit
  }

  // 활동구분별 연간 합계
  const annualByType = (type: string) => {
    return months.reduce((sum, m) => sum + monthNetByType(m.slice(0, 7), type), 0)
  }

  const currentMonth = new Date().toISOString().slice(0, 7)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">월말마감 보고서</h2>
      </div>

      {/* 필터 */}
      <form className="flex gap-2 flex-wrap items-center">
        <select name="year" defaultValue={year} className="border rounded px-2 py-1 text-sm">
          {[2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select name="project" defaultValue={params.project ?? ''} className="border rounded px-2 py-1 text-sm">
          <option value="">전체 프로젝트</option>
          {(projects ?? []).map(p => (
            <option key={p.id} value={p.code}>{p.code}</option>
          ))}
        </select>
        <button type="submit" className="border rounded px-3 py-1 text-sm bg-white hover:bg-gray-50">조회</button>
      </form>

      {/* 월별 × 활동구분 집계표 */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">활동구분</th>
              {months.map(m => {
                const mk = m.slice(0, 7)
                const isCurrent = mk === currentMonth
                return (
                  <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${isCurrent ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                    {mk.slice(5)}월
                  </th>
                )
              })}
              <th className="text-right px-3 py-2 font-medium text-gray-700 w-32 bg-gray-100">연간 합계</th>
            </tr>
          </thead>
          <tbody>
            {ACTIVITY_TYPES.map(type => {
              const annual = annualByType(type)
              const hasData = months.some(m => monthNetByType(m.slice(0, 7), type) !== 0)
              return (
                <tr key={type} className={`border-b hover:bg-gray-50 ${!hasData ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTIVITY_COLOR[type] ?? ''}`}>
                      {type}
                    </span>
                  </td>
                  {months.map(m => {
                    const mk = m.slice(0, 7)
                    const net = monthNetByType(mk, type)
                    const isCurrent = mk === currentMonth
                    return (
                      <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${net < 0 ? 'text-red-600' : net > 0 ? '' : 'text-gray-300'}`}>
                        {net !== 0 ? fmt(net) : '-'}
                      </td>
                    )
                  })}
                  <td className={`text-right px-3 py-2 tabular-nums font-medium bg-gray-50 ${annual < 0 ? 'text-red-600' : annual > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                    {annual !== 0 ? fmt(annual) : '-'}
                  </td>
                </tr>
              )
            })}

            {/* 합계 행 */}
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="px-3 py-2 text-sm">합계</td>
              {months.map(m => {
                const mk = m.slice(0, 7)
                const total = ACTIVITY_TYPES.reduce((s, t) => s + monthNetByType(mk, t), 0)
                const isCurrent = mk === currentMonth
                return (
                  <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-100' : ''} ${total < 0 ? 'text-red-600' : ''}`}>
                    {total !== 0 ? fmt(total) : '-'}
                  </td>
                )
              })}
              <td className={`text-right px-3 py-2 tabular-nums bg-gray-200 ${ACTIVITY_TYPES.reduce((s, t) => s + annualByType(t), 0) < 0 ? 'text-red-600' : ''}`}>
                {fmt(ACTIVITY_TYPES.reduce((s, t) => s + annualByType(t), 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 활동구분별 상세 집계 */}
      <div className="space-y-6 mt-6">
        {ACTIVITY_TYPES.map(type => {
          const subtypes = Array.from(new Set(rows.filter(r => r.activity_type === type).map(r => r.activity_subtype)))
          if (subtypes.length === 0) return null

          return (
            <div key={type}>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${ACTIVITY_COLOR[type] ?? ''}`}>{type}</span>
                유형별 상세
              </h3>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">유형</th>
                      {months.map(m => {
                        const mk = m.slice(0, 7)
                        const isCurrent = mk === currentMonth
                        return (
                          <th key={mk} className={`text-right px-3 py-2 font-medium w-24 ${isCurrent ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                            {mk.slice(5)}월
                          </th>
                        )
                      })}
                      <th className="text-right px-3 py-2 font-medium text-gray-700 w-28 bg-gray-100">연간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subtypes.map(subtype => {
                      // subtype별로 차변, 대변 합산
                      const subtypeAgg: Record<string, { debit: number; credit: number }> = {}
                      for (const r of rows.filter(r => r.activity_type === type && r.activity_subtype === subtype)) {
                        const mk = r.month.slice(0, 7)
                        if (!subtypeAgg[mk]) subtypeAgg[mk] = { debit: 0, credit: 0 }
                        subtypeAgg[mk].debit  += Number(r.total_debit)  ?? 0
                        subtypeAgg[mk].credit += Number(r.total_credit) ?? 0
                      }
                      const annualNet = Object.values(subtypeAgg).reduce((s, v) => s + v.debit - v.credit, 0)
                      return (
                        <tr key={subtype} className="border-b hover:bg-gray-50">
                          <td className="px-3 py-2 text-xs text-gray-600">{subtype}</td>
                          {months.map(m => {
                            const mk = m.slice(0, 7)
                            const v = subtypeAgg[mk]
                            const net = v ? v.debit - v.credit : 0
                            const isCurrent = mk === currentMonth
                            return (
                              <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${net < 0 ? 'text-red-500' : net === 0 ? 'text-gray-300' : ''}`}>
                                {net !== 0 ? fmt(net) : '-'}
                              </td>
                            )
                          })}
                          <td className={`text-right px-3 py-2 tabular-nums font-medium bg-gray-50 ${annualNet < 0 ? 'text-red-500' : annualNet === 0 ? 'text-gray-300' : ''}`}>
                            {annualNet !== 0 ? fmt(annualNet) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
