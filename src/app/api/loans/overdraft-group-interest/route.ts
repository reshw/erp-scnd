import { createAdminClient } from '@/lib/supabase/admin'
import { calcGroupOverdraftInterest, postOverdraftInterestJournal } from '@/lib/loans/overdraftInterest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/loans/overdraft-group-interest?loanId=&from=&to=&actualTotal=
 *
 * 같은 마통(계좌+거래처)을 나눠쓰는 대출 그룹의 이자를 계산 미리보기한다.
 * "정액" 대출(loans.is_interest_residual=false)은 기존 정밀계산(일별잔액×금리이력)을 쓰고,
 * "잔여" 대출(is_interest_residual=true, 정확히 1개)은 실제 청구총액에서 정액 합을 뺀 나머지.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const loanId = searchParams.get('loanId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const actualTotal = Number(searchParams.get('actualTotal'))

  if (!loanId || !from || !to) return NextResponse.json({ error: 'loanId, from, to 필수' }, { status: 400 })
  if (!Number.isFinite(actualTotal)) return NextResponse.json({ error: 'actualTotal이 숫자가 아닙니다' }, { status: 400 })

  const supabase = createAdminClient()
  const result = await calcGroupOverdraftInterest(supabase, { loanId, from, to, actualTotal })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}

/**
 * POST /api/loans/overdraft-group-interest
 * body: { loanId, from, to, actualTotal, month }
 * 그룹 전체(정액 N개 + 잔여 1개)에 대해 이자비용 전표를 각각 발행한다.
 */
export async function POST(req: NextRequest) {
  const { loanId, from, to, actualTotal, month } = await req.json()
  if (!loanId || !from || !to || !month) {
    return NextResponse.json({ error: 'loanId, from, to, month 필수' }, { status: 400 })
  }
  if (!Number.isFinite(actualTotal)) return NextResponse.json({ error: 'actualTotal이 숫자가 아닙니다' }, { status: 400 })

  const supabase = createAdminClient()
  const calc = await calcGroupOverdraftInterest(supabase, { loanId, from, to, actualTotal })
  if ('error' in calc) return NextResponse.json({ error: calc.error }, { status: 400 })

  const posted: { loan_id: string; loan_name: string; interest: number; journal_id: string }[] = []
  for (const entry of calc.breakdown) {
    if (entry.interest === 0) continue
    const result = await postOverdraftInterestJournal(supabase, {
      loanId: entry.loan_id, from, to, interest: entry.interest, month,
    })
    if ('error' in result) {
      return NextResponse.json({ error: `${entry.loan_name}: ${result.error}`, posted }, { status: 500 })
    }
    posted.push({ loan_id: entry.loan_id, loan_name: entry.loan_name, interest: entry.interest, journal_id: result.journalId })
  }

  return NextResponse.json({ ok: true, posted })
}
