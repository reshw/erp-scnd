import type { SupabaseClient } from '@supabase/supabase-js'

export type AccountMeta = {
  id: string
  name: string
  activity_type: string
  increase_type: string
  increase_label: string
  decrease_type: string
  decrease_label: string
  normal_side: 'debit' | 'credit'
}

export const ACCOUNT_META_COLUMNS =
  'id, name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label'

/**
 * 계정과목과 차대 방향으로 분류(classification)·활동유형을 결정한다.
 * 정상측에 오면 증가, 반대측에 오면 감소로 본다.
 */
export function lineClassification(acc: AccountMeta, side: 'debit' | 'credit') {
  const increasing = acc.normal_side === side
  return {
    classification: increasing ? acc.increase_label : acc.decrease_label,
    activity_type: acc.activity_type,
    activity_subtype: increasing ? acc.increase_type : acc.decrease_type,
  }
}

export type JournalLineInput = {
  account: AccountMeta
  side: 'debit' | 'credit'
  amount: number
  note?: string
  counterparty_name?: string | null
}

/**
 * 전표 1장을 라인과 함께 저장한다.
 * journal_no는 유니크라 동시 삽입 시 23505가 나므로 재채번으로 재시도하고,
 * 라인 삽입이 실패하면 방금 만든 전표를 지워 반쪽 전표를 남기지 않는다.
 */
export async function insertJournalWithLines(
  supabase: SupabaseClient<any>,
  params: {
    date: string
    description: string
    project_id?: string | null
    lines: JournalLineInput[]
  }
): Promise<{ id: string; journal_no: number }> {
  const db = supabase as any

  let journal: { id: string; journal_no: number } | null = null
  for (let attempt = 0; attempt < 5 && !journal; attempt++) {
    const { data: lastJ } = await db
      .from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single()
    const nextNo = (lastJ?.journal_no ?? 0) + 1

    const { data: created, error } = await db
      .from('journals')
      .insert({ journal_no: nextNo, date: params.date, project_id: params.project_id ?? null, description: params.description })
      .select('id, journal_no')
      .single()

    if (!error) { journal = created; break }
    if (error.code !== '23505') throw new Error(error.message)
  }
  if (!journal) throw new Error('전표번호 채번에 반복 실패했습니다')

  const rows = params.lines.map((l) => ({
    journal_id: journal!.id,
    date: params.date,
    account_id: l.account.id,
    debit: l.side === 'debit' ? l.amount : 0,
    credit: l.side === 'credit' ? l.amount : 0,
    counterparty_name: l.counterparty_name ?? null,
    note: l.note ?? params.description,
    ...lineClassification(l.account, l.side),
  }))

  const { error: le } = await db.from('journal_lines').insert(rows)
  if (le) {
    await db.from('journals').delete().eq('id', journal.id)
    throw new Error(le.message)
  }

  return journal
}
