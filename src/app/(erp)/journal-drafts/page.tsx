import { createAdminClient } from '@/lib/supabase/admin'
import DraftActions from './DraftActions'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function JournalDraftsPage() {
  const supabase = createAdminClient() as any

  const { data: draftsData } = await supabase
    .from('journal_drafts')
    .select('id, date, description, project_id, created_by_role, created_at, projects(code)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const drafts = (draftsData ?? []) as any[]
  const draftIds = drafts.map(d => d.id)

  const { data: linesRaw } = draftIds.length
    ? await supabase
        .from('journal_draft_lines')
        .select('draft_id, debit, credit, counterparty_name, note, accounts(name)')
        .in('draft_id', draftIds)
    : { data: [] }

  const linesByDraft: Record<string, any[]> = {}
  for (const l of (linesRaw ?? []) as any[]) {
    if (!linesByDraft[l.draft_id]) linesByDraft[l.draft_id] = []
    linesByDraft[l.draft_id].push(l)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">전표 승인 대기함</h2>
        <p className="text-sm text-gray-500 mt-0.5">직원 AI 에이전트가 올린 전표 — 승인해야 정식 장부에 반영됩니다</p>
      </div>

      {drafts.length === 0 && (
        <div className="text-sm text-gray-400 py-12 text-center border rounded-lg">
          대기 중인 전표가 없습니다.
        </div>
      )}

      <div className="space-y-3">
        {drafts.map(d => {
          const lines = linesByDraft[d.id] ?? []
          const total = lines.reduce((s, l) => s + l.debit, 0)
          return (
            <div key={d.id} className="border rounded-lg overflow-hidden bg-white">
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b">
                <div className="text-sm">
                  <span className="font-medium">{d.projects?.code ?? '-'}</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span>{d.date}</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="text-gray-600">{d.description ?? '(적요 없음)'}</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="text-xs text-gray-400">{d.created_by_role}</span>
                </div>
                <DraftActions draftId={d.id} />
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-4 py-1.5">{l.accounts?.name}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums w-32">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums w-32">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      <td className="px-4 py-1.5 text-gray-500">{l.counterparty_name ?? ''}</td>
                      <td className="px-4 py-1.5 text-gray-500 text-xs">{l.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-medium">
                    <td className="px-4 py-1.5 text-gray-500">합계</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmt(total)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}
