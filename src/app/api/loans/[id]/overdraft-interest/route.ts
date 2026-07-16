import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/loans/[id]/overdraft-interest?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 기간 내 일별잔액 + 이자 합계 계산
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from, to 필수' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: loan } = await (supabase as any)
    .from('loans')
    .select('account_id, counterparty_id, project_id, interest_rate, include_draw_day, interest_round')
    .eq('id', id)
    .single() as any

  if (!loan?.account_id || !loan?.counterparty_id) {
    return NextResponse.json({ error: '계정과목 또는 거래처가 설정되지 않았습니다' }, { status: 400 })
  }

  // 유효 journal_id 목록 확보 (취소 제외 + 프로젝트 필터)
  let jq = (supabase as any)
    .from('journals')
    .select('id, project_id')
    .eq('is_cancelled', false)
  if (loan.project_id) jq = jq.eq('project_id', loan.project_id)
  const { data: validJs } = await jq as any
  const validIds: string[] = (validJs ?? []).map((j: any) => j.id)
  const journalProject: Record<string, string | null> = {}
  for (const j of (validJs ?? [])) journalProject[j.id] = j.project_id

  if (validIds.length === 0) {
    return NextResponse.json({ dailyBalances: [], totalInterest: 0, projectBreakdown: [] })
  }

  // 기간 종료일까지의 모든 거래 조회
  const { data: allLines, error } = await (supabase as any)
    .from('journal_lines')
    .select('date, debit, credit, journal_id')
    .eq('account_id', loan.account_id)
    .eq('counterparty_id', loan.counterparty_id)
    .in('journal_id', validIds)
    .lte('date', to)
    .order('date') as any

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const lines: { date: string; debit: number; credit: number; journal_id: string }[] = allLines ?? []

  const annualRate = Number(loan.interest_rate)
  const includeDrawDay: boolean = loan.include_draw_day ?? true

  // 금리 변동 이력 (effective_date 당일부터 적용, 이전 기간은 loans.interest_rate)
  const { data: rateRows } = await (supabase as any)
    .from('loan_rate_history')
    .select('effective_date, annual_rate')
    .eq('loan_id', id)
    .order('effective_date') as any
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
    if (loan.interest_round === 'ceil')  return Math.ceil(x)
    if (loan.interest_round === 'floor') return Math.floor(x)
    return Math.round(x)
  }

  // 프로젝트별 분해 준비 (키: project_id ?? '__none__')
  const projKey = (l: { journal_id: string }) => journalProject[l.journal_id] ?? '__none__'
  const projKeys = new Set<string>(lines.map(projKey))

  // 기간 시작 전 누적 잔액 (전체 + 프로젝트별)
  let balance = 0
  const balanceByProj: Record<string, number> = {}
  for (const l of lines.filter(l => l.date < from)) {
    const amt = l.credit - l.debit
    balance += amt
    balanceByProj[projKey(l)] = (balanceByProj[projKey(l)] ?? 0) + amt
  }

  // 기간 내 날짜별 거래 그룹핑 (전체 + 프로젝트별)
  const byDate = new Map<string, { credit: number; debit: number }>()
  const byDateProj = new Map<string, Record<string, number>>()
  for (const l of lines.filter(l => l.date >= from)) {
    const existing = byDate.get(l.date) ?? { credit: 0, debit: 0 }
    byDate.set(l.date, {
      credit: existing.credit + Number(l.credit),
      debit:  existing.debit  + Number(l.debit),
    })
    const dp = byDateProj.get(l.date) ?? {}
    dp[projKey(l)] = (dp[projKey(l)] ?? 0) + Number(l.credit) - Number(l.debit)
    byDateProj.set(l.date, dp)
  }

  // 일별 잔액 × 이자 계산
  const dailyBalances: { date: string; balance: number; interest: number; rate: number }[] = []
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

    // includeDrawDay: 당일 거래 후 잔액 기준 / 아니면 당일 거래 전 잔액 기준 (익일 기산)
    if (includeDrawDay) applyTxns()
    const balanceForInterest = balance
    for (const k of projKeys) rawByProj[k] = (rawByProj[k] ?? 0) + (balanceByProj[k] ?? 0) * dayRate / 365
    if (!includeDrawDay) applyTxns()

    const rawDaily = balanceForInterest * dayRate / 365
    totalRawInterest += rawDaily
    dailyBalances.push({
      date: dateStr,
      balance: balanceForInterest,
      interest: applyRound(rawDaily),
      rate: dayRate,
    })
  }

  const totalInterest = applyRound(totalRawInterest)

  // ── 프로젝트별 이자 분해 (전표의 프로젝트 귀속 기반) ──
  const { data: projRows } = await (supabase as any).from('projects').select('id, code') as any
  const codeMap: Record<string, string> = Object.fromEntries((projRows ?? []).map((p: any) => [p.id, p.code]))

  const projectBreakdown = [...projKeys]
    .map(k => ({
      project_id: k === '__none__' ? null : k,
      project_code: k === '__none__' ? '(프로젝트 없음)' : (codeMap[k] ?? k),
      interest: applyRound(rawByProj[k] ?? 0),
    }))
    .filter(p => p.interest !== 0)
    .sort((a, b) => b.interest - a.interest)

  // 반올림 오차 보정: 분해 합계가 전체 이자와 정확히 일치하도록 최대 항목에서 조정
  const bdSum = projectBreakdown.reduce((s, p) => s + p.interest, 0)
  if (projectBreakdown.length > 0 && bdSum !== totalInterest) {
    projectBreakdown[0].interest += totalInterest - bdSum
  }

  return NextResponse.json({
    dailyBalances,
    totalInterest,
    projectBreakdown,
  })
}

/**
 * POST /api/loans/[id]/overdraft-interest
 * body: { from, to, interest, month }
 * 이자비용 전표 발행
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { from, to, interest, month } = await req.json()

  const { data: loan } = await (supabase as any)
    .from('loans')
    .select('project_id, counterparty_id')
    .eq('id', id)
    .single() as any

  // 이자비용 / 보통예금 계정 조회
  const { data: accountRows } = await (supabase as any)
    .from('accounts')
    .select('id, name, increase_label, decrease_label')
    .in('name', ['이자비용', '보통예금']) as any
  const interestAcc = accountRows?.find((a: any) => a.name === '이자비용')
  const bankAcc     = accountRows?.find((a: any) => a.name === '보통예금')
  if (!interestAcc || !bankAcc) {
    return NextResponse.json({ error: '이자비용 또는 보통예금 계정을 찾을 수 없습니다' }, { status: 500 })
  }

  const { data: lastJ } = await (supabase as any)
    .from('journals')
    .select('journal_no')
    .order('journal_no', { ascending: false })
    .limit(1)
    .single() as any
  const nextNo = (lastJ?.journal_no ?? 0) + 1

  const { data: journal, error: je } = await (supabase as any)
    .from('journals')
    .insert({
      journal_no: nextNo,
      date: to,
      project_id: loan?.project_id ?? null,
      description: `마통 이자비용 ${month}`,
    })
    .select('id')
    .single() as any
  if (je) return NextResponse.json({ error: je.message }, { status: 500 })

  const note = `마통 이자 ${month} (${from}~${to})`
  const { error: le } = await (supabase as any)
    .from('journal_lines')
    .insert([
      {
        journal_id:       journal.id,
        date:             to,
        account_id:       interestAcc.id,
        classification:   interestAcc.increase_label,
        activity_type:    interestAcc.increase_label.split(' - ')[0],
        activity_subtype: interestAcc.increase_label.split(' - ')[1] ?? '',
        debit:            interest,
        credit:           0,
        counterparty_id:  loan?.counterparty_id ?? null,
        note,
      },
      {
        journal_id:       journal.id,
        date:             to,
        account_id:       bankAcc.id,
        classification:   bankAcc.decrease_label,
        activity_type:    bankAcc.decrease_label.split(' - ')[0],
        activity_subtype: bankAcc.decrease_label.split(' - ')[1] ?? '',
        debit:            0,
        credit:           interest,
        counterparty_id:  loan?.counterparty_id ?? null,
        note,
      },
    ]) as any
  if (le) return NextResponse.json({ error: le.message }, { status: 500 })

  return NextResponse.json({ ok: true, journalId: journal.id })
}
