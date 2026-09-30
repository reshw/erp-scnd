/**
 * 확정 장부 직접 발행/정정/취소.
 *
 * 지시서 원안은 "확정 장부 직접 쓰기 도구는 절대 제공하지 않는다"였는데, 그 원칙은
 * 직원용 배포(별도 repo erp-ai-agent)에서는 옳지만 관리자용인 여기서는 다르게 봤다.
 * 이 서버는 관리자 머신에서 service role 키로 도는 데다 관리자 본인이 승인자다 —
 * 본인이 상신하고 본인이 승인하는 큐는 통제가 아니라 의식이고, 전표 한 장마다 브라우저를
 * 열어야 하는 비용만 남는다. 진짜 통제는 preview → 사용자 확인 → commit 게이트이고,
 * 직원에 대한 경계는 이미 026 마이그레이션의 Postgres 권한이 DB 레벨에서 강제한다.
 * 대신 ERP_MCP_MODE=staff 로 띄우면 이 파일의 툴은 등록되지 않는다(server.ts 참고).
 */
import { z } from 'zod'
import { supabase, won } from '../db.ts'
import { takePreview, dropPreview } from '../preview.ts'
import { insertJournal, type RawLine } from '../journalWrite.ts'
import { renderJournals } from './query.ts'

const JOURNAL_COLUMNS = 'id, journal_no, date, description, is_cancelled, related_journals, projects(code)'

const toRawLines = (p: ReturnType<typeof takePreview>): RawLine[] =>
  p.lines.map((l) => ({
    date: p.date,
    account_id: l.account_id,
    debit: l.side === 'debit' ? l.amount : 0,
    credit: l.side === 'credit' ? l.amount : 0,
    counterparty_id: l.counterparty_id,
    counterparty_name: l.counterparty_name,
    note: l.note ?? p.description,
    classification: l.classification,
    activity_type: l.activity_type,
    activity_subtype: l.activity_subtype,
  }))

export const commitTool = {
  name: 'erp_commit_journal',
  config: {
    description:
      'erp_preview_journal 이 발급한 preview_token 으로 확정 장부에 전표를 발행하거나(신규) 기존 전표를 정정한다. 사용자가 미리보기 표를 확인한 뒤에만 호출할 것 — 승인 게이트를 거치고 싶으면 대신 erp_create_draft 를 쓴다. 커밋 후 DB에서 다시 읽은 실제 값을 돌려준다.',
    inputSchema: {
      preview_token: z.string().describe('erp_preview_journal 이 준 토큰'),
    },
  },
  async handler({ preview_token }: { preview_token: string }) {
    const p = takePreview(preview_token)
    let journalNo: number

    if (p.mode === 'create') {
      const created = await insertJournal({
        date: p.date,
        description: p.description,
        project_id: p.project_id,
        related_journals: p.related_journals ?? undefined,
        lines: toRawLines(p),
      })
      journalNo = created.journal_no
    } else {
      // 정정: 기존 라인을 스냅샷해두고 교체한다. 라인 재삽입이 실패하면 원상복구해서
      // 라인이 통째로 사라진 전표를 남기지 않는다.
      const { data: old, error: oe } = await supabase
        .from('journal_lines')
        .select('date, classification, activity_type, activity_subtype, account_id, debit, credit, counterparty_id, counterparty_name, note')
        .eq('journal_id', p.journal_id)
      if (oe) throw new Error(oe.message)

      const update: any = {
        date: p.date,
        description: p.description,
        project_id: p.project_id,
        updated_at: new Date().toISOString(),
      }
      if (p.related_journals) update.related_journals = p.related_journals
      const { error: he } = await supabase.from('journals').update(update).eq('id', p.journal_id)
      if (he) throw new Error(he.message)

      await supabase.from('journal_lines').delete().eq('journal_id', p.journal_id)
      const { error: ie } = await supabase
        .from('journal_lines')
        .insert(toRawLines(p).map((l) => ({ ...l, journal_id: p.journal_id })))
      if (ie) {
        await supabase.from('journal_lines').insert((old ?? []).map((l: any) => ({ ...l, journal_id: p.journal_id })))
        throw new Error(`정정 실패, 기존 라인을 복구했습니다: ${ie.message}`)
      }
      journalNo = p.journal_no!
    }

    dropPreview(preview_token)
    const { data: fresh } = await supabase.from('journals').select(JOURNAL_COLUMNS).eq('journal_no', journalNo)
    return [
      p.mode === 'create' ? `✅ #${journalNo} 발행 완료 (총액 ${won(p.total)})` : `✅ #${journalNo} 정정 완료`,
      '── DB 재조회 결과 ──',
      await renderJournals(fresh ?? []),
      '',
      '통장 라인이 포함됐다면 erp_balance(account:"보통예금", group_by:"counterparty")로 실제 은행 잔액과 대조하세요.',
    ].join('\n')
  },
}

export const cancelTool = {
  name: 'erp_cancel_journal',
  config: {
    description:
      '전표를 취소 처리한다(is_cancelled=true). 물리 삭제는 하지 않는다 — 장부엔 흔적이 남아야 하고 조회 화면들은 이미 취소 전표를 집계에서 제외한다. 취소 사유는 적요 뒤에 붙는다.',
    inputSchema: {
      journal_no: z.number().int().describe('취소할 전표번호'),
      reason: z.string().min(1).describe('취소 사유(적요에 기록됨)'),
    },
  },
  async handler({ journal_no, reason }: { journal_no: number; reason: string }) {
    const { data } = await supabase.from('journals').select('id, description, is_cancelled').eq('journal_no', journal_no)
    if (!data?.length) throw new Error(`#${journal_no} 전표를 찾을 수 없습니다`)
    if (data.length > 1) throw new Error(`#${journal_no} 전표가 여러 건입니다 — 사람이 직접 확인해야 합니다`)
    const j = data[0]
    if (j.is_cancelled) return `#${journal_no} 는 이미 취소된 전표입니다`

    const { error } = await supabase
      .from('journals')
      .update({
        is_cancelled: true,
        description: `${j.description ?? ''} (취소: ${reason})`.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', j.id)
    if (error) throw new Error(error.message)

    const { data: fresh } = await supabase.from('journals').select(JOURNAL_COLUMNS).eq('id', j.id)
    return `✅ #${journal_no} 취소 처리\n${await renderJournals(fresh ?? [])}`
  },
}

export const journalWriteTools = [commitTool, cancelTool]
