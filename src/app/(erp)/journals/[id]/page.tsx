import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import JournalForm from '@/components/journal/JournalForm'
import JournalDeleteButton from '@/components/journal/JournalDeleteButton'
import { Button } from '@/components/ui/button'

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: journal } = await supabase
    .from('journals')
    .select(`id, journal_no, date, description, project_id, is_cancelled,
      journal_lines(id, account_id, classification, debit, credit, counterparty_id, counterparty_name, note, accounts(name))`)
    .eq('id', id)
    .single()

  if (!journal) notFound()

  const j = journal as any

  const [{ data: accounts }, { data: projects }, { data: counterparties }] = await Promise.all([
    supabase.from('accounts').select('id,name,activity_type,normal_side,increase_label,decrease_label').eq('is_active', true).order('name'),
    supabase.from('projects').select('id,code').eq('is_active', true).order('code'),
    supabase.from('counterparties').select('id,name').order('name'),
  ])

  const defaultValues = {
    journalId: j.id,
    journal_no: j.journal_no,
    date: j.date,
    project_id: j.project_id ?? '',
    description: j.description ?? '',
    lines: (j.journal_lines ?? []).map((l: any) => ({
      account_id:        l.account_id,
      account_name:      l.accounts?.name ?? '',
      classification:    l.classification ?? '',
      debit:             l.debit > 0 ? String(l.debit) : '',
      credit:            l.credit > 0 ? String(l.credit) : '',
      counterparty_id:   l.counterparty_id ?? '',
      counterparty_name: l.counterparty_name ?? '',
      note:              l.note ?? '',
    })),
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">전표 #{j.journal_no}</h2>
        <div className="flex gap-2">
          <Link href={`/journals/new?copy=${id}`}>
            <Button size="sm" variant="outline">이 전표 복사</Button>
          </Link>
          <JournalDeleteButton journalId={id} />
        </div>
      </div>
      <JournalForm
        nextNo={j.journal_no}
        accounts={(accounts ?? []) as any}
        projects={(projects ?? []) as any}
        counterparties={(counterparties ?? []) as any}
        defaultValues={defaultValues}
      />
    </div>
  )
}
