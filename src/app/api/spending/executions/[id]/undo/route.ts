import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/spending/executions/[id]/undo
// body: { cancel_journal: boolean }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient()
  const { cancel_journal } = await req.json()

  // 현재 execution 조회
  const { data: ex } = await (supabase as any)
    .from('spending_executions')
    .select('id, status, journal_id')
    .eq('id', id)
    .single() as any

  if (!ex || ex.status !== 'executed') {
    return NextResponse.json({ error: '집행 완료 항목이 아닙니다' }, { status: 400 })
  }

  // 전표 취소
  if (cancel_journal && ex.journal_id) {
    await (supabase as any)
      .from('journals')
      .update({ is_cancelled: true })
      .eq('id', ex.journal_id)
  }

  // execution → pending 복구
  await (supabase as any)
    .from('spending_executions')
    .update({
      status:      'pending',
      journal_id:  null,
      executed_at: null,
    })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
