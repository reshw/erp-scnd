import { createAdminClient } from '@/lib/supabase/admin'
import { getScope } from '@/lib/auth/scope'
import { NextRequest, NextResponse } from 'next/server'

/**
 * 대기열(draft) 승인 → 정식 journals/journal_lines 발행.
 * draft_lines는 이미 account_id/classification/debit/credit이 확정된 상태로 저장돼
 * 있으므로(직원 AI가 채워 넣음), insertJournalWithLines의 AccountMeta 재구성 없이
 * journal_no 채번·롤백 로직만 그대로 적용해 직접 insert한다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope()
  if (scope.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 승인할 수 있습니다' }, { status: 403 })
  }

  const { id } = await params
  const supabase = createAdminClient() as any

  const { data: draft, error: de } = await supabase
    .from('journal_drafts')
    .select('id, date, description, project_id, status')
    .eq('id', id)
    .single()
  if (de || !draft) return NextResponse.json({ error: '대기열 항목을 찾을 수 없습니다' }, { status: 404 })
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `이미 ${draft.status} 처리된 건입니다` }, { status: 400 })
  }

  const { data: draftLines, error: le } = await supabase
    .from('journal_draft_lines')
    .select('date, classification, activity_type, activity_subtype, account_id, debit, credit, counterparty_id, counterparty_name, note')
    .eq('draft_id', id)
  if (le) return NextResponse.json({ error: le.message }, { status: 500 })
  if (!draftLines?.length) return NextResponse.json({ error: '대기열 라인이 비어있습니다' }, { status: 400 })

  let journal: { id: string; journal_no: number } | null = null
  for (let attempt = 0; attempt < 5 && !journal; attempt++) {
    const { data: lastJ } = await supabase
      .from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single()
    const nextNo = (lastJ?.journal_no ?? 0) + 1

    const { data: created, error } = await supabase
      .from('journals')
      .insert({ journal_no: nextNo, date: draft.date, project_id: draft.project_id, description: draft.description })
      .select('id, journal_no')
      .single()

    if (!error) { journal = created; break }
    if (error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!journal) return NextResponse.json({ error: '전표번호 채번에 반복 실패했습니다' }, { status: 500 })

  const rows = draftLines.map((l: any) => ({ ...l, journal_id: journal!.id }))
  const { error: insertErr } = await supabase.from('journal_lines').insert(rows)
  if (insertErr) {
    await supabase.from('journals').delete().eq('id', journal.id)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await supabase
    .from('journal_drafts')
    .update({ status: 'approved', approved_journal_id: journal.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true, journal_id: journal.id, journal_no: journal.journal_no })
}
