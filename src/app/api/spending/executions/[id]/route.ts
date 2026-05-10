import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// PATCH: 금액/메모 수정 (집행 전 확정 조정용)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await req.json()

  const update: Record<string, any> = {}
  if (body.amount    !== undefined) update.amount    = body.amount
  if (body.interest  !== undefined) update.interest  = body.interest
  if (body.repayment !== undefined) update.repayment = body.repayment
  if (body.note      !== undefined) update.note      = body.note

  const { error } = await (supabase as any)
    .from('spending_executions')
    .update(update)
    .eq('id', id)
    .eq('status', 'pending') as any  // 집행 전 항목만 수정 가능

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
