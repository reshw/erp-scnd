import { createAdminClient } from '@/lib/supabase/admin'
import NonOpRows from './NonOpRows'

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

/** XIRR: 이분법 100회 수렴 */
function xirr(cfs: { date: Date; amount: number }[]): number | null {
  if (cfs.length < 2) return null
  const t0 = cfs[0].date.getTime()
  const npv = (r: number) =>
    cfs.reduce((s, cf) => s + cf.amount / Math.pow(1 + r, (cf.date.getTime() - t0) / (365 * 86400000)), 0)
  const loNpv = npv(-0.9999)
  const hiNpv = npv(10)
  if (Math.sign(loNpv) === Math.sign(hiNpv)) return null
  let lo = -0.9999, hi = 10
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    npv(mid) * npv(lo) <= 0 ? (hi = mid) : (lo = mid)
  }
  return (lo + hi) / 2
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

function buildLedger(rows: CashflowRow[], projectIds?: string[]): BalanceLedger {
  const byMonth: Record<string, { debit: number; credit: number }> = {}
  for (const r of rows) {
    if (r.activity_type !== '현금') continue
    if (projectIds && projectIds.length > 0) {
      if (!projectIds.includes(r.project_id ?? '')) continue
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
  searchParams: Promise<{ project?: string | string[]; year?: string }>
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

  // 멀티 프로젝트 선택 파싱
  const projParam = params.project
  const selectedCodes: string[] = Array.isArray(projParam)
    ? projParam
    : projParam ? [projParam] : []
  const selectedProjs = projList.filter(p => selectedCodes.includes(p.code))
  const selectedProjIds = selectedProjs.map(p => p.id)

  // 현금 잔고용: 전 기간
  const { data: cashAllTime } = await (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, total_debit, total_credit')
    .eq('activity_type', '현금')
    .order('month') as { data: CashflowRow[] | null }

  const cashRows = cashAllTime ?? []
  const totalLedger = buildLedger(cashRows)
  const filteredLedger = selectedProjIds.length > 0
    ? buildLedger(cashRows, selectedProjIds)
    : totalLedger

  // 프로젝트별 개별 ledger (항상 생성, 선택된 것만 표시)
  const projectLedgers: Record<string, { code: string; ledger: BalanceLedger }> = {}
  for (const p of projList) {
    projectLedgers[p.id] = { code: p.code, ledger: buildLedger(cashRows, [p.id]) }
  }

  // 활동구분 집계용: 선택 연도
  let matrixQuery = (supabase as any)
    .from('monthly_cashflow')
    .select('month, project_id, activity_type, activity_subtype, total_debit, total_credit')
    .gte('month', `${year}-01-01`)
    .lte('month', `${year}-12-31`)
    .order('month')
  if (selectedProjIds.length === 1) matrixQuery = matrixQuery.eq('project_id', selectedProjIds[0])
  else if (selectedProjIds.length > 1) matrixQuery = matrixQuery.in('project_id', selectedProjIds)

  const { data: rawMatrix } = await matrixQuery as { data: CashflowRow[] | null }
  const matrixRows = rawMatrix ?? []

  // ── #12 XIRR 데이터 ───────────────────────────────────────────────────────
  // 연초 출자잔액: 전년도까지 개인 activity 누계 (프로젝트 필터 적용)
  let priorQuery = (supabase as any)
    .from('monthly_cashflow')
    .select('total_debit, total_credit')
    .eq('activity_type', '개인')
    .lt('month', `${year}-01-01`)
  if (selectedProjIds.length === 1) priorQuery = priorQuery.eq('project_id', selectedProjIds[0])
  else if (selectedProjIds.length > 1) priorQuery = priorQuery.in('project_id', selectedProjIds)
  const { data: priorPersonalRaw } = await priorQuery as { data: Array<{ total_debit: number; total_credit: number }> | null }

  const yearStartEquity = (priorPersonalRaw ?? []).reduce(
    (s, r) => s + Number(r.total_credit) - Number(r.total_debit), 0
  )

  // 금년 개인 거래 날짜별 (취소 전표 제외, 프로젝트 필터 적용)
  let linesQuery = (supabase as any)
    .from('journal_lines')
    .select('date, debit, credit, journals!inner(is_cancelled, project_id)')
    .eq('activity_type', '개인')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .eq('journals.is_cancelled', false)
    .order('date')
  if (selectedProjIds.length === 1) linesQuery = linesQuery.eq('journals.project_id', selectedProjIds[0])
  else if (selectedProjIds.length > 1) linesQuery = linesQuery.in('journals.project_id', selectedProjIds)
  const { data: personalLinesRaw } = await linesQuery as { data: Array<{ date: string; debit: number; credit: number }> | null }

  const personalLines = personalLinesRaw ?? []

  // 금년 누적 순이익: 영업 (credit - debit)
  const yearNetProfit = matrixRows
    .filter(r => r.activity_type === '영업')
    .reduce((s, r) => s + Number(r.total_credit) - Number(r.total_debit), 0)

  // 금년 개인 순투입 = 투입(credit) - 인출(debit)
  const yearContrib = personalLines.reduce((s, r) => s + Number(r.credit) - Number(r.debit), 0)
  const yearEndEquity = yearStartEquity + yearContrib
  const terminalValue = yearEndEquity + yearNetProfit

  const todayStr = new Date().toISOString().slice(0, 10)
  const currentYear = new Date().getFullYear().toString()
  const terminalDateStr = year < currentYear ? `${year}-12-31` : todayStr
  const terminalDate = new Date(terminalDateStr)

  // XIRR 현금흐름 구성
  const xirrCFs: { date: Date; amount: number }[] = []
  if (yearStartEquity > 0) {
    xirrCFs.push({ date: new Date(`${year}-01-01`), amount: -yearStartEquity })
  }
  for (const l of personalLines) {
    const amount = Number(l.debit) - Number(l.credit)  // 인출(+), 투입(-)
    if (amount !== 0) xirrCFs.push({ date: new Date(l.date), amount })
  }
  if (terminalValue > 0) {
    xirrCFs.push({ date: terminalDate, amount: terminalValue })
  }
  const xirrRate = xirr(xirrCFs)

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  // 손익 추이 드릴다운 링크 — 현재 선택된 프로젝트 필터를 그대로 물려준다
  function plLink(mk: string | null, type: string, subtype?: string) {
    const p = new URLSearchParams({ year })
    if (mk) p.set('month', String(parseInt(mk.slice(5))))
    p.set('type', type)
    if (subtype) p.set('subtype', subtype)
    if (selectedCodes.length > 0) p.set('projects', selectedCodes.join(','))
    return `/journals?${p.toString()}`
  }

  // ── 활동구분 집계 ──────────────────────────────────────────────────────────
  const agg: Record<string, Record<string, { debit: number; credit: number }>> = {}
  // activity_type → subtype → month → {debit, credit} (NonOpRows 아코디언용)
  const typeSubAgg: Record<string, Record<string, Record<string, { debit: number; credit: number }>>> = {}
  for (const r of matrixRows) {
    const mk = r.month.slice(0, 7)
    const at = r.activity_type
    const st = r.activity_subtype
    if (!agg[mk]) agg[mk] = {}
    if (!agg[mk][at]) agg[mk][at] = { debit: 0, credit: 0 }
    agg[mk][at].debit  += Number(r.total_debit)
    agg[mk][at].credit += Number(r.total_credit)
    if (!typeSubAgg[at]) typeSubAgg[at] = {}
    if (!typeSubAgg[at][st]) typeSubAgg[at][st] = {}
    if (!typeSubAgg[at][st][mk]) typeSubAgg[at][st][mk] = { debit: 0, credit: 0 }
    typeSubAgg[at][st][mk].debit  += Number(r.total_debit)
    typeSubAgg[at][st][mk].credit += Number(r.total_credit)
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
  //
  // activity_type='영업'엔 진짜 매출/비용 계정 말고도 잔액성(자산·부채) 계정이 섞여 있다
  // (미수금 3종·미지급금(영업)·선급금·선수금·관리비예수금 — 현금흐름표 분류상 영업으로 묶였을 뿐
  // 손익이 아니라 잔액 증감). monthly_cashflow 뷰가 activity_subtype 문자열까지만 집계해서
  // 계정 단위로는 못 거르므로, 그 계정들의 subtype을 손익 집계에서 통째로 제외한다.
  const PL_EXCLUDE_SUBTYPES = new Set([
    '미수', '회수',              // 미수금(신용카드/무통장입금/PG)
    '선급', '선급환입',          // 선급금
    '입금', '환수',              // 선수금
    '예수', '정산',              // 관리비예수금
    '비용발생', '비용집행', '',  // 미지급금(영업) — 기존 데이터는 subtype이 빈 문자열로 기록돼 있음
  ])
  type PLMonth = { revenue: number; opex: number; interest: number }
  const pl: Record<string, PLMonth> = {}
  for (const r of matrixRows) {
    if (r.activity_type !== '영업') continue
    if (PL_EXCLUDE_SUBTYPES.has(r.activity_subtype)) continue
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
  const opProfit  = (mk: string) => { const p = plGet(mk); return p.revenue - p.opex }
  const netProfit = (mk: string) => { const p = plGet(mk); return p.revenue - p.opex - p.interest }

  const annualRevenue   = months.reduce((s, mk) => s + plGet(mk).revenue, 0)
  const annualOpex      = months.reduce((s, mk) => s + plGet(mk).opex, 0)
  const annualInterest  = months.reduce((s, mk) => s + plGet(mk).interest, 0)
  const annualOpProfit  = annualRevenue - annualOpex
  const annualNetProfit = annualRevenue - annualOpex - annualInterest

  // ── 비영업 현금 조정 ──────────────────────────────────────────────────────
  // cashImpact = credit - debit (양수 = 현금 유입, 음수 = 현금 유출)
  // 복식부기 항등식: Σ all(credit-debit) = 0
  // → 현금 순변동 = Σ 비현금 활동 (credit-debit) = 순이익 + 재무 + 세무 + 개인 + 투자
  const cashImpact = (mk: string, type: string): number => {
    const d = agg[mk]?.[type]; return d ? d.credit - d.debit : 0
  }
  const annualCashImpact = (type: string) => months.reduce((s, mk) => s + cashImpact(mk, type), 0)

  // 최종 현금 순변동 = 순이익 + 재무 + 세무 + 개인 + 투자
  const finalCashFlow  = (mk: string) =>
    netProfit(mk) + cashImpact(mk, '재무') + cashImpact(mk, '세무') + cashImpact(mk, '개인') + cashImpact(mk, '투자')
  const annualFinalCF  = annualNetProfit + annualCashImpact('재무') + annualCashImpact('세무') + annualCashImpact('개인') + annualCashImpact('투자')

  // 현금 잔고 변동과 교차 검증용 (현금 debit - credit = -(cashImpact 현금))
  const cashLedgerChange = (mk: string) => {
    const d = agg[mk]?.['현금']; return d ? d.debit - d.credit : 0
  }

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
      <form className="flex gap-3 flex-wrap items-center">
        <select name="year" defaultValue={year} className="border rounded px-2 py-1 text-sm">
          {[2023, 2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5 items-center">
          {projList.map(p => (
            <label key={p.id} className={`flex items-center gap-1.5 text-sm border rounded px-2 py-1 cursor-pointer select-none transition-colors ${selectedCodes.includes(p.code) ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white hover:bg-gray-50'}`}>
              <input
                type="checkbox"
                name="project"
                value={p.code}
                defaultChecked={selectedCodes.includes(p.code)}
                className="accent-blue-600"
              />
              {p.code}
            </label>
          ))}
        </div>
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
                      {v > 0 ? <a href={plLink(mk, '영업', '매출')} className="hover:underline">{fmt(v)}</a> : fmt(v)}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums font-bold bg-gray-50 ${annualRevenue > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                  {annualRevenue > 0 ? <a href={plLink(null, '영업', '매출')} className="hover:underline">{fmtPL(annualRevenue)}</a> : fmtPL(annualRevenue)}
                </td>
              </tr>

              {/* 영업비용 */}
              <tr className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 text-sm text-gray-600">영업비용</td>
                {months.map(mk => {
                  const v = plGet(mk).opex
                  return (
                    <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${v > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                      {v > 0 ? <a href={plLink(mk, '영업')} className="hover:underline">({fmt(v)})</a> : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-50 ${annualOpex > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                  {annualOpex > 0 ? <a href={plLink(null, '영업')} className="hover:underline">({fmtPL(annualOpex)})</a> : '-'}
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
                      {hasData ? <a href={plLink(mk, '영업')} className="hover:underline">{fmtPL(v)}</a> : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-100 ${annualOpProfit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  <a href={plLink(null, '영업')} className="hover:underline">{fmtPL(annualOpProfit)}</a>
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
                        {v > 0 ? (
                          <a href={plLink(mk, '영업', '금융비용')} className="hover:underline">({fmt(v)})</a>
                        ) : '-'}
                      </td>
                    )
                  })}
                  <td className={`text-right px-3 py-2 tabular-nums bg-gray-50 ${annualInterest > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                    {annualInterest > 0 ? (
                      <a href={plLink(null, '영업', '금융비용')} className="hover:underline">
                        ({fmtPL(annualInterest)})
                      </a>
                    ) : '-'}
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
                      {hasData ? <a href={plLink(mk, '영업')} className="hover:underline">{fmtPL(v)}</a> : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 tabular-nums bg-gray-200 ${annualNetProfit < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  <a href={plLink(null, '영업')} className="hover:underline">{fmtPL(annualNetProfit)}</a>
                </td>
              </tr>

              {/* ── 비영업 현금 조정 구분선 ── */}
              <tr className="border-t-2 border-dashed border-gray-300">
                <td colSpan={14} className="px-3 py-1 text-xs text-gray-400 bg-gray-50">
                  비영업 현금 조정 (양수 = 현금 유입 ↑ / 음수 = 현금 유출 ↓)
                </td>
              </tr>

              {/* 재무활동: 차입 – 상환 */}
              <NonOpRows
                months={months}
                currentMonth={currentMonth}
                year={year}
                agg={agg}
                typeSubAgg={typeSubAgg}
                projectCodes={selectedCodes}
              />

              {/* 최종 현금 순변동 */}
              <tr className="bg-slate-800 text-white font-bold border-t-2">
                <td className="px-3 py-2.5 text-sm">현금 순변동</td>
                {months.map(mk => {
                  const v = finalCashFlow(mk)
                  const ledger = cashLedgerChange(mk)
                  const mismatch = Math.abs(v - ledger) > 1  // 1원 오차 허용
                  const hasActivity = plGet(mk).revenue > 0 || plGet(mk).opex > 0
                    || (['재무','세무','개인','투자'] as const).some(t => cashImpact(mk, t) !== 0)
                  return (
                    <td key={mk} title={mismatch ? `⚠ 잔고 불일치 (잔고변동: ${fmtPL(ledger)})` : undefined}
                      className={`text-right px-3 py-2.5 tabular-nums ${mk === currentMonth ? 'bg-slate-600' : ''} ${!hasActivity ? 'text-slate-500' : v < 0 ? 'text-red-300' : 'text-green-300'} ${mismatch ? 'underline decoration-dotted decoration-yellow-400' : ''}`}>
                      {hasActivity ? fmtPL(v) : '-'}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2.5 tabular-nums bg-slate-700 ${annualFinalCF < 0 ? 'text-red-300' : 'text-green-300'}`}>
                  {fmtPL(annualFinalCF)}
                </td>
              </tr>

            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          현금기준 손익 · 현금 순변동 = 순이익 + 재무 + 세무 + 개인 + 투자 (복식부기 항등식) · 셀 호버 시 잔고 불일치 여부 표시
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

        {selectedProjIds.length > 0 ? (
          <>
            <CashTable
              ledger={filteredLedger}
              label={selectedProjs.length === 1 ? selectedProjs[0].code : `선택 합산 (${selectedProjs.map(p => p.code).join(' + ')})`}
            />
            {selectedProjs.length > 1 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-600 mb-2">선택 프로젝트 개별 잔고</h4>
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
                      {selectedProjs.map(p => {
                        const { ledger } = projectLedgers[p.id]
                        return (
                          <tr key={p.id} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono font-medium text-sm">{p.code}</td>
                            {months.map(mk => {
                              const lastKnown = months
                                .filter(m => m <= mk)
                                .reduceRight<number | null>((acc, m) => acc !== null ? acc : (projectLedgers[p.id].ledger[m]?.closing ?? null), null)
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
          섹션 2-B: 출자금 수익률 (XIRR)
      ══════════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <h3 className="font-semibold text-base">
          출자금 수익률 ({year}년 · 연초 리셋 가정
          {selectedProjs.length > 0 ? ` · ${selectedProjs.map(p => p.code).join(' + ')}` : ' · 전체'}
          )
        </h3>
        <div className="border rounded-lg overflow-hidden">
          <div className="p-4 bg-gray-50 border-b grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">연초 출자잔액</div>
              <div className="font-semibold tabular-nums">{fmtBal(yearStartEquity)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">금년 순투입 (투입–인출)</div>
              <div className={`font-semibold tabular-nums ${yearContrib < 0 ? 'text-red-600' : ''}`}>
                {fmtBal(yearContrib)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">금년 누적 순이익</div>
              <div className={`font-semibold tabular-nums ${yearNetProfit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                {fmtBal(yearNetProfit)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Terminal Value ({terminalDateStr})</div>
              <div className="font-semibold tabular-nums">{fmtBal(terminalValue)}</div>
            </div>
          </div>
          <div className="p-4 flex items-center gap-3">
            {xirrRate !== null ? (
              <>
                <div className={`text-3xl font-bold ${xirrRate < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {(xirrRate * 100).toFixed(2)}%
                </div>
                <div className="text-sm text-gray-500">연간 수익률 (XIRR · 현금기준)</div>
              </>
            ) : (
              <div className="text-sm text-gray-400">
                {yearStartEquity <= 0 && yearContrib <= 0 ? '출자 내역 없음' : '수익률 계산 불가 (CF 부호 확인 필요)'}
              </div>
            )}
          </div>
          <p className="px-4 pb-3 text-xs text-gray-400">
            연초 리셋: 전년말 출자잔액을 1/1 재투입으로 가정 · 금년 출자/인출 날짜별 반영 · Terminal = 연말 출자잔액 + 금년 순이익
            {year === currentYear ? ` · 기준일: ${terminalDateStr}` : ''}
          </p>
        </div>
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
