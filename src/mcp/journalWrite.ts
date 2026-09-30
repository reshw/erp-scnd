/**
 * 확정 장부(journals/journal_lines) 쓰기 원자 연산.
 *
 * src/lib/journal.ts의 insertJournalWithLines와 같은 채번·롤백 패턴이지만, 그쪽은
 * AccountMeta에서 classification을 다시 계산한다. MCP 경로에서는 preview 단계에서 이미
 * 확정한 라인 값을 한 글자도 바꾸지 않고 그대로 넣어야 하므로(사용자가 확인한 것과
 * DB에 들어간 것이 달라지면 안 된다) 완성된 행을 받는 형태로 따로 둔다.
 * 대기열 승인 경로도 같은 이유로 이 함수를 쓴다.
 */
import { supabase } from './db.ts'

export interface RawLine {
  date: string
  account_id: string
  debit: number
  credit: number
  counterparty_id: string | null
  counterparty_name: string | null
  note: string | null
  classification: string
  activity_type: string
  activity_subtype: string
}

/**
 * journal_no는 UNIQUE라 동시 삽입 시 23505가 나므로 재채번으로 재시도하고,
 * 라인 삽입이 실패하면 방금 만든 전표를 지워 반쪽 전표를 남기지 않는다.
 */
export async function insertJournal(params: {
  date: string
  description: string
  project_id: string
  related_journals?: unknown
  lines: RawLine[]
}): Promise<{ id: string; journal_no: number }> {
  let journal: { id: string; journal_no: number } | null = null

  for (let attempt = 0; attempt < 5 && !journal; attempt++) {
    const { data: lastJ } = await supabase
      .from('journals').select('journal_no').order('journal_no', { ascending: false }).limit(1).single()
    const nextNo = (lastJ?.journal_no ?? 0) + 1

    const row: any = {
      journal_no: nextNo,
      date: params.date,
      project_id: params.project_id,
      description: params.description,
    }
    if (params.related_journals) row.related_journals = params.related_journals

    const { data: created, error } = await supabase.from('journals').insert(row).select('id, journal_no').single()
    if (!error) { journal = created; break }
    if (error.code !== '23505') throw new Error(error.message)
  }
  if (!journal) throw new Error('전표번호 채번에 반복 실패했습니다')

  const { error: le } = await supabase
    .from('journal_lines')
    .insert(params.lines.map((l) => ({ ...l, journal_id: journal!.id })))
  if (le) {
    await supabase.from('journals').delete().eq('id', journal.id)
    throw new Error(le.message)
  }
  return journal
}
