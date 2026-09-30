/**
 * 전표 대기열(journal_drafts) 툴.
 *
 * 대기열은 확정 장부가 아니다 — 여기 넣은 건 관리자가 웹(/journal-drafts)이나
 * erp_review_draft 로 승인해야 journals/journal_lines에 정식 채번되어 들어간다.
 * 직원용 AI(별도 repo erp-ai-agent)는 Postgres 권한 자체가 이 테이블까지만 열려 있어
 * 이 경로 외에는 쓸 방법이 없고, 관리자용인 이 MCP는 대기열과 확정 발행 둘 다 쓸 수 있다.
 */
import { z } from 'zod'
import { supabase, getProjects, won, pad } from '../db.ts'
import { takePreview, dropPreview } from '../preview.ts'
import { insertJournal } from '../journalWrite.ts'
import { renderJournals } from './query.ts'

const VALID_ACTIVITY_TYPES = new Set(['영업', '재무', '투자', '개인', '현금', '세무'])

const DRAFT_LINE_COLUMNS =
  'date, classification, activity_type, activity_subtype, account_id, debit, credit, counterparty_id, counterparty_name, note'

/** UUID 전체 또는 앞 8자 이상 접두사로 draft를 찾는다(모델이 긴 UUID를 옮겨적다 틀리는 걸 줄임). */
async function resolveDraft(draftId: string) {
  const s = String(draftId ?? '').trim()
  if (s.length < 8) throw new Error('draft_id는 최소 8자 이상이어야 합니다(erp_drafts로 목록 확인)')
  const { data, error } = await supabase
    .from('journal_drafts')
    .select('id, date, description, project_id, status, created_by_role, approved_journal_id')
    .like('id', `${s}%`)
  if (error) throw new Error(error.message)
  if (!data.length) throw new Error(`draft_id "${s}" 로 시작하는 대기열 항목이 없습니다`)
  if (data.length > 1) throw new Error(`draft_id "${s}" 로 시작하는 항목이 ${data.length}건입니다 — 더 길게 지정하세요`)
  return data[0]
}

export const createDraftTool = {
  name: 'erp_create_draft',
  config: {
    description:
      'erp_preview_journal 이 발급한 preview_token 으로 전표를 대기열에 상신한다(journal_drafts). 확정 장부에는 아직 반영되지 않으며 관리자 승인이 필요하다 — 사용자에게 "대기열에 올렸습니다, 승인 후 정식 반영됩니다"라고 안내할 것. 정정(journal_no 지정) 미리보기는 대기열로 올릴 수 없다.',
    inputSchema: {
      preview_token: z.string().describe('erp_preview_journal 이 준 토큰'),
    },
  },
  async handler({ preview_token }: { preview_token: string }) {
    const p = takePreview(preview_token)
    if (p.mode === 'update') {
      throw new Error('대기열은 신규 전표만 받습니다 — 기존 전표 정정은 erp_commit_journal 로 직접 처리하세요')
    }

    const { data: draft, error: de } = await supabase
      .from('journal_drafts')
      .insert({
        date: p.date,
        description: p.memo ? `${p.description} (${p.memo})` : p.description,
        project_id: p.project_id,
        status: 'pending',
        created_by_role: 'mcp',
      })
      .select('id')
      .single()
    if (de) throw new Error(de.message)

    // Supabase JS로는 다중 문장 트랜잭션을 못 쓴다. 라인 insert가 실패하면 방금 만든
    // draft를 지워 반쪽 대기열 항목이 남지 않게 하는 게 이 코드베이스의 기존 패턴이다.
    const { error: le } = await supabase.from('journal_draft_lines').insert(
      p.lines.map((l) => ({
        draft_id: draft.id,
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
      })),
    )
    if (le) {
      await supabase.from('journal_drafts').delete().eq('id', draft.id)
      throw new Error(`대기열 라인 insert 실패, 상신을 취소했습니다: ${le.message}`)
    }

    dropPreview(preview_token)
    return [
      `✅ 대기열 상신 완료 — 아직 확정 장부에 반영되지 않았습니다.`,
      `draft_id: ${draft.id}`,
      `${p.date} [${p.project_code}] ${p.description} / 총액 ${won(p.total)}`,
      `승인: ERP 웹 /journal-drafts 화면 또는 erp_review_draft(draft_id, action:"approve")`,
    ].join('\n')
  },
}

export const listDraftsTool = {
  name: 'erp_drafts',
  config: {
    description:
      '전표 대기열 조회. "대기열 확인해줘" / "상신 뭐 있어?" 같은 요청에 쓴다. 기본은 승인 대기(pending) 건만.',
    inputSchema: {
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'all']).optional().describe('기본 pending'),
      limit: z.number().int().optional().describe('기본 20'),
    },
  },
  async handler({ status = 'pending', limit = 20 }: { status?: string; limit?: number }) {
    let q = supabase
      .from('journal_drafts')
      .select('id, date, description, project_id, status, created_by_role, rejected_reason, approved_journal_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (status !== 'all') q = q.eq('status', status)
    const { data: drafts, error } = await q
    if (error) throw new Error(error.message)
    if (!drafts.length) return status === 'pending' ? '대기 중인 전표가 없습니다' : `${status} 상태인 대기열 항목이 없습니다`

    const { data: lines } = await supabase
      .from('journal_draft_lines')
      .select('draft_id, debit, credit, counterparty_name, note, classification, accounts(name)')
      .in('draft_id', drafts.map((d: any) => d.id))
    const byDraft = new Map<string, any[]>()
    for (const l of (lines ?? []) as any[]) {
      if (!byDraft.has(l.draft_id)) byDraft.set(l.draft_id, [])
      byDraft.get(l.draft_id)!.push(l)
    }
    const pById = new Map((await getProjects()).map((p) => [p.id, p]))

    return drafts
      .map((d: any) => {
        const head = `[${d.status}] ${d.id.slice(0, 8)}  ${d.date}  [${pById.get(d.project_id)?.code ?? '-'}]  ${d.description ?? ''}  (상신: ${d.created_by_role})`
        const body = (byDraft.get(d.id) ?? [])
          .map((l) => {
            const isDebit = Number(l.debit) > 0
            const cp = l.counterparty_name ? `  ${l.counterparty_name}` : ''
            return `  ${isDebit ? '차' : '대'} ${pad(l.accounts?.name ?? '?', 18)} ${pad(won(isDebit ? l.debit : l.credit), 13, 'right')}${cp}  [${l.classification}]`
          })
          .join('\n')
        const extra = d.rejected_reason ? `\n  사유: ${d.rejected_reason}` : ''
        return head + '\n' + body + extra
      })
      .join('\n\n')
  },
}

export const reviewDraftTool = {
  name: 'erp_review_draft',
  config: {
    description:
      '대기열 항목을 승인(확정 장부에 정식 채번 발행) 또는 반려한다. 관리자 전용 동작이며, 웹 /journal-drafts 의 승인/반려 버튼과 동일한 절차를 밟는다. 승인 전에 erp_drafts 로 내용을 사용자에게 보여주고 확인받을 것.',
    inputSchema: {
      draft_id: z.string().describe('대기열 항목 id (앞 8자 이상)'),
      action: z.enum(['approve', 'reject']).describe('approve=확정 발행, reject=반려'),
      reason: z.string().optional().describe('반려 사유 (action=reject 일 때 필수)'),
    },
  },
  async handler({ draft_id, action, reason }: { draft_id: string; action: string; reason?: string }) {
    const draft = await resolveDraft(draft_id)
    if (draft.status !== 'pending') throw new Error(`이미 ${draft.status} 처리된 건입니다`)

    if (action === 'reject') {
      if (!reason) throw new Error('반려에는 reason(사유)이 필요합니다')
      const { error } = await supabase
        .from('journal_drafts')
        .update({ status: 'rejected', rejected_reason: reason, reviewed_at: new Date().toISOString() })
        .eq('id', draft.id)
      if (error) throw new Error(error.message)
      return `✅ ${draft.id.slice(0, 8)} 반려 처리 — 사유: ${reason}`
    }

    const { data: draftLines, error: le } = await supabase
      .from('journal_draft_lines')
      .select(`${DRAFT_LINE_COLUMNS}, accounts(name)`)
      .eq('draft_id', draft.id)
    if (le) throw new Error(le.message)
    if (!draftLines?.length) throw new Error('대기열 라인이 비어있습니다')

    // journal_lines.activity_type엔 DB CHECK 제약(6개 값)이 있어, 직원 AI가 subtype 값을
    // 잘못 넣어 원시 Postgres 에러로만 거부된 실사례가 있다(2026-08-23). 여기서 먼저 거른다.
    const bad = (draftLines as any[]).find((l) => !VALID_ACTIVITY_TYPES.has(l.activity_type))
    if (bad) {
      throw new Error(
        `"${bad.accounts?.name ?? bad.account_id}" 라인의 activity_type "${bad.activity_type}" 이 잘못됐습니다 — 영업/재무/투자/개인/현금/세무 중 하나여야 합니다(activity_subtype과 혼동한 것으로 보임).`,
      )
    }
    const debit = (draftLines as any[]).reduce((s, l) => s + Number(l.debit), 0)
    const credit = (draftLines as any[]).reduce((s, l) => s + Number(l.credit), 0)
    if (debit !== credit) throw new Error(`차대가 맞지 않아 승인할 수 없습니다 — 차 ${won(debit)} / 대 ${won(credit)}`)

    const journal = await insertJournal({
      date: draft.date,
      description: draft.description,
      project_id: draft.project_id,
      lines: (draftLines as any[]).map(({ accounts: _a, ...rest }) => rest),
    })

    await supabase
      .from('journal_drafts')
      .update({ status: 'approved', approved_journal_id: journal.id, reviewed_at: new Date().toISOString() })
      .eq('id', draft.id)

    const { data: fresh } = await supabase
      .from('journals')
      .select('id, journal_no, date, description, is_cancelled, related_journals, projects(code)')
      .eq('id', journal.id)
    return `✅ 승인 완료 — #${journal.journal_no} 로 확정 발행\n── DB 재조회 결과 ──\n${await renderJournals(fresh ?? [])}`
  },
}

export const draftTools = [createDraftTool, listDraftsTool, reviewDraftTool]
