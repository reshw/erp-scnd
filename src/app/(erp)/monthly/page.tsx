import { createAdminClient } from '@/lib/supabase/admin'

function fmt(n: number) {
  if (n === 0) return '-'
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

function fmtBal(n: number) {
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

type BalanceLedger = Record<string, { opening: number; debit: number; credit: number; closing: number }>

/** 월별 현금 원장 계산 (누적 잔고 포함) */
function buildLedger(
  rows: CashflowRow[],
  projectId?: string | null,  // undefined = 전체, null = 미배정, string = 특정
): BalanceLedger {
  // 월별 입출금 집계
  const byMonth: Record<string, { debit: number; credit: number }> = {}
  for (const r of rows) {
    if (r.activity_type !== '현금') continue
    if (projectId !== undefined) {
      if (projectId === null && r.project_id !== null) continue
      if (projectId !== null && r.project_id !== projectId) continue
    }
    const mk = r.month.slice(0, 7)
    if (!byMonth[mk]) byMonth[mk] = { debit: 0, credit: 0 }
    byMonth[mk].debit  += Number(r.total_debit)
    byMonth[mk].credit += Number(r.total_credit)
  }

  // 시간순 정렬 후 누적 잔고 계산
  const sortedMonths = Object.keys(byMonth).sort()
  let balance = 0
  const ledger: BalanceLedger = {}
  for (const mk of sortedMonths) {
    const { debit, credit } = byMonth[mk]
    ledger[mk] = { opening: balance, debit, credit, closing: balance + debit - credit }
    balance = ledger[mk].closing
  }
  return ledger
}

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; year?: string }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()
  const year = params.year ?? new Date().getFullYear().toString()
  const currentMonth = new Date().toISOString().slice(0, 7)

  // 프로젝트 목록
  const { data: projects } = await (supabase as any)
    .from('projects')
    .select('id, code')
    .order('code') as { data: Array<{ id: string; code: string }> | null }

  const projList = projects ?? []
  const selectedProj = params.project ? projList.find(p => p.code === params.project) : null

  // ── 현금 잔고용: 전 기간 현금 데이터 (연도 필터 없음) ──────────────────
  const { data: cashAllTime } = await (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, total_debit, total_credit')
    .eq('activity_type', '현금')
    .order('month') as { data: CashflowRow[] | null }

  const cashRows = cashAllTime ?? []

  // 전체 현금 원장 (프로젝트 무관 합계)
  const totalLedger = buildLedger(cashRows)

  // 선택된 프로젝트의 현금 원장
  const filteredLedger = selectedProj
    ? buildLedger(cashRows, selectedProj.id)
    : totalLedger

  // 프로젝트별 현금 원장 (프로젝트 필터 없을 때만 표시)
  const projectLedgers: Record<string, { code: string; ledger: BalanceLedger }> = {}
  if (!selectedProj) {
    for (const p of projList) {
      projectLedgers[p.id] = { code: p.code, ledger: buildLedger(cashRows, p.id) }
    }
  }

  // ── 활동구분 집계용: 선택 연도 데이터 ──────────────────────────────────
  let matrixQuery = (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, activity_subtype, total_debit, total_credit')
    .gte('month', `${year}-01-01`)
    .lte('month', `${year}-12-31`)
    .order('month')

  if (selectedProj) matrixQuery = matrixQuery.eq('project_id', selectedProj.id)

  const { data: rawMatrix } = await matrixQuery as { data: CashflowRow[] | null }
  const matrixRows = rawMatrix ?? []

  // 월 목록 (1~12월)
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    return `${year}-${m}`
  })

  // 활동구분별 집계
  const agg: Record<string, Record<string, { debit: number; credit: number }>> = {}
  for (const r of matrixRows) {
    const mk = r.month.slice(0, 7)
    if (!agg[mk]) agg[mk] = {}
    if (!agg[mk][r.activity_type]) agg[mk][r.activity_type] = { debit: 0, credit: 0 }
    agg[mk][r.activity_type].debit  += Number(r.total_debit)
    agg[mk][r.activity_type].credit += Number(r.total_credit)
  }

  const monthNet = (mk: string, type: string) => {
    const d = agg[mk]?.[type]
    return d ? d.debit - d.credit : 0
  }
  const annualNet = (type: string) => months.reduce((s, mk) => s + monthNet(mk, type), 0)

  // ── 현금 잔고 표 헬퍼 ──────────────────────────────────────────────────
  function CashTable({ ledger, label }: { ledger: BalanceLedger; label: string }) {
    const hasAny = months.some(mk => ledger[mk])
    if (!hasAny) return (
      <div className="text-sm text-gray-400 py-4 text-center border rounded-lg">{label} — 데이터 없음</div>
    )

    // 연도 직전까지의 기초잔고 = 해당 연도 첫 달의 opening, 또는 직전 달 closing
    const yearOpeningMonth = months.find(mk => ledger[mk])
    const yearOpening = yearOpeningMonth ? ledger[yearOpeningMonth].opening : 0
    const yearClosing = months.reduceRight<number | null>((acc, mk) => {
      if (acc !== null) return acc
      return ledger[mk] ? ledger[mk].closing : null
    }, null) ?? yearOpening

    return (
      <div>
        <div className="flex gap-6 text-sm mb-3">
          <span className="text-gray-500">{label}</span>
          <span>연초잔고 <strong className="tabular-nums">{fmtBal(yearOpening)}</strong></span>
          <span>연말잔고 <strong className="tabular-nums">{fmtBal(yearClosing)}</strong></span>
          <span className={`${yearClosing - yearOpening >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            순변동 <strong className="tabular-nums">{fmtBal(yearClosing - yearOpening)}</strong>
          </span>
        </div>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">항목</th>
                {months.map(mk => {
                  const isCurrent = mk === currentMonth
                  return (
                    <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${isCurrent ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                      {mk.slice(5)}월
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {/* 기초잔고 */}
              <tr className="border-b bg-gray-50/50">
                <td className="px-3 py-2 text-xs font-medium text-gray-500">기초잔고</td>
                {months.map(mk => {
                  const isCurrent = mk === currentMonth
                  const val = ledger[mk]?.opening ?? null
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} text-gray-600`}>
                      {val !== null ? fmtBal(val) : '-'}
                    </td>
                  )
                })}
              </tr>
              {/* 입금 */}
              <tr className="border-b">
                <td className="px-3 py-2 text-xs font-medium text-blue-600">입금</td>
                {months.map(mk => {
                  const isCurrent = mk === currentMonth
                  const val = ledger[mk]?.debit ?? 0
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${val > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
                      {val > 0 ? fmt(val) : '-'}
                    </td>
                  )
                })}
              </tr>
              {/* 출금 */}
              <tr className="border-b">
                <td className="px-3 py-2 text-xs font-medium text-red-500">출금</td>
                {months.map(mk => {
                  const isCurrent = mk === currentMonth
                  const val = ledger[mk]?.credit ?? 0
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${val > 0 ? 'text-red-500' : 'text-gray-300'}`}>
                      {val > 0 ? fmt(val) : '-'}
                    </td>
                  )
                })}
              </tr>
              {/* 월말잔고 */}
              <tr className="border-b bg-gray-50 font-bold">
                <td className="px-3 py-2 text-xs font-bold">월말잔고</td>
                {months.map(mk => {
                  const isCurrent = mk === currentMonth
                  const val = ledger[mk]?.closing ?? null
                  // 데이터 없는 월은 이전 달 closing 표시
                  const lastKnown = months
                    .filter(m => m <= mk)
                    .reduceRight<number | null>((acc, m) => acc !== null ? acc : (ledger[m]?.closing ?? null), null)
                  const display = val ?? lastKnown
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-100' : ''} ${display !== null && display < 0 ? 'text-red-600' : ''}`}>
                      {display !== null ? fmtBal(display) : '-'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">월말마감 보고서</h2>

      {/* 필터 */}
      <form className="flex gap-2 flex-wrap items-center">
        <select name="year" defaultValue={year} className="border rounded px-2 py-1 text-sm">
          {[2023, 2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select name="project" defaultValue={params.project ?? ''} className="border rounded px-2 py-1 text-sm">
          <option value="">전체 프로젝트</option>
          {projList.map(p => (
            <option key={p.id} value={p.code}>{p.code}</option>
          ))}
        </select>
        <button type="submit" className="border rounded px-3 py-1 text-sm bg-white hover:bg-gray-50">조회</button>
      </form>

      {/* ═══════════════════════════════════════════════════════
          섹션 1: 현금 잔고 추이
      ══════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">현금</span>
          현금 잔고 추이 ({year}년)
        </h3>

        {selectedProj ? (
          <CashTable ledger={filteredLedger} label={selectedProj.code} />
        ) : (
          <>
            <CashTable ledger={totalLedger} label="전체 합계" />

            {/* 프로젝트별 현금 잔고 비교 */}
            {projList.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-600 mb-2">프로젝트별 현금 잔고</h4>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">프로젝트</th>
                        {months.map(mk => {
                          const isCurrent = mk === currentMonth
                          return (
                            <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${isCurrent ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                              {mk.slice(5)}월말
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(projectLedgers).map(([projId, { code, ledger }]) => {
                        const hasAny = months.some(mk => ledger[mk])
                        if (!hasAny) return null
                        return (
                          <tr key={projId} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono font-medium text-sm">{code}</td>
                            {months.map(mk => {
                              const isCurrent = mk === currentMonth
                              const lastKnown = months
                                .filter(m => m <= mk)
                                .reduceRight<number | null>((acc, m) => acc !== null ? acc : (ledger[m]?.closing ?? null), null)
                              return (
                                <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${lastKnown !== null && lastKnown < 0 ? 'text-red-500' : 'text-gray-700'}`}>
                                  {lastKnown !== null ? fmtBal(lastKnown) : '-'}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <hr className="border-gray-200" />

      {/* ═══════════════════════════════════════════════════════
          섹션 2: 활동구분별 월별 집계
      ══════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-base">활동구분별 집계 ({year}년)</h3>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">활동구분</th>
                {months.map(mk => {
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
                const annual = annualNet(type)
                const hasData = months.some(mk => monthNet(mk, type) !== 0)
                return (
                  <tr key={type} className={`border-b hover:bg-gray-50 ${!hasData ? 'opacity-40' : ''}`}>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTIVITY_COLOR[type] ?? ''}`}>
                        {type}
                      </span>
                    </td>
                    {months.map(mk => {
                      const net = monthNet(mk, type)
                      const isCurrent = mk === currentMonth
                      return (
                        <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${net < 0 ? 'text-red-600' : net === 0 ? 'text-gray-300' : ''}`}>
                          {fmt(net)}
                        </td>
                      )
                    })}
                    <td className={`text-right px-3 py-2 tabular-nums font-medium bg-gray-50 ${annual < 0 ? 'text-red-600' : annual === 0 ? 'text-gray-300' : 'text-gray-900'}`}>
                      {fmt(annual)}
                    </td>
                  </tr>
                )
              })}
              {/* 합계 */}
              <tr className="bg-gray-100 font-bold border-t-2">
                <td className="px-3 py-2 text-sm">합계</td>
                {months.map(mk => {
                  const total = ACTIVITY_TYPES.reduce((s, t) => s + monthNet(mk, t), 0)
                  const isCurrent = mk === currentMonth
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-100' : ''} ${total < 0 ? 'text-red-600' : total === 0 ? 'text-gray-400' : ''}`}>
                      {fmt(total)}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-200`}>
                  {fmt(ACTIVITY_TYPES.reduce((s, t) => s + annualNet(t), 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 활동구분별 유형 상세 */}
        <div className="space-y-4 mt-2">
          {ACTIVITY_TYPES.map(type => {
            const subtypes = Array.from(new Set(matrixRows.filter(r => r.activity_type === type).map(r => r.activity_subtype)))
            if (subtypes.length === 0) return null

            const subtypeAggAll: Record<string, Record<string, { debit: number; credit: number }>> = {}
            for (const r of matrixRows.filter(r => r.activity_type === type)) {
              const mk = r.month.slice(0, 7)
              const st = r.activity_subtype
              if (!subtypeAggAll[st]) subtypeAggAll[st] = {}
              if (!subtypeAggAll[st][mk]) subtypeAggAll[st][mk] = { debit: 0, credit: 0 }
              subtypeAggAll[st][mk].debit  += Number(r.total_debit)
              subtypeAggAll[st][mk].credit += Number(r.total_credit)
            }

            return (
              <details key={type} className="border rounded-lg overflow-hidden">
                <summary className={`px-3 py-2 cursor-pointer text-sm font-medium flex items-center gap-2 select-none hover:bg-gray-50`}>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ACTIVITY_COLOR[type] ?? ''}`}>{type}</span>
                  유형별 상세
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-t">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">유형</th>
                        {months.map(mk => {
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
                        const stData = subtypeAggAll[subtype] ?? {}
                        const annualSubNet = Object.values(stData).reduce((s, v) => s + v.debit - v.credit, 0)
                        return (
                          <tr key={subtype} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-600">{subtype}</td>
                            {months.map(mk => {
                              const v = stData[mk]
                              const net = v ? v.debit - v.credit : 0
                              const isCurrent = mk === currentMonth
                              return (
                                <td key={mk} className={`text-right px-3 py-2 tabular-nums ${isCurrent ? 'bg-blue-50/50' : ''} ${net < 0 ? 'text-red-500' : net === 0 ? 'text-gray-300' : ''}`}>
                                  {fmt(net)}
                                </td>
                              )
                            })}
                            <td className={`text-right px-3 py-2 tabular-nums font-medium bg-gray-50 ${annualSubNet < 0 ? 'text-red-500' : annualSubNet === 0 ? 'text-gray-300' : ''}`}>
                              {fmt(annualSubNet)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })}
        </div>
      </div>
    </div>
  )
}
