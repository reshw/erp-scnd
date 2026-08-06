import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope()
  if (scope.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 반려할 수 있습니다' }, { status: 403 })
  }

  const { id } = await params
  const { reason } = await req.json().catch(() => ({ reason: '' }))
  const supabase = createAdminClient() as any

  const { data: draft } = await supabase.from('journal_drafts').select('status').eq('id', id).single()
  if (!draft) return NextResponse.json({ error: '대기열 항목을 찾을 수 없습니다' }, { status: 404 })
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `이미 ${draft.status} 처리된 건입니다` }, { status: 400 })
  }

  const { error } = await supabase
    .from('journal_drafts')
    .update({ status: 'rejected', rejected_reason: reason || '사유 미입력', reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
