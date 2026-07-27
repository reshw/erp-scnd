import { createAdminClient } from '@/lib/supabase/admin'
import { calcOverdraftInterest, postOverdraftInterestJournal } from '@/lib/loans/overdraftInterest'
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
  const result = await calcOverdraftInterest(supabase, id, from, to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}

/**
 * POST /api/loans/[id]/overdraft-interest
 * body: { from, to, date, interest, month } — date는 부과일(전표 날짜), to와 다를 수 있음
 * 이자비용 전표 발행
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { from, to, date, interest, month } = await req.json()
  if (!date) return NextResponse.json({ error: 'date(부과일)가 필요합니다' }, { status: 400 })

  const result = await postOverdraftInterestJournal(supabase, { loanId: id, from, to, date, interest, month })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true, journalId: result.journalId })
}
