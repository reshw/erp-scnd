import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/loans/[id]/bulk-execute
 * body: { months: [{ month: 'YYYY-MM', interest: number, repayment: number }] }
 *
 * 각 month별:
 *  1. loan_settlements upsert
 *  2. journals INSERT (이자비용 차변 / 보통예금 대변)
 *  3. loan_settlements.journal_id 업데이트
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { months } = await req.json() as {
    months: { month: string; interest: number; repayment: number }[]
  }

  if (!months?.length) return NextResponse.json({ error: '처리할 월이 없습니다' }, { status: 400 })

  // 대출 정보 조회 (project_id 필요)
  const { data: loan, error: loanErr } = await (supabase as any)
    .from('loans').select('project_id').eq('id', id).single() as any
  if (loanErr) return NextResponse.json({ error: loanErr.message }, { status: 500 })

  // 이자비용 / 보통예금 계정 ID 조회
  const { data: accounts } = await (supabase as any)
    .from('accounts')
    .select('id, name')
    .in('name', ['이자비용', '보통예금']) as any
  const interestAcc = accounts?.find((a: any) => a.name === '이자비용')
  const bankAcc     = accounts?.find((a: any) => a.name === '보통예금')
  if (!interestAcc || !bankAcc) {
    return NextResponse.json({ error: '이자비용 또는 보통예금 계정을 찾을 수 없습니다' }, { status: 500 })
  }

  // 현재 최대 journal_no
  const { data: lastJ } = await (supabase as any)
    .from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single() as any
  let nextNo: number = (lastJ?.journal_no ?? 0) + 1

  const results: { month: string; journalId: string }[] = []

  for (const { month, interest, repayment } of months) {
    // 납부일: month의 마지막날 (또는 대출 payment_day 사용 가능하나 단순화)
    const date = `${month}-01`  // 전표 날짜는 해당월 1일 (추후 payment_day 기준 개선 가능)

    // 1. settlement upsert
    const { data: settlement, error: se } = await (supabase as any)
      .from('loan_settlements')
      .upsert({
        loan_id:          id,
        month,
        actual_interest:  interest,
        actual_repayment: repayment || null,
      }, { onConflict: 'loan_id,month' })
      .select('id')
      .single() as any
    if (se) return NextResponse.json({ error: `${month} settlement 오류: ${se.message}` }, { status: 500 })

    // 2. journal 생성 (이자비용 차변 / 보통예금 대변)
    const lines = [
      { account_id: interestAcc.id, debit: interest,  credit: 0,        type: '영업', subtype: '금융비용', description: `이자 ${month}` },
      { account_id: bankAcc.id,     debit: 0,          credit: interest, type: '현금', subtype: '출금',     description: `이자 ${month}` },
    ]
    const { data: journal, error: je } = await (supabase as any)
      .from('journals')
      .insert({ journal_no: nextNo++, date, project_id: loan.project_id, description: `이자비용 ${month}` })
      .select('id')
      .single() as any
    if (je) return NextResponse.json({ error: `${month} journal 오류: ${je.message}` }, { status: 500 })

    await (supabase as any).from('journal_lines').insert(lines.map((l: any) => ({ ...l, journal_id: journal.id })))

    // 3. settlement에 journal_id 연결
    await (supabase as any).from('loan_settlements').update({ journal_id: journal.id }).eq('id', settlement.id)

    results.push({ month, journalId: journal.id })
  }

  return NextResponse.json({ ok: true, results })
}
