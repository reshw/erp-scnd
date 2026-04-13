import { createAdminClient } from '@/lib/supabase/admin'

function fmt(n: number) {
  if (n === 0) return '-'
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

function fmtBal(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

function fmtPL(n: number) {
  // 손익용: 0도 표시
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

function buildLedger(rows: CashflowRow[], projectId?: string | null): BalanceLedger {
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

  const { data: projects } = await (supabase as any)
    .from('projects')
    .select('id, code')
    .order('code') as { data: Array<{ id: string; code: string }> | null }

  const projList = projects ?? []
  const selectedProj = params.project ? projList.find(p => p.code === params.project) : null

  // 현금 잔고용: 전 기간
  const { data: cashAllTime } = await (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, total_debit, total_credit')
    .eq('activity_type', '현금')
    .order('month') as { data: CashflowRow[] | null }

  const cashRows = cashAllTime ?? []
  const totalLedger = buildLedger(cashRows)
  const filteredLedger = selectedProj ? buildLedger(cashRows, selectedProj.id) : totalLedger

  const projectLedgers: Record<string, { code: string; ledger: BalanceLedger }> = {}
  if (!selectedProj) {
    for (const p of projList) {
      projectLedgers[p.id] = { code: p.code, ledger: buildLedger(cashRows, p.id) }
    }
  }

  // 활동구분 집계용: 선택 연도
  let matrixQuery = (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, activity_subtype, total_debit, total_credit')
    .gte('month', `${year}-01-01`)
    .lte('month', `${year}-12-31`)
    .order('month')
  if (selectedProj) matrixQuery = matrixQuery.eq('project_id', selectedProj.id)

  const { data: rawMatrix } = await matrixQuery as { data: CashflowRow[] | null }
  const matrixRows = rawMatrix ?? []

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  // ── 활동구분 집계 ──────────────────────────────────────────────────────────
  const agg: Record<string, Record<string, { debit: number; credit: number }>> = {}
  for (const r of matrixRows) {
    const mk = r.month.slice(0, 7)
    if (!agg[mk]) agg[mk] = {}
    if (!agg[mk][r.activity_type]) agg[mk][r.activity_type] = { debit: 0, credit: 0 }
    agg[mk][r.activity_type].debit  += Number(r.total_debit)
    agg[mk][r.activity_type].credit += Number(r.total_credit)
  }
  const monthNet = (mk: string, type: string) => {
    const d = agg[mk]?.[type]; return d ? d.debit - d.credit : 0
  }
  const annualNet = (type: string) => months.reduce((s, mk) => s + monthNet(mk, type), 0)

  // ── 손익 계산 ─────────────────────────────────────────────────────────────
  // 영업 activity:
  //   total_credit → 수익 (임대료수입, 판매수입 등 — normal_side=credit 계정의 credit)
  //   total_debit, subtype != 금융비용 → 영업비용
  //   total_debit, subtype == 금융비용 → 이자비용 (영업외)
  type PLMonth = { revenue: number; opex: number; interest: number }
  const pl: Record<string, PLMonth> = {}
  for (const r of matrixRows) {
    if (r.activity_type !== '영업') continue
    const mk = r.month.slice(0, 7)
    if (!pl[mk]) pl[mk] = { revenue: 0, opex: 0, interest: 0 }
    pl[mk].revenue += Number(r.total_credit)
    if (r.activity_subtype === '금융비용') {
      pl[mk].interest += Number(r.total_debit)
    } else {
      pl[mk].opex += Number(r.total_debit)
    }
  }

  const plGet = (mk: string): PLMonth => pl[mk] ?? { revenue: 0, opex: 0, interest: 0 }
  const opProfit = (mk: string) => { const p = plGet(mk); return p.revenue - p.opex }
  const netProfit = (mk: string) => { const p = plGet(mk); return p.revenue - p.opex - p.interest }

  const annualRevenue  = months.reduce((s, mk) => s + plGet(mk).revenue, 0)
  const annualOpex     = months.reduce((s, mk) => s + plGet(mk).opex, 0)
  const annualInterest = months.reduce((s, mk) => s + plGet(mk).interest, 0)
  const annualOpProfit = annualRevenue - annualOpex
  const annualNet      = annualRevenue - annualOpex - annualInterest

  // ── 현금 잔고 테이블 컴포넌트 ─────────────────────────────────────────────
  function CashTable({ ledger, label }: { ledger: BalanceLedger; label: string }) {
    const hasAny = months.some(mk => ledger[mk])
    if (!hasAny) return (
      <div className="text-sm text-gray-400 py-4 text-center border rounded-lg">{label} — 데이터 없음</div>
    )
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
          <span className={yearClosing - yearOpening >= 0 ? 'text-blue-600' : 'text-red-600'}>
            순변동 <strong className="tabular-nums">{fmtBal(yearClosing - yearOpening)}</strong>
          </span>
        </div>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">항목</th>
                {months.map(mk => (
                  <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${mk === currentMonth ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                    {mk.slice(5)}월
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-gray-50/50">
                <td className="px-3 py-2 text-xs font-medium text-gray-500">기초잔고</td>
                {months.map(mk => {
                  const val = ledger[mk]?.opening ?? null
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums text-gray-600 ${mk === currentMonth ? 'bg-blue-50/50' : ''}`}>
                      {val !== null ? fmtBal(val) : '-'}
                    </td>
                  )
                })}
              </tr>
              <tr className="border-b">
                <td className="px-3 py-2 text-xs font-medium text-blue-600">입금</td>
                {months.map(mk => {
                  const val = ledger[mk]?.debit ?? 0
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${val > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
                      {val > 0 ? fmt(val) : '-'}
                    </td>
                  )
                })}
              </tr>
              <tr className="border-b">
                <td className="px-3 py-2 text-xs font-medium text-red-500">출금</td>
                {months.map(mk => {
                  const val = ledger[mk]?.credit ?? 0
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${val > 0 ? 'text-red-500' : 'text-gray-300'}`}>
                      {val > 0 ? fmt(val) : '-'}
                    </td>
                  )
                })}
              </tr>
              <tr className="bg-gray-50 font-bold">
                <td className="px-3 py-2 text-xs font-bold">월말잔고</td>
                {months.map(mk => {
                  const lastKnown = months
                    .filter(m => m <= mk)
                    .reduceRight<number | null>((acc, m) => acc !== null ? acc : (ledger[m]?.closing ?? null), null)
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-100' : ''} ${lastKnown !== null && lastKnown < 0 ? 'text-red-600' : ''}`}>
                      {lastKnown !== null ? fmtBal(lastKnown) : '-'}
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
    <div className="space-y-8">
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
          {projList.map(p => <option key={p.id} value={p.code}>{p.code}</option>)}
        </select>
        <button type="submit" className="border rounded px-3 py-1 text-sm bg-white hover:bg-gray-50">조회</button>
      </form>

      {/* ═══════════════════════════════════════════════════════
          섹션 1: 손익 추이 (현금기준)
      ══════════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <h3 className="font-semibold text-base">손익 추이 ({year}년 / 현금기준)</h3>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">항목</th>
                {months.map(mk => (
                  <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${mk === currentMonth ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                    {mk.slice(5)}월
                  </th>
                ))}
                <th className="text-right px-3 py-2 font-medium text-gray-700 w-32 bg-gray-100">연간</th>
              </tr>
            </thead>
            <tbody>

              {/* 매출 */}
              <tr className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 text-sm font-medium text-green-700">매출</td>
                {months.map(mk => {
                  const v = plGet(mk).revenue
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums font-medium ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${v > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                      {fmt(v)}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums font-bold bg-gray-50 ${annualRevenue > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                  {fmtPL(annualRevenue)}
                </td>
              </tr>

              {/* 영업비용 */}
              <tr className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 text-sm text-gray-600">영업비용</td>
                {months.map(mk => {
                  const v = plGet(mk).opex
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${v > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                      {v > 0 ? `(${fmt(v)})` : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-50 ${annualOpex > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                  {annualOpex > 0 ? `(${fmtPL(annualOpex)})` : '-'}
                </td>
              </tr>

              {/* 영업이익 */}
              <tr className="border-b bg-green-50/50 font-bold">
                <td className="px-3 py-2 text-sm">영업이익</td>
                {months.map(mk => {
                  const v = opProfit(mk)
                  const hasData = plGet(mk).revenue > 0 || plGet(mk).opex > 0
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-100/50' : ''} ${!hasData ? 'text-gray-300' : v < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {hasData ? fmtPL(v) : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-100 ${annualOpProfit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {fmtPL(annualOpProfit)}
                </td>
              </tr>

              {/* 이자비용(영업외) */}
              {(annualInterest > 0 || months.some(mk => plGet(mk).interest > 0)) && (
                <tr className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm text-orange-600">이자비용(영업외)</td>
                  {months.map(mk => {
                    const v = plGet(mk).interest
                    return (
                      <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${v > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
                        {v > 0 ? `(${fmt(v)})` : '-'}
                      </td>
                    )
                  })}
                  <td className={`text-right px-3 py-2 tabular-nums bg-gray-50 ${annualInterest > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                    {annualInterest > 0 ? `(${fmtPL(annualInterest)})` : '-'}
                  </td>
                </tr>
              )}

              {/* 순이익 */}
              <tr className="bg-gray-100 font-bold border-t-2">
                <td className="px-3 py-2 text-sm">순이익</td>
                {months.map(mk => {
                  const v = netProfit(mk)
                  const hasData = plGet(mk).revenue > 0 || plGet(mk).opex > 0 || plGet(mk).interest > 0
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-200/50' : ''} ${!hasData ? 'text-gray-300' : v < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {hasData ? fmtPL(v) : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-200 ${annualNet < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {fmtPL(annualNet)}
                </td>
              </tr>

            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          현금기준 손익: 영업 activity 중 수익계정 credit = 매출, 비용계정 debit = 영업비용, 이자비용(금융비용 subtype) 별도 차감
        </p>
      </div>

      <hr className="border-gray-200" />

      {/* ═══════════════════════════════════════════════════════
          섹션 2: 현금 잔고 추이
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
            {projList.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-600 mb-2">프로젝트별 현금 잔고</h4>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">프로젝트</th>
                        {months.map(mk => (
                          <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${mk === currentMonth ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                            {mk.slice(5)}월말
                          </th>
                        ))}
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
                              const lastKnown = months
                                .filter(m => m <= mk)
                                .reduceRight<number | null>((acc, m) => acc !== null ? acc : (ledger[m]?.closing ?? null), null)
                              return (
                                <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${lastKnown !== null && lastKnown < 0 ? 'text-red-500' : 'text-gray-700'}`}>
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
          섹션 3: 활동구분별 집계
      ══════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="font-semibold text-base">활동구분별 집계 ({year}년)</h3>
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">활동구분</th>
                {months.map(mk => (
                  <th key={mk} className={`text-right px-3 py-2 font-medium w-28 ${mk === currentMonth ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                    {mk.slice(5)}월
                  </th>
                ))}
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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTIVITY_COLOR[type] ?? ''}`}>{type}</span>
                    </td>
                    {months.map(mk => {
                      const net = monthNet(mk, type)
                      return (
                        <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${net < 0 ? 'text-red-600' : net === 0 ? 'text-gray-300' : ''}`}>
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
              {/* 합계 행 제거: 복식부기 특성상 전체 합 ≈ 0 으로 의미없음 */}
            </tbody>
          </table>
        </div>

        {/* 활동구분별 유형 상세 */}
        <div className="space-y-3">
          {ACTIVITY_TYPES.map(type => {
            const subtypes = Array.from(new Set(matrixRows.filter(r => r.activity_type === type).map(r => r.activity_subtype)))
            if (subtypes.length === 0) return null

            const stAgg: Record<string, Record<string, { debit: number; credit: number }>> = {}
            for (const r of matrixRows.filter(r => r.activity_type === type)) {
              const mk = r.month.slice(0, 7)
              const st = r.activity_subtype
              if (!stAgg[st]) stAgg[st] = {}
              if (!stAgg[st][mk]) stAgg[st][mk] = { debit: 0, credit: 0 }
              stAgg[st][mk].debit  += Number(r.total_debit)
              stAgg[st][mk].credit += Number(r.total_credit)
            }

            return (
              <details key={type} className="border rounded-lg overflow-hidden">
                <summary className="px-3 py-2 cursor-pointer text-sm font-medium flex items-center gap-2 select-none hover:bg-gray-50">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ACTIVITY_COLOR[type] ?? ''}`}>{type}</span>
                  유형별 상세
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-t">
                        <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">유형</th>
                        {months.map(mk => (
                          <th key={mk} className={`text-right px-3 py-2 font-medium w-24 ${mk === currentMonth ? 'text-blue-600 bg-blue-50' : 'text-gray-600'}`}>
                            {mk.slice(5)}월
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 font-medium text-gray-700 w-28 bg-gray-100">연간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subtypes.map(subtype => {
                        const stData = stAgg[subtype] ?? {}
                        const annualSubNet = Object.values(stData).reduce((s, v) => s + v.debit - v.credit, 0)
                        return (
                          <tr key={subtype} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-600">{subtype}</td>
                            {months.map(mk => {
                              const v = stData[mk]
                              const net = v ? v.debit - v.credit : 0
                              return (
                                <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${net < 0 ? 'text-red-500' : net === 0 ? 'text-gray-300' : ''}`}>
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
