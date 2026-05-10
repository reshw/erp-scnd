import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { syncLoanExecutions } from '@/lib/loans/syncExecutions'

// GET /api/loans/[id]/settlements → 해당 대출의 모든 확정 내역
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('loan_settlements')
    .select('*')
    .eq('loan_id', id)
    .order('month') as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/loans/[id]/settlements → 월 확정 (upsert)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await req.json()

  const { data, error } = await (supabase as any)
    .from('loan_settlements')
    .upsert({
      loan_id:          id,
      month:            body.month,
      actual_interest:  body.actual_interest,
      actual_repayment: body.actual_repayment ?? null,
      note:             body.note ?? null,
    }, { onConflict: 'loan_id,month' })
    .select()
    .single() as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await syncLoanExecutions(supabase, id)
  return NextResponse.json(data)
}

// DELETE /api/loans/[id]/settlements → 월 확정 취소
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { month } = await req.json()
  const { error } = await (supabase as any)
    .from('loan_settlements')
    .delete()
    .eq('loan_id', id)
    .eq('month', month) as any
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await syncLoanExecutions(supabase, id)
  return NextResponse.json({ ok: true })
}
