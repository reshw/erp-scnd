import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getScope } from '@/lib/auth/scope'
import { NextRequest, NextResponse } from 'next/server'

/**
 * 상신자 본인이 자기 pending 대기열을 취소. 관리자 반려(reject)와 달리 사유 입력 없이
 * 단건 취소만 허용 — 관리자도 호출 가능하지만 주 사용자는 상신 당사자(/staff/drafts)다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope()
  const { id } = await params
  const supabase = createAdminClient() as any

  const { data: draft, error: de } = await supabase
    .from('journal_drafts')
    .select('id, status, project_id, created_by_role')
    .eq('id', id)
    .single()
  if (de || !draft) return NextResponse.json({ error: '대기열 항목을 찾을 수 없습니다' }, { status: 404 })

  if (scope.role !== 'admin') {
    if (draft.project_id !== scope.allowedProjectId) {
      return NextResponse.json({ error: '본인 상신 건만 취소할 수 있습니다' }, { status: 403 })
    }
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    const { data: access } = await supabase
      .from('staff_access')
      .select('db_role')
      .eq('auth_user_id', user?.id ?? '')
      .eq('project_id', scope.allowedProjectId)
      .maybeSingle()
    if (!access?.db_role || access.db_role !== draft.created_by_role) {
      return NextResponse.json({ error: '본인 상신 건만 취소할 수 있습니다' }, { status: 403 })
    }
  }

  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `이미 ${draft.status} 처리된 건입니다` }, { status: 400 })
  }

  const { error } = await supabase
    .from('journal_drafts')
    .update({ status: 'cancelled', reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
