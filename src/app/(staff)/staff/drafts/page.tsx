import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getScope } from '@/lib/auth/scope'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending:  { text: '대기중',  className: 'bg-yellow-50 text-yellow-700' },
  approved: { text: '승인됨',  className: 'bg-green-50 text-green-700' },
  rejected: { text: '반려됨',  className: 'bg-red-50 text-red-700' },
}

export default async function StaffDraftsPage() {
  const scope = await getScope()
  if (scope.role !== 'employee') return null
  const supabase = createAdminClient()

  // 이 웹 로그인 계정에 매핑된 AI용 DB role(db_role)을 찾아 그 role이 올린 draft만 보여준다.
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  const { data: access } = await (supabase as any)
    .from('staff_access')
    .select('db_role')
    .eq('auth_user_id', user?.id ?? '')
    .eq('project_id', scope.allowedProjectId)
    .maybeSingle()

  let draftsQuery = (supabase as any)
    .from('journal_drafts')
    .select('id, date, description, status, rejected_reason, approved_journal_id, created_by_role, created_at, journals(journal_no)')
    .eq('project_id', scope.allowedProjectId)
    .order('created_at', { ascending: false })
  if (access?.db_role) draftsQuery = draftsQuery.eq('created_by_role', access.db_role)

  const { data: draftsData } = access?.db_role ? await draftsQuery : { data: [] }
  const drafts = (draftsData ?? []) as any[]

  const draftIds = drafts.map(d => d.id)
  const { data: linesRaw } = draftIds.length
    ? await supabase.from('journal_draft_lines').select('draft_id, debit').in('draft_id', draftIds)
    : { data: [] }
  const totalByDraft: Record<string, number> = {}
  for (const l of (linesRaw ?? []) as any[]) {
    totalByDraft[l.draft_id] = (totalByDraft[l.draft_id] ?? 0) + l.debit
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">내 상신함</h2>
      <p className="text-sm text-gray-500">
        {access?.db_role
          ? `AI 키(${access.db_role})로 올린 전표 상신 내역입니다.`
          : '연결된 AI 키가 없습니다 — 관리자에게 문의하세요.'}
      </p>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">날짜</th>
              <th className="text-left px-3 py-2">적요</th>
              <th className="text-right px-3 py-2">금액</th>
              <th className="text-left px-3 py-2">상태</th>
              <th className="text-left px-3 py-2">비고</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {drafts.map(d => {
              const s = STATUS_LABEL[d.status] ?? STATUS_LABEL.pending
              return (
                <tr key={d.id}>
                  <td className="px-3 py-2">{d.date}</td>
                  <td className="px-3 py-2 max-w-xs truncate">{d.description ?? '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totalByDraft[d.id] ?? 0)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.className}`}>{s.text}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {d.status === 'approved' && d.journals?.journal_no && `전표 No.${d.journals.journal_no}`}
                    {d.status === 'rejected' && (d.rejected_reason ?? '사유 없음')}
                  </td>
                </tr>
              )
            })}
            {drafts.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">상신 내역 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
