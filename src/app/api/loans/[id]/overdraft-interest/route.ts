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
    .select('id')
    .eq('is_cancelled', false)
  if (loan.project_id) jq = jq.eq('project_id', loan.project_id)
  const { data: validJs } = await jq as any
  const validIds: string[] = (validJs ?? []).map((j: any) => j.id)

  if (validIds.length === 0) {
    return NextResponse.json({ dailyBalances: [], totalInterest: 0 })
  }

  // 기간 종료일까지의 모든 거래 조회
  const { data: allLines, error } = await (supabase as any)
    .from('journal_lines')
    .select('date, debit, credit')
    .eq('account_id', loan.account_id)
    .eq('counterparty_id', loan.counterparty_id)
    .in('journal_id', validIds)
    .lte('date', to)
    .order('date') as any

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const lines: { date: string; debit: number; credit: number }[] = allLines ?? []

  const annualRate = Number(loan.interest_rate)
  const includeDrawDay: boolean = loan.include_draw_day ?? true

  function applyRound(x: number): number {
    if (loan.interest_round === 'ceil')  return Math.ceil(x)
    if (loan.interest_round === 'floor') return Math.floor(x)
    return Math.round(x)
  }

  // 기간 시작 전 누적 잔액
  let balance = 0
  for (const l of lines.filter(l => l.date < from)) {
    balance += l.credit - l.debit
  }

  // 기간 내 날짜별 거래 그룹핑
  const byDate = new Map<string, { credit: number; debit: number }>()
  for (const l of lines.filter(l => l.date >= from)) {
    const existing = byDate.get(l.date) ?? { credit: 0, debit: 0 }
    byDate.set(l.date, {
      credit: existing.credit + Number(l.credit),
      debit:  existing.debit  + Number(l.debit),
    })
  }

  // 일별 잔액 × 이자 계산
  const dailyBalances: { date: string; balance: number; interest: number }[] = []
  let totalRawInterest = 0

  const start = new Date(from)
  const end = new Date(to)

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    const txn = byDate.get(dateStr)

    let balanceForInterest: number
    if (includeDrawDay) {
      // 당일 거래 후 잔액 기준
      if (txn) balance += txn.credit - txn.debit
      balanceForInterest = balance
    } else {
      // 당일 거래 전 잔액 기준 (익일 기산)
      balanceForInterest = balance
      if (txn) balance += txn.credit - txn.debit
    }

    const rawDaily = balanceForInterest * annualRate / 365
    totalRawInterest += rawDaily
    dailyBalances.push({
      date: dateStr,
      balance: balanceForInterest,
      interest: applyRound(rawDaily),
    })
  }

  return NextResponse.json({
    dailyBalances,
    totalInterest: applyRound(totalRawInterest),
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
