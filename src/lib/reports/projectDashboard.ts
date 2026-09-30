// 프로젝트 단위 "잔액/손익" 대시보드 계산 — src/app/(staff)/staff/page.tsx(직원용)와
// src/app/(erp)/project-dashboard/page.tsx(관리자용, 프로젝트 선택 가능)가 공유한다.
// 두 화면이 같은 숫자를 봐야 하므로 로직은 여기 한 곳에만 둔다.

import { fetchPayoutForecast } from './payoutForecast.ts'

// 잔액성(자산/부채) 계정의 activity_subtype — 손익 집계에서 제외해야 매출/비용이 안 부풀려짐
// (src/app/(erp)/monthly/page.tsx의 PL_EXCLUDE_SUBTYPES와 동일한 목적)
export const PL_EXCLUDE_SUBTYPES = new Set([
  '미수', '회수', '선급', '선급환입', '입금', '환수', '예수', '정산',
  '비용발생', '비용집행', '', '반제처리',
])

export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthEnd(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`
}

export function resolveMonthKey(requestedMonth?: string): string {
  const currentMonthKey = new Date().toISOString().slice(0, 7)
  return requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) && requestedMonth <= currentMonthKey
    ? requestedMonth
    : currentMonthKey
}

export interface ProjectDashboardData {
  monthKey: string
  prevMonth: string
  nextMonth: string
  isCurrentMonth: boolean
  asOfDate: string
  revenue: number
  opex: number
  vat: number
  vatInput: number
  revenueGross: number
  opexGross: number
  balanceRows: { name: string; balance: number }[]
  bankBalance: Record<string, number>
  bankTotal: number
  cashTotal: number
  vatPayable: number
  founderPayable: number
  apPayable: number
  availableBalance: number
  receivablesTotal: number
  projectedBalance: number
  // 월 영업이익(순매출 − 순비용, 전표 기준). 예정잔고는 사실상 누적 이익이라(대표 대납/인출이 상쇄돼 0),
  // 지난달 확정 시점 예정잔고 대비 증감이 곧 이 값과 같아진다(2026-08 실측: 64,856 → 454,935, +390,079).
  operatingProfit: number
  prevProjectedBalance: number | null
  projectedDelta: number | null
  payoutForecast: PayoutForecastSummary | null
}

export async function getProjectDashboardData(
  supabase: any,
  projectId: string,
  requestedMonth?: string,
  opts: { skipPrev?: boolean } = {},
): Promise<ProjectDashboardData> {
  const monthKey = resolveMonthKey(requestedMonth)
  const currentMonthKey = new Date().toISOString().slice(0, 7)
  const isCurrentMonth = monthKey === currentMonthKey
  const prevMonth = shiftMonth(monthKey, -1)
  const nextMonth = shiftMonth(monthKey, 1)
  // 미결잔액/통장잔고는 "기간" 활동이 아니라 "기준일" 스냅샷 개념(docs/decisions.md의
  // /clearings 재설계와 동일한 이유) — 선택한 달의 말일까지 누적으로 계산한다.
  // 이번 달을 보고 있을 땐 아직 그 달이 끝나지 않았으니 오늘까지로 계산.
  const asOfDate = isCurrentMonth ? new Date().toISOString().slice(0, 10) : monthEnd(monthKey)

  // 매출/비용 (monthly_cashflow 뷰, 영업 activity만)
  const { data: cashflowRows } = await supabase
    .from('monthly_cashflow')
    .select('month, activity_type, activity_subtype, total_debit, total_credit')
    .eq('project_id', projectId)
    .eq('month', `${monthKey}-01`)

  let revenue = 0
  let opex = 0
  for (const r of (cashflowRows ?? []) as any[]) {
    if (r.activity_type !== '영업') continue
    if (PL_EXCLUDE_SUBTYPES.has(r.activity_subtype)) continue
    if (r.activity_subtype === '매출취소') {
      // 매출 계정(판매수입 등)의 감소 라벨 — 별도 비용이 아니라 매출에서 순액 차감
      revenue -= Number(r.total_debit)
    } else {
      revenue += Number(r.total_credit)
      opex += Number(r.total_debit)
    }
  }

  // 부가세 포함 매출/비용 — 순매출·순비용(revenue/opex)에 대응하는 부가세예수금/부가세대급금만
  // 골라야 하므로 subtype 문자열만으로는 못 거른다(지급/환급 라벨이 다른 목적과 겹침).
  // 대신 "같은 전표에 매출·매입 계정 라인이 있는지"로 관련 부가세 라인만 골라낸다.
  const monthStart = `${monthKey}-01`
  const monthLastDate = monthEnd(monthKey)
  const { data: salesTaxAccounts } = await supabase
    .from('accounts')
    .select('id')
    .eq('activity_type', '영업')
    .eq('increase_type', '매출')
  const revenueAccountIds = (salesTaxAccounts ?? []).map((a: any) => a.id)

  const { data: purchaseTaxAccounts } = await supabase
    .from('accounts')
    .select('id')
    .eq('activity_type', '영업')
    .eq('increase_type', '매입')
  const expenseAccountIds = (purchaseTaxAccounts ?? []).map((a: any) => a.id)

  // vatAccountSide: 부가세예수금은 대변증가(부채), 부가세대급금은 차변증가(자산) — 둘 다
  // "증가액"이 양수가 되도록 부호를 계정 정상측에 맞춘다.
  async function relatedVat(accountIds: string[], vatAccountName: string, vatAccountSide: 'debit' | 'credit'): Promise<number> {
    if (accountIds.length === 0) return 0
    const { data: relatedLines } = await supabase
      .from('journal_lines')
      .select('journal_id, journals!inner(is_cancelled, project_id)')
      .in('account_id', accountIds)
      .eq('journals.is_cancelled', false)
      .eq('journals.project_id', projectId)
      .gte('date', monthStart)
      .lte('date', monthLastDate)
    const journalIds = [...new Set((relatedLines ?? []).map((l: any) => l.journal_id))]
    if (journalIds.length === 0) return 0
    const { data: vatLines } = await supabase
      .from('journal_lines')
      .select('debit, credit, accounts!inner(name)')
      .eq('accounts.name', vatAccountName)
      .in('journal_id', journalIds)
    let vat = 0
    for (const l of (vatLines ?? []) as any[]) {
      vat += vatAccountSide === 'credit' ? l.credit - l.debit : l.debit - l.credit
    }
    return vat
  }

  const vat = await relatedVat(revenueAccountIds, '부가세예수금', 'credit')
  const vatInput = await relatedVat(expenseAccountIds, '부가세대급금', 'debit')
  const revenueGross = revenue + vat
  const opexGross = opex + vatInput

  // 미결잔액 (미수금/미지급금 계열) — 이 프로젝트 전표만, 기준일까지
  const { data: balanceAccounts } = await supabase
    .from('accounts')
    .select('id, name, normal_side')
    .in('name', [
      '미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '미지급금(매입)', '미지급금(원리금)',
      '현금', '보통예금', '부가세예수금', '부가세대급금', '가수금(대표이사)', '인출금',
    ])
  const accByName = Object.fromEntries((balanceAccounts ?? []).map((a: any) => [a.name, a]))

  const { data: validJournals } = await supabase
    .from('journals')
    .select('id')
    .eq('is_cancelled', false)
    .eq('project_id', projectId)
    .lte('date', asOfDate)
  const validIds = (validJournals ?? []).map((j: any) => j.id)

  // acc 잔액(기준일까지 누적). counterpartyName을 주면 그 거래처 라인만 걸러서 합산.
  async function accountBalance(acc: any, counterpartyName?: string, ids: string[] = validIds): Promise<number> {
    if (!acc || ids.length === 0) return 0
    let q = supabase.from('journal_lines').select('debit, credit').eq('account_id', acc.id).in('journal_id', ids)
    if (counterpartyName) q = q.eq('counterparty_name', counterpartyName)
    const { data: lines } = await q
    let bal = 0
    for (const l of (lines ?? []) as any[]) {
      bal += acc.normal_side === 'credit' ? l.credit - l.debit : l.debit - l.credit
    }
    return bal
  }

  // 미결잔액 표는 월 이동과 무관하게 항상 "오늘 기준 현재 미결"만 보여준다. 월말 스냅샷으로 보이면 다음 달에
  // 이미 정산된 항목(예: 7월말 미수금 450,000)이 해결 안 된 것처럼 남아 혼란만 주기 때문이다.
  // (가용잔액·예정잔고는 영업이익 증감과 맞물려야 해서 월말 스냅샷을 유지한다.)
  let currentIds = validIds
  if (!isCurrentMonth) {
    const today = new Date().toISOString().slice(0, 10)
    const { data: todayJournals } = await supabase
      .from('journals').select('id').eq('is_cancelled', false).eq('project_id', projectId).lte('date', today)
    currentIds = (todayJournals ?? []).map((j: any) => j.id)
  }
  const balanceRows: { name: string; balance: number }[] = []
  for (const name of ['미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)', '미지급금(매입)', '미지급금(원리금)']) {
    const bal = await accountBalance(accByName[name], undefined, currentIds)
    if (bal !== 0) balanceRows.push({ name, balance: bal })
  }

  // 통장 잔고 (보통예금, 거래처별)
  const bankBalance: Record<string, number> = {}
  if (accByName['보통예금'] && validIds.length > 0) {
    const { data: lines } = await supabase
      .from('journal_lines')
      .select('debit, credit, counterparty_name')
      .eq('account_id', accByName['보통예금'].id)
      .in('journal_id', validIds)
    for (const l of (lines ?? []) as any[]) {
      const cp = l.counterparty_name
      if (!cp) continue
      bankBalance[cp] = (bankBalance[cp] ?? 0) + l.debit - l.credit
    }
  }

  // 가용잔액(운영 가능 자금) = 보통예금 + 현금
  //   − 부가세 순채무(부가세예수금 − 부가세대급금, 세무서에 낼 돈이라 회사가 쓸 돈 아님)
  //   − 대표자 관련 순채무(가수금(대표이사) − 인출금(양석환))
  //   − 미지급금(매입)(대관료 등 확정된 채무)
  // 전부 asOfDate 기준 누적 잔액.
  //
  // 대표자 관련 순채무는 반드시 순액(가수금 − 인출금)으로 계산해야 한다 — 가수금만 빼면
  // 이중으로 나쁘게 잡힌다: NADIA 정산금이 인출금으로 빠져나가 마통에 들어간 뒤(그가
  // NADIA에 갚아야 할 돈, 인출금), 그가 다시 마통에서 인출해 NADIA 청구서를 대신 갚아준
  // 것(NADIA가 그에게 갚아야 할 돈, 가수금)까지 겹치면 사실상 "그가 NADIA에 갚아야 할 돈"과
  // "NADIA가 그에게 갚아야 할 돈"이 서로 다른 방향인데 가수금만 빼면 인출금 쪽 채권이
  // 통째로 누락된다.
  const bankTotal = Object.values(bankBalance).reduce((s, v) => s + v, 0)
  const cashTotal = await accountBalance(accByName['현금'])
  const vatPayable = await accountBalance(accByName['부가세예수금']) - await accountBalance(accByName['부가세대급금'])
  const founderPayable = (await accountBalance(accByName['가수금(대표이사)'], '양석환')) - (await accountBalance(accByName['인출금'], '양석환'))
  const apPayable = await accountBalance(accByName['미지급금(매입)'])
  const availableBalance = bankTotal + cashTotal - vatPayable - founderPayable - apPayable

  // 예정잔고 = 가용잔액 + 추후 정산받을 미수금(신용카드/무통장입금/PG). 가용잔액이 "지금 당장
  // 쓸 수 있는 돈"이라면 예정잔고는 "미수금이 전부 들어오면 얼마가 되는지" 전망치다.
  const receivablesTotal =
    (await accountBalance(accByName['미수금(신용카드)'])) +
    (await accountBalance(accByName['미수금(무통장입금)'])) +
    (await accountBalance(accByName['미수금(PG)']))
  const projectedBalance = availableBalance + receivablesTotal

  // 전월말 예정잔고 — 같은 계산을 지난달 기준일로 한 번 더(재귀는 한 단계만). 증감 = 그달 영업이익.
  const prevProjectedBalance = opts.skipPrev
    ? null
    : (await getProjectDashboardData(supabase, projectId, prevMonth, { skipPrev: true })).projectedBalance
  const projectedDelta = prevProjectedBalance === null ? null : projectedBalance - prevProjectedBalance
  const operatingProfit = revenue - opex

  // 지급예정액 반영(NADIA 전용, 이번 달을 볼 때만) — 아직 장부에 없는 대관료·강사료를 timetable 추정치로
  // 미리 뺀 "예상 가용잔액". 공식 가용잔액과 섞지 않고 별도 항목으로 노출한다.
  let payoutForecast: PayoutForecastSummary | null = null
  if (isCurrentMonth) {
    const { data: proj } = await supabase.from('projects').select('code').eq('id', projectId).single()
    if (proj?.code === 'NADIA') {
      payoutForecast = await computePayoutForecast(supabase, validIds, monthKey, prevMonth, {
        availableBalance, receivablesTotal, revenue, opex, prevProjectedBalance,
      })
    }
  }

  return {
    monthKey, prevMonth, nextMonth, isCurrentMonth, asOfDate,
    revenue, opex, vat, vatInput, revenueGross, opexGross,
    balanceRows, bankBalance, bankTotal, cashTotal,
    vatPayable, founderPayable, apPayable, availableBalance,
    receivablesTotal, projectedBalance, operatingProfit, prevProjectedBalance, projectedDelta, payoutForecast,
  }
}

export interface PayoutForecastSummary {
  venueTotal: number       // 아직 전표가 없는 대관료 합계(부가세 포함)
  venueVat: number         // 그중 부가세(대급금으로 잡혀 부가세 납부액이 줄어드는 몫)
  instructorTotal: number  // 아직 지급 전표가 없는 강사료 합계(세전)
  expectedAvailable: number
  expectedProjected: number       // 예상 예정잔고 = 예상 가용잔액 + 미수금
  expectedProfit: number          // 이번 달 예상 영업이익(발생주의: 이번 달 대관료·강사료 반영, 지난달분 강사료 지급은 제외)
  prevAdjustedProjected: number | null // 전월말 예정잔고에서 그때 이미 발생했으나 미전표였던 지난달 강사료 등을 뺀 값
  expectedDelta: number | null    // 예상 예정잔고 − 전월말(조정) 예정잔고 ≈ expectedProfit
}

// 대관료는 매출월 다음 달 초에 전표(venue_fee_postings), 강사료는 다음 달 10일경 지급 시점에 전표가
// 생긴다. 그래서 "이번 달"뿐 아니라 "지난달분 중 아직 전표가 안 생긴 것"도 예정액에 든다.
//   대관료: period가 venue_fee_postings에 접수됐으면 제외
//   강사료: 지난달분은 그 달 말일 이후 날짜의 강사료 계정 지급 라인(강사 이름=거래처)이 있으면 그만큼 제외
// 예상 가용잔액 = 가용잔액 − 대관료(부가세 포함) + 대관료 부가세 − 강사료
async function computePayoutForecast(
  supabase: any,
  validIds: string[],
  monthKey: string,
  prevMonth: string,
  ctx: {
    availableBalance: number
    receivablesTotal: number
    revenue: number
    opex: number
    prevProjectedBalance: number | null
  },
): Promise<PayoutForecastSummary | null> {
  const [cur, prev] = await Promise.all([fetchPayoutForecast(monthKey), fetchPayoutForecast(prevMonth)])
  if (!cur || !prev) return null

  const { data: posted } = await supabase
    .from('venue_fee_postings')
    .select('period')
    .in('period', [prevMonth, monthKey])
  const postedPeriods = new Set((posted ?? []).map((p: any) => p.period))

  let venueTotal = 0
  let venueVat = 0
  for (const [period, f] of [[prevMonth, prev], [monthKey, cur]] as const) {
    if (postedPeriods.has(period)) continue
    venueTotal += f.venue_fee.rent_total_amount
    venueVat += f.venue_fee.rent_vat_amount
  }
  // 이번 달 손익에 들어가는 대관료(공급가)는 이번 달 몫뿐. 지난달분 미접수는 지난달 손익이다.
  const venueCurSupply = postedPeriods.has(monthKey) ? 0 : cur.venue_fee.rent_supply_amount
  const venuePrevSupplyUnposted = postedPeriods.has(prevMonth) ? 0 : prev.venue_fee.rent_supply_amount

  // 지난달분 강사료 지급 여부 — 지난달 말일 이후에 찍힌 강사료 계정 라인을 강사 이름(거래처)별로 합산
  const { data: feeAcc } = await supabase.from('accounts').select('id').eq('name', '강사료').maybeSingle()
  const paidAfterPrev: Record<string, number> = {}
  if (feeAcc && validIds.length > 0) {
    const { data: lines } = await supabase
      .from('journal_lines')
      .select('debit, credit, counterparty_name')
      .eq('account_id', feeAcc.id)
      .in('journal_id', validIds)
      .gt('date', monthEnd(prevMonth))
    for (const l of (lines ?? []) as any[]) {
      if (!l.counterparty_name) continue
      paidAfterPrev[l.counterparty_name] = (paidAfterPrev[l.counterparty_name] ?? 0) + Number(l.debit) - Number(l.credit)
    }
  }

  let instructorCurGross = 0
  for (const i of cur.instructor_fees) instructorCurGross += i.gross_fee ?? 0
  let instructorPrevGross = 0
  let instructorPrevUnpaid = 0
  let paidPrevThisMonth = 0
  for (const i of prev.instructor_fees) {
    // gross_fee가 null(계약단가 미설정, 예: 대표 본인)이면 예정액에서 제외
    const gross = i.gross_fee ?? 0
    const paid = paidAfterPrev[i.name] ?? 0
    instructorPrevGross += gross
    instructorPrevUnpaid += Math.max(0, gross - paid)
    paidPrevThisMonth += Math.min(gross, paid)
  }
  const instructorTotal = instructorCurGross + instructorPrevUnpaid

  const expectedAvailable = ctx.availableBalance - venueTotal + venueVat - instructorTotal
  const expectedProjected = expectedAvailable + ctx.receivablesTotal

  // 이번 달 예상 영업이익(발생주의) — 장부 손익에서 "지난달분 강사료를 이번 달에 지급해 잡힌 비용"을 되돌리고
  // 이번 달 몫 대관료(공급가)·강사료를 더 뺀다.
  const expectedProfit = ctx.revenue - ctx.opex + paidPrevThisMonth - venueCurSupply - instructorCurGross

  // 전월말 예정잔고도 같은 발생주의로 맞춘다: 그 시점에 이미 발생했지만 전표가 없던 지난달 강사료(·미접수 대관료)를 뺀다.
  const prevAdjustedProjected = ctx.prevProjectedBalance === null
    ? null
    : ctx.prevProjectedBalance - instructorPrevGross - venuePrevSupplyUnposted
  const expectedDelta = prevAdjustedProjected === null ? null : expectedProjected - prevAdjustedProjected

  return {
    venueTotal, venueVat, instructorTotal,
    expectedAvailable, expectedProjected, expectedProfit, prevAdjustedProjected, expectedDelta,
  }
}

export interface ProjectLedgerRow {
  journalId: string
  date: string
  journalNo: number
  account: string
  label: string
  net: number
  vat: number
  gross: number
}

export interface ProjectLedgerData {
  monthKey: string
  prevMonth: string
  nextMonth: string
  isCurrentMonth: boolean
  rows: ProjectLedgerRow[]
  totalNet: number
  totalVat: number
  totalGross: number
}

export async function getProjectLedgerData(
  supabase: any,
  projectId: string,
  type: 'revenue' | 'expense',
  requestedMonth?: string,
): Promise<ProjectLedgerData> {
  const monthKey = resolveMonthKey(requestedMonth)
  const currentMonthKey = new Date().toISOString().slice(0, 7)
  const isCurrentMonth = monthKey === currentMonthKey
  const prevMonth = shiftMonth(monthKey, -1)
  const nextMonth = shiftMonth(monthKey, 1)
  const monthStart = `${monthKey}-01`
  const monthLastDate = monthEnd(monthKey)

  const vatAccountName = type === 'revenue' ? '부가세예수금' : '부가세대급금'
  const vatSide: 'debit' | 'credit' = type === 'revenue' ? 'credit' : 'debit'

  const { data: linesData } = await supabase
    .from('journal_lines')
    .select(`
      id, journal_id, date, activity_subtype, debit, credit, counterparty_name, note,
      accounts ( name ),
      journals!inner ( journal_no, description, is_cancelled, project_id )
    `)
    .eq('activity_type', '영업')
    .eq('journals.project_id', projectId)
    .eq('journals.is_cancelled', false)
    .gte('date', monthStart)
    .lte('date', monthLastDate)
    .order('date', { ascending: false })

  // 전표(journal) 단위로 묶는다 — 부가세는 같은 전표의 별도 라인(부가세예수금/부가세대급금)이라
  // 라인 하나가 아니라 전표 하나가 "거래 한 건"의 단위다.
  type Row = { journalId: string; date: string; journalNo: number; account: string; label: string; net: number }
  const rowsByJournal = new Map<string, Row>()
  for (const l of (linesData ?? []) as any[]) {
    if (PL_EXCLUDE_SUBTYPES.has(l.activity_subtype)) continue
    const isCancel = l.activity_subtype === '매출취소'
    let amount: number | null = null
    if (type === 'revenue') {
      if (isCancel) amount = -Number(l.debit)
      else if (Number(l.credit) > 0) amount = Number(l.credit)
    } else {
      if (!isCancel && Number(l.debit) > 0) amount = Number(l.debit)
    }
    if (amount === null) continue

    const label = l.counterparty_name || l.note || l.journals?.description || '-'
    const account = l.accounts?.name ?? '-'
    const existing = rowsByJournal.get(l.journal_id)
    if (existing) {
      existing.net += amount
      if (!existing.account.includes(account)) existing.account += `, ${account}`
    } else {
      rowsByJournal.set(l.journal_id, { journalId: l.journal_id, date: l.date, journalNo: l.journals.journal_no, account, label, net: amount })
    }
  }

  const journalIds = [...rowsByJournal.keys()]
  const vatByJournal = new Map<string, number>()
  if (journalIds.length > 0) {
    const { data: vatLines } = await supabase
      .from('journal_lines')
      .select('journal_id, debit, credit, accounts!inner(name)')
      .eq('accounts.name', vatAccountName)
      .in('journal_id', journalIds)
    for (const l of (vatLines ?? []) as any[]) {
      const amt = vatSide === 'credit' ? l.credit - l.debit : l.debit - l.credit
      vatByJournal.set(l.journal_id, (vatByJournal.get(l.journal_id) ?? 0) + amt)
    }
  }

  // timetable 결제매칭 워시(wash) 쌍 제외 — timetable은 결제 승인 시 상품이 아직 안
  // 정해졌으면 일단 무상품("결제")으로 먼저 올렸다가, 나중에 수강권이 매칭되면 올바른
  // 상품명으로 새 결제를 다시 올리고 원래 무상품 결제는 취소로 반대행을 낸다(sync/route.ts
  // 주석 참고, 원장이 append-only라 수정 대신 반대행 방식). 그래서 실제로는 거래 1건인데
  // 전표가 "결제/[취소] 결제/정기 OO" 3장으로 쪼개져 보인다. `timetable_payment_postings`의
  // payload.reverses_external_id가 취소 건이 정확히 어떤 원 결제를 취소하는지 알려주므로,
  // 그 짝(원 결제+취소)만 리스트에서 숨긴다 — 순액엔 이미 0으로 반영돼 있어 합계는 안 바뀌고,
  // 매칭된 진짜 매출("정기 OO")과 원인 없는 단독 취소(진짜 환불)는 그대로 보인다.
  const washJournalIds = new Set<string>()
  if (journalIds.length > 0) {
    const { data: postings } = await supabase
      .from('timetable_payment_postings')
      .select('external_id, journal_id, payload')
      .in('journal_id', journalIds)
    const journalIdByExternalId = new Map<string, string>((postings ?? []).map((p: any) => [p.external_id, p.journal_id]))
    for (const p of (postings ?? []) as any[]) {
      const reversesId = p.payload?.reverses_external_id
      if (!reversesId) continue
      const originalJournalId = journalIdByExternalId.get(reversesId)
      if (originalJournalId && rowsByJournal.has(originalJournalId)) {
        washJournalIds.add(p.journal_id)
        washJournalIds.add(originalJournalId)
      }
    }
  }

  const rows: ProjectLedgerRow[] = [...rowsByJournal.values()]
    .filter(r => !washJournalIds.has(r.journalId))
    .map(r => {
      const vat = vatByJournal.get(r.journalId) ?? 0
      return { ...r, vat, gross: r.net + vat }
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const totalNet = rows.reduce((sum, r) => sum + r.net, 0)
  const totalVat = rows.reduce((sum, r) => sum + r.vat, 0)
  const totalGross = totalNet + totalVat

  return { monthKey, prevMonth, nextMonth, isCurrentMonth, rows, totalNet, totalVat, totalGross }
}
