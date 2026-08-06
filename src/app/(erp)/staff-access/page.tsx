import { createAdminClient } from '@/lib/supabase/admin'
import CreateForm from './CreateForm'
import AccessActions from './AccessActions'

export const dynamic = 'force-dynamic'

export default async function StaffAccessPage() {
  const supabase = createAdminClient() as any

  const [{ data: projects }, { data: rows }] = await Promise.all([
    supabase.from('projects').select('id, code').eq('is_active', true).order('code'),
    supabase
      .from('staff_access')
      .select('id, label, db_role, auth_user_id, created_at, revoked_at, projects(code)')
      .order('created_at', { ascending: false }),
  ])

  const emailByUserId: Record<string, string> = {}
  for (const r of (rows ?? []) as any[]) {
    if (r.auth_user_id && !emailByUserId[r.auth_user_id]) {
      const { data } = await supabase.auth.admin.getUserById(r.auth_user_id)
      if (data?.user?.email) emailByUserId[r.auth_user_id] = data.user.email
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">직원 접근 관리</h2>
        <p className="text-sm text-gray-500 mt-0.5">직원용 AI DB 키·웹 로그인 발급/차단</p>
      </div>

      <CreateForm projects={projects ?? []} />

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">이름표</th>
              <th className="text-left px-3 py-2">프로젝트</th>
              <th className="text-left px-3 py-2">DB 키</th>
              <th className="text-left px-3 py-2">웹 로그인</th>
              <th className="text-left px-3 py-2">상태</th>
              <th className="text-right px-3 py-2">발급일</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(rows ?? []).map((r: any) => (
              <tr key={r.id} className={r.revoked_at ? 'opacity-40' : ''}>
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2">{r.projects?.code ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.db_role ?? '-'}</td>
                <td className="px-3 py-2 text-xs">{r.auth_user_id ? (emailByUserId[r.auth_user_id] ?? '-') : '-'}</td>
                <td className="px-3 py-2">
                  {r.revoked_at
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">차단됨</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">활성</span>}
                </td>
                <td className="px-3 py-2 text-right text-xs text-gray-400">{r.created_at?.slice(0, 10)}</td>
                <td className="px-3 py-2 text-right">
                  <AccessActions id={r.id} revoked={!!r.revoked_at} />
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">발급 내역 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
