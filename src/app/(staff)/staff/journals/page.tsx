import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function StaffJournalsPage() {
  const scope = await getScope()
  if (scope.role !== 'employee') return null
  const supabase = createAdminClient()

  const { data: journalsData } = await (supabase as any)
    .from('journals')
    .select('id, journal_no, date, description, is_cancelled')
    .eq('project_id', scope.allowedProjectId)
    .order('date', { ascending: false })
    .order('journal_no', { ascending: false })
    .limit(50)

  const journals = (journalsData ?? []) as any[]
  const journalIds = journals.map(j => j.id)
  const { data: linesRaw } = journalIds.length
    ? await supabase.from('journal_lines').select('journal_id, debit').in('journal_id', journalIds)
    : { data: [] }

  const totalByJournal: Record<string, number> = {}
  for (const l of (linesRaw ?? []) as any[]) {
    totalByJournal[l.journal_id] = (totalByJournal[l.journal_id] ?? 0) + l.debit
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">전표 조회 (최근 50건)</h2>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">No.</th>
              <th className="text-left px-3 py-2">날짜</th>
              <th className="text-left px-3 py-2">적요</th>
              <th className="text-right px-3 py-2">금액</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {journals.map(j => (
              <tr key={j.id} className={j.is_cancelled ? 'opacity-40 line-through' : ''}>
                <td className="px-3 py-2 tabular-nums text-gray-500">{j.journal_no}</td>
                <td className="px-3 py-2">{j.date}</td>
                <td className="px-3 py-2 max-w-xs truncate">{j.description ?? '-'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(totalByJournal[j.id] ?? 0)}</td>
              </tr>
            ))}
            {journals.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">전표 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
