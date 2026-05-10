import { createAdminClient } from '@/lib/supabase/admin'
import BatchJournalForm from './BatchJournalForm'

export default async function BatchJournalPage() {
  const supabase = createAdminClient()

  const [{ data: accounts }, { data: projects }, { data: counterparties }] = await Promise.all([
    supabase.from('accounts').select('id, name').eq('is_active', true).order('name'),
    supabase.from('projects').select('id, code').eq('is_active', true).order('code'),
    supabase.from('counterparties').select('id, name').order('name'),
  ])

  const { data: lastJournal } = await (supabase as any)
    .from('journals')
    .select('journal_no')
    .order('journal_no', { ascending: false })
    .limit(1)
    .single() as { data: { journal_no: number } | null }

  const nextNo = (lastJournal?.journal_no ?? 0) + 1

  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-xl font-bold">다중 프로젝트 일괄 전표 발행</h2>
      <p className="text-sm text-gray-500">행 하나 = 프로젝트 하나 = 전표 하나. 마통 이자발생·상환 등 프로젝트별 분개 일괄 처리.</p>
      <BatchJournalForm
        accounts={(accounts ?? []) as { id: string; name: string }[]}
        projects={(projects ?? []) as { id: string; code: string }[]}
        counterparties={(counterparties ?? []) as { id: string; name: string }[]}
        nextNo={nextNo}
      />
    </div>
  )
}
