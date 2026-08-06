import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import { withPoolerAdmin, isValidRoleName } from '@/lib/db/pooler'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'agent'
  const suffix = crypto.randomBytes(3).toString('hex')
  return `${base}_${suffix}`
}

/**
 * 신규 직원 발급: AI용 DB 키(Postgres role) + 웹 로그인 계정을 한 번에 만들고
 * staff_access 행으로 묶는다. 비밀번호는 이 응답에서만 평문으로 내려주고 서버에
 * 저장하지 않는다 — 관리자가 그 자리에서 복사해 직원에게 전달해야 한다.
 */
export async function POST(req: NextRequest) {
  const scope = await getScope()
  if (scope.role !== 'admin') return NextResponse.json({ error: '관리자만 발급할 수 있습니다' }, { status: 403 })

  const { label, project_id, email, issue_db_key, issue_web_login } = await req.json()
  if (!label || !project_id) {
    return NextResponse.json({ error: 'label, project_id는 필수입니다' }, { status: 400 })
  }
  if (!issue_db_key && !issue_web_login) {
    return NextResponse.json({ error: 'DB 키 또는 웹 로그인 중 하나는 발급해야 합니다' }, { status: 400 })
  }
  if (issue_web_login && !email) {
    return NextResponse.json({ error: '웹 로그인을 발급하려면 email이 필요합니다' }, { status: 400 })
  }

  const supabase = createAdminClient() as any
  const result: Record<string, string> = {}

  let dbRole: string | null = null
  let dbPassword: string | null = null
  if (issue_db_key) {
    dbRole = slugify(label)
    if (!isValidRoleName(dbRole)) {
      return NextResponse.json({ error: '생성된 role 이름이 유효하지 않습니다' }, { status: 500 })
    }
    dbPassword = crypto.randomBytes(16).toString('hex')

    try {
      await withPoolerAdmin(async (client) => {
        await client.query(`CREATE ROLE ${dbRole} LOGIN PASSWORD '${dbPassword!.replace(/'/g, "''")}'`)
        await client.query(`GRANT project_scoped_agent TO ${dbRole}`)
      })
    } catch (e: any) {
      return NextResponse.json({ error: `DB role 생성 실패: ${e.message}` }, { status: 500 })
    }

    result.db_role = dbRole
    result.db_password = dbPassword
    result.pg_host = 'aws-1-ap-northeast-2.pooler.supabase.com'
    result.pg_user = `${dbRole}.cyblyfitotnnwzfndpfx`
  }

  let authUserId: string | null = null
  if (issue_web_login) {
    const webPassword = crypto.randomBytes(9).toString('base64url')
    const { data: created, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: webPassword,
      email_confirm: true,
      app_metadata: { role: 'employee', allowed_project_id: project_id },
    })
    if (authErr) {
      // DB role은 이미 만들어졌으니 롤백(정리)
      if (dbRole) {
        await withPoolerAdmin(async (client) => {
          await client.query(`DROP ROLE IF EXISTS ${dbRole}`)
        }).catch(() => {})
      }
      return NextResponse.json({ error: `웹 계정 생성 실패: ${authErr.message}` }, { status: 500 })
    }
    authUserId = created.user.id
    result.email = email
    result.web_password = webPassword
  }

  const { data: accessRow, error: insertErr } = await supabase
    .from('staff_access')
    .insert({ label, project_id, db_role: dbRole, auth_user_id: authUserId })
    .select()
    .single()

  if (insertErr) {
    return NextResponse.json({ error: `staff_access 등록 실패: ${insertErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, staff_access_id: accessRow.id, ...result })
}

export async function GET() {
  const scope = await getScope()
  if (scope.role !== 'admin') return NextResponse.json({ error: '관리자만 조회할 수 있습니다' }, { status: 403 })

  const supabase = createAdminClient() as any
  const { data, error } = await supabase
    .from('staff_access')
    .select('id, label, project_id, db_role, auth_user_id, created_at, revoked_at, projects(code)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
