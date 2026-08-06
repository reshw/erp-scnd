import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import { withPoolerAdmin } from '@/lib/db/pooler'
import { NextRequest, NextResponse } from 'next/server'

/**
 * 강제 차단: revoked_at 세팅(RLS가 즉시 데이터 접근을 막음) +
 * DB role 자체를 NOLOGIN으로 바꿔 접속 자체를 차단 + 웹 계정 ban.
 * 이중으로 막아서 RLS 정책 하나가 실수로 뚫려도 접속 자체가 안 되게 한다.
 */
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
        await client.query(`ALTER ROLE ${row.db_role} NOLOGIN`)
      })
    } catch (e: any) {
      return NextResponse.json({ error: `DB role 차단 실패: ${e.message}` }, { status: 500 })
    }
  }

  if (row.auth_user_id) {
    const { error: banErr } = await supabase.auth.admin.updateUserById(row.auth_user_id, {
      ban_duration: '876000h', // 100년 — 사실상 영구 차단, 재활성화 시 reactivate로 해제
    })
    if (banErr) return NextResponse.json({ error: `웹 계정 차단 실패: ${banErr.message}` }, { status: 500 })
  }

  const { error: updateErr } = await supabase
    .from('staff_access')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
