import { createClient } from '@/lib/supabase/server'

export type Scope =
  | { role: 'admin' }
  | { role: 'employee'; allowedProjectId: string }

/**
 * 로그인 세션의 app_metadata에서 역할/프로젝트 스코프를 읽는다.
 * role 키가 없으면(기존 계정) admin으로 취급 — 신규 직원 계정만 명시적으로 employee 부여.
 */
export async function getScope(): Promise<Scope> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const role = user?.app_metadata?.role
  if (role === 'employee') {
    const allowedProjectId = user?.app_metadata?.allowed_project_id
    if (typeof allowedProjectId === 'string' && allowedProjectId) {
      return { role: 'employee', allowedProjectId }
    }
    // employee인데 project 매핑이 없으면 안전측(admin 아님, 아무 것도 못 보는 스코프로) —
    // 존재하지 않는 project id를 줘서 모든 project_id 필터가 자연히 0건이 되게 한다.
    return { role: 'employee', allowedProjectId: '00000000-0000-0000-0000-000000000000' }
  }

  return { role: 'admin' }
}
