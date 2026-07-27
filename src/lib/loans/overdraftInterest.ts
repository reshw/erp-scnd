import type { SupabaseClient } from '@supabase/supabase-js'

export type DailyBalance = { date: string; balance: number; interest: number; rate: number }
export type ProjectInterest = { project_id: string | null; project_code: string; interest: number }
export type OverdraftCalcResult = {
  dailyBalances: DailyBalance[]
  totalInterest: number
  projectBreakdown: ProjectInterest[]
}

/**
 * 마통(또는 일반 대출)의 일별잔액×연이율로 기간 이자를 계산한다.
 * `/api/loans/[id]/overdraft-interest` GET과 그룹 이자 등록(overdraft-group-interest)이 공유한다.
 */
export async function calcOverdraftInterest(
  supabase: SupabaseClient<any>,
  loanId: string,
  from: string,
  to: string
): Promise<OverdraftCalcResult | { error: string }> {
  const db = supabase as any

  const { data: loan } = await db
    .from('loans')
    .select('account_id, counterparty_id, project_id, interest_rate, include_draw_day, interest_round')
    .eq('id', loanId)
    .single()

  if (!loan?.account_id || !loan?.counterparty_id) {
    return { error: '계정과목 또는 거래처가 설정되지 않았습니다' }
  }

  let jq = db.from('journals').select('id, project_id').eq('is_cancelled', false)
  if (loan.project_id) jq = jq.eq('project_id', loan.project_id)
  const { data: validJs } = await jq
  const validIds: string[] = (validJs ?? []).map((j: any) => j.id)
  const journalProject: Record<string, string | null> = {}
  for (const j of (validJs ?? [])) journalProject[j.id] = j.project_id

  if (validIds.length === 0) {
    return { dailyBalances: [], totalInterest: 0, projectBreakdown: [] }
  }

  const { data: allLines, error } = await db
    .from('journal_lines')
    .select('date, debit, credit, journal_id')
    .eq('account_id', loan.account_id)
    .eq('counterparty_id', loan.counterparty_id)
    .in('journal_id', validIds)
    .lte('date', to)
    .order('date')

  if (error) return { error: error.message }
  const lines: { date: string; debit: number; credit: number; journal_id: string }[] = allLines ?? []

  const annualRate = Number(loan.interest_rate)
  const includeDrawDay: boolean = loan.include_draw_day ?? true

  const { data: rateRows } = await db
    .from('loan_rate_history')
    .select('effective_date, annual_rate')
    .eq('loan_id', loanId)
    .order('effective_date')
  const rateChanges: { effective_date: string; annual_rate: number }[] = rateRows ?? []

  function rateFor(dateStr: string): number {
    let r = annualRate
    for (const rc of rateChanges) {
      if (rc.effective_date <= dateStr) r = Number(rc.annual_rate)
      else break
    }
    return r
  }

  function applyRound(x: number): number {
    if (loan.interest_round === 'ceil') return Math.ceil(x)
    if (loan.interest_round === 'floor') return Math.floor(x)
    return Math.round(x)
  }

  const projKey = (l: { journal_id: string }) => journalProject[l.journal_id] ?? '__none__'
  const projKeys = new Set<string>(lines.map(projKey))

  let balance = 0
  const balanceByProj: Record<string, number> = {}
  for (const l of lines.filter(l => l.date < from)) {
    const amt = l.credit - l.debit
    balance += amt
    balanceByProj[projKey(l)] = (balanceByProj[projKey(l)] ?? 0) + amt
  }

  const byDate = new Map<string, { credit: number; debit: number }>()
  const byDateProj = new Map<string, Record<string, number>>()
  for (const l of lines.filter(l => l.date >= from)) {
    const existing = byDate.get(l.date) ?? { credit: 0, debit: 0 }
    byDate.set(l.date, {
      credit: existing.credit + Number(l.credit),
      debit: existing.debit + Number(l.debit),
    })
    const dp = byDateProj.get(l.date) ?? {}
    dp[projKey(l)] = (dp[projKey(l)] ?? 0) + Number(l.credit) - Number(l.debit)
    byDateProj.set(l.date, dp)
  }

  const dailyBalances: DailyBalance[] = []
  let totalRawInterest = 0
  const rawByProj: Record<string, number> = {}

  const start = new Date(from)
  const end = new Date(to)

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    const txn = byDate.get(dateStr)
    const projTxn = byDateProj.get(dateStr)
    const dayRate = rateFor(dateStr)

    const applyTxns = () => {
      if (txn) balance += txn.credit - txn.debit
      if (projTxn) for (const [k, v] of Object.entries(projTxn)) balanceByProj[k] = (balanceByProj[k] ?? 0) + v
    }

    if (includeDrawDay) applyTxns()
    const balanceForInterest = balance
    for (const k of projKeys) rawByProj[k] = (rawByProj[k] ?? 0) + (balanceByProj[k] ?? 0) * dayRate / 365
    if (!includeDrawDay) applyTxns()

    const rawDaily = balanceForInterest * dayRate / 365
    totalRawInterest += rawDaily
    dailyBalances.push({ date: dateStr, balance: balanceForInterest, interest: applyRound(rawDaily), rate: dayRate })
  }

  const totalInterest = applyRound(totalRawInterest)

  const { data: projRows } = await db.from('projects').select('id, code')
  const codeMap: Record<string, string> = Object.fromEntries((projRows ?? []).map((p: any) => [p.id, p.code]))

  const projectBreakdown = [...projKeys]
    .map(k => ({
      project_id: k === '__none__' ? null : k,
      project_code: k === '__none__' ? '(프로젝트 없음)' : (codeMap[k] ?? k),
      interest: applyRound(rawByProj[k] ?? 0),
    }))
    .filter(p => p.interest !== 0)
    .sort((a, b) => b.interest - a.interest)

  const bdSum = projectBreakdown.reduce((s, p) => s + p.interest, 0)
  if (projectBreakdown.length > 0 && bdSum !== totalInterest) {
    projectBreakdown[0].interest += totalInterest - bdSum
  }

  return { dailyBalances, totalInterest, projectBreakdown }
}

/**
 * 대출 하나에 대해 이자비용 전표(차변 이자비용 / 대변 보통예금)를 발행한다.
 * `/api/loans/[id]/overdraft-interest` POST와 그룹 이자 등록이 공유한다.
 */
export async function postOverdraftInterestJournal(
  supabase: SupabaseClient<any>,
  params: { loanId: string; from: string; to: string; date: string; interest: number; month: string }
): Promise<{ journalId: string } | { error: string }> {
  const db = supabase as any
  const { loanId, from, to, date, interest, month } = params

  const { data: loan } = await db.from('loans').select('project_id, counterparty_id').eq('id', loanId).single()

  const { data: accountRows } = await db
    .from('accounts')
    .select('id, name, increase_label, decrease_label')
    .in('name', ['이자비용', '보통예금'])
  const interestAcc = accountRows?.find((a: any) => a.name === '이자비용')
  const bankAcc = accountRows?.find((a: any) => a.name === '보통예금')
  if (!interestAcc || !bankAcc) return { error: '이자비용 또는 보통예금 계정을 찾을 수 없습니다' }

  const { data: lastJ } = await db.from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single()
  const nextNo = (lastJ?.journal_no ?? 0) + 1

  const { data: journal, error: je } = await db
    .from('journals')
    .insert({ journal_no: nextNo, date, project_id: loan?.project_id ?? null, description: `마통 이자비용 ${month}` })
    .select('id')
    .single()
  if (je) return { error: je.message }

  const note = `마통 이자 ${month} (${from}~${to})`
  const { error: le } = await db.from('journal_lines').insert([
    {
      journal_id: journal.id, date, account_id: interestAcc.id,
      classification: interestAcc.increase_label,
      activity_type: interestAcc.increase_label.split(' - ')[0],
      activity_subtype: interestAcc.increase_label.split(' - ')[1] ?? '',
      debit: interest, credit: 0, counterparty_id: loan?.counterparty_id ?? null, note,
    },
    {
      journal_id: journal.id, date, account_id: bankAcc.id,
      classification: bankAcc.decrease_label,
      activity_type: bankAcc.decrease_label.split(' - ')[0],
      activity_subtype: bankAcc.decrease_label.split(' - ')[1] ?? '',
      debit: 0, credit: interest, counterparty_id: loan?.counterparty_id ?? null, note,
    },
  ])
  if (le) return { error: le.message }

  return { journalId: journal.id }
}

export type GroupBreakdownEntry = {
  loan_id: string
  loan_name: string
  project_code: string | null
  interest: number
  is_residual: boolean
}

/**
 * 같은 계좌+거래처를 나눠쓰는 마통 그룹의 이자를 "정액"(정밀계산) + "잔여"(실제 청구총액 -
 * 정액합)로 나눈다. 잔여는 정확히 1개 대출이어야 한다(모호하면 에러).
 */
export async function calcGroupOverdraftInterest(
  supabase: SupabaseClient<any>,
  params: { loanId: string; from: string; to: string; actualTotal: number }
): Promise<{ breakdown: GroupBreakdownEntry[]; fixedSum: number; residualAmount: number } | { error: string }> {
  const db = supabase as any
  const { loanId, from, to, actualTotal } = params

  const { data: anchor } = await db.from('loans').select('account_id, counterparty_id').eq('id', loanId).single()
  if (!anchor?.account_id || !anchor?.counterparty_id) {
    return { error: '계정과목 또는 거래처가 설정되지 않았습니다' }
  }

  const { data: group } = await db
    .from('loans')
    .select('id, name, project_id, is_interest_residual, projects(code)')
    .eq('account_id', anchor.account_id)
    .eq('counterparty_id', anchor.counterparty_id)

  const loans = group ?? []
  const residuals = loans.filter((l: any) => l.is_interest_residual)
  const fixed = loans.filter((l: any) => !l.is_interest_residual)

  if (residuals.length !== 1) {
    return { error: `잔여 프로젝트가 ${residuals.length}개입니다 — 정확히 1개여야 합니다 (loans.is_interest_residual 확인)` }
  }

  const breakdown: GroupBreakdownEntry[] = []
  let fixedSum = 0

  for (const l of fixed) {
    const calc = await calcOverdraftInterest(supabase, l.id, from, to)
    if ('error' in calc) return { error: `${l.name}: ${calc.error}` }
    fixedSum += calc.totalInterest
    breakdown.push({
      loan_id: l.id,
      loan_name: l.name,
      project_code: l.projects?.code ?? null,
      interest: calc.totalInterest,
      is_residual: false,
    })
  }

  const residualAmount = actualTotal - fixedSum
  const r = residuals[0]
  breakdown.push({
    loan_id: r.id,
    loan_name: r.name,
    project_code: r.projects?.code ?? null,
    interest: residualAmount,
    is_residual: true,
  })

  return { breakdown, fixedSum, residualAmount }
}
