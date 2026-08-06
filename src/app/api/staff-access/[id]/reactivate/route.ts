import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import { withPoolerAdmin } from '@/lib/db/pooler'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope()
  if (scope.role !== 'admin') return NextResponse.json({ error: '관리자만 처리할 수 있습니다' }, { status: 403 })

  const { id } = await params
  const supabase = createAdminClient() as any

  const { data: row, error: fetchErr } = await supabase
    .from('staff_access')
    .select('id, db_role, auth_user_id')
    .eq('id', id)
    .single()
  if (fetchErr || !row) return NextResponse.json({ error: '항목을 찾을 수 없습니다' }, { status: 404 })

  if (row.db_role) {
    try {
      await withPoolerAdmin(async (client) => {
        await client.query(`ALTER ROLE ${row.db_role} LOGIN`)
      })
    } catch (e: any) {
      return NextResponse.json({ error: `DB role 재활성화 실패: ${e.message}` }, { status: 500 })
    }
  }

  if (row.auth_user_id) {
    const { error: unbanErr } = await supabase.auth.admin.updateUserById(row.auth_user_id, { ban_duration: 'none' })
    if (unbanErr) return NextResponse.json({ error: `웹 계정 재활성화 실패: ${unbanErr.message}` }, { status: 500 })
  }

  const { error: updateErr } = await supabase
    .from('staff_access')
    .update({ revoked_at: null })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
