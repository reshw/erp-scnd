/**
 * 전표 검증 + 미리보기 토큰 — 모든 쓰기 경로(대기열 상신 / 확정 발행)의 유일한 관문.
 *
 * 지시서 원안은 `validate_journal_lines`를 독립 툴로 두고 `create_journal_draft`가 그걸
 * 내부에서 다시 호출하는 구조였는데, 그러면 검증 로직이 두 군데서 갈라질 수 있고 모델이
 * 검증 툴을 건너뛰고 바로 쓰기 툴을 부를 여지도 남는다. 여기선 검증을 preview 하나로
 * 합치고, 쓰기 툴은 preview가 발급한 토큰으로만 실행되게 했다. 토큰이 확정된 payload를
 * 그대로 들고 있으므로 모델이 커밋 단계에서 계정이나 금액을 다시 해석할 여지도 없다.
 *
 * classification/activity_type/activity_subtype은 모델이 채우지 않고 계정의 normal_side에서
 * 서버가 도출한다 — 모델이 직접 채우게 했다가 activity_type 자리에 subtype 값을 넣어
 * 승인이 DB CHECK 제약으로 거부된 실사고가 있었다(2026-08-23, approve route 주석 참고).
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supabase, resolveAccount, resolveProject, resolveCounterparty, won, pad } from './db.ts'
import { renderJournals } from './tools/query.ts'
import { lineClassification } from '../lib/journal.ts'

const VALID_ACTIVITY_TYPES = new Set(['영업', '재무', '투자', '개인', '현금', '세무'])
const PREVIEW_TTL_MS = 30 * 60 * 1000

export interface PreviewLine {
  account_id: string
  account_name: string
  side: 'debit' | 'credit'
  amount: number
  note: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  classification: string
  activity_type: string
  activity_subtype: string
}

export interface PreviewPayload {
  mode: 'create' | 'update'
  date: string
  description: string
  project_id: string
  project_code: string
  journal_id: string | null
  journal_no: number | null
  related_journals: { journal_no: number; relation: string }[] | null
  memo: string | null
  total: number
  lines: PreviewLine[]
}

/** token -> payload. 서버 프로세스 수명 동안만 유효하다(재시작하면 다시 preview 해야 함). */
const previews = new Map<string, { payload: PreviewPayload; createdAt: number }>()

function putPreview(payload: PreviewPayload): string {
  const now = Date.now()
  for (const [k, v] of previews) if (now - v.createdAt > PREVIEW_TTL_MS) previews.delete(k)
  const token = `pv_${randomUUID().slice(0, 8)}`
  previews.set(token, { payload, createdAt: now })
  return token
}

export function takePreview(token: string): PreviewPayload {
  const hit = previews.get(token)
  if (!hit || Date.now() - hit.createdAt > PREVIEW_TTL_MS) {
    previews.delete(token)
    throw new Error(
      `preview_token "${token}" 이(가) 없거나 만료됐습니다(유효 30분). erp_preview_journal 을 다시 호출해 사용자 확인을 받은 뒤 쓰기 툴을 부르세요.`,
    )
  }
  return hit.payload
}

export function dropPreview(token: string) {
  previews.delete(token)
}

// ── 검증 ─────────────────────────────────────────────────────────────────────

export const lineInputSchema = z.object({
  account: z.string().describe('계정명(부분일치 가능) 또는 UUID'),
  side: z.enum(['debit', 'credit']).describe('debit=차변, credit=대변'),
  amount: z.number().int().positive().describe('금액(원 단위 정수, 양수). numeric(15,0)이라 소수점 불가'),
  counterparty: z.string().optional().describe('거래처명. 마스터에 없으면 자유텍스트로 기록됨(통장-IM뱅크 등)'),
  note: z.string().optional().describe('라인 적요(생략 시 전표 적요를 사용)'),
  classification: z
    .string()
    .optional()
    .describe('보통 생략한다 — 계정의 정상측에서 서버가 자동 도출한다. 넘기면 도출값과 대조만 하고 다르면 거부된다.'),
})
export type LineInput = z.infer<typeof lineInputSchema>

interface BuiltLine extends PreviewLine {
  cpHint: string | null
}

async function buildLines(input: LineInput[]): Promise<{ lines: BuiltLine[]; total: number }> {
  if (!Array.isArray(input) || input.length < 2) {
    throw new Error('lines는 최소 2개(차변 1 + 대변 1) 이상이어야 합니다')
  }
  const lines: BuiltLine[] = []
  for (const [i, l] of input.entries()) {
    if (!Number.isInteger(l.amount) || l.amount <= 0) {
      throw new Error(`lines[${i}].amount 는 0보다 큰 원 단위 정수여야 합니다 (받은 값: ${l.amount})`)
    }
    const account = await resolveAccount(l.account)
    const cp = await resolveCounterparty(l.counterparty)
    const derived = lineClassification(account as any, l.side)

    if (l.classification && l.classification !== derived.classification) {
      throw new Error(
        `lines[${i}] "${account.name}" 의 classification 이 맞지 않습니다 — 넘긴 값 "${l.classification}", ` +
          `정상측(${account.normal_side}) 기준 ${l.side}에 오면 "${derived.classification}" 이어야 합니다. ` +
          `classification 은 생략하는 것을 권장합니다(서버가 도출).`,
      )
    }
    if (!VALID_ACTIVITY_TYPES.has(derived.activity_type)) {
      throw new Error(`"${account.name}" 계정의 activity_type("${derived.activity_type}")이 DB CHECK 제약(영업/재무/투자/개인/현금/세무)을 위반합니다`)
    }

    lines.push({
      account_id: account.id,
      account_name: account.name,
      side: l.side,
      amount: l.amount,
      note: l.note ?? null,
      counterparty_id: cp.id,
      counterparty_name: cp.name,
      cpHint: cp.hint,
      ...derived,
    })
  }

  const debit = lines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0)
  const credit = lines.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0)
  if (debit !== credit) {
    throw new Error(`차대가 맞지 않습니다 — 차변 ${won(debit)} / 대변 ${won(credit)} (차이 ${won(debit - credit)})`)
  }
  if (!debit) throw new Error('전표 금액이 0입니다')
  if (!lines.some((l) => l.side === 'debit') || !lines.some((l) => l.side === 'credit')) {
    throw new Error('차변 라인과 대변 라인이 각각 최소 1개씩 있어야 합니다')
  }
  return { lines, total: debit }
}

/**
 * 같은 날짜·같은 총액인 기존 전표를 찾아 중복 발행을 막는다.
 * 과거에 검색 없이 같은 건을 두 번 발행한 실사고가 있었다(2026-08-19, #399/#250).
 */
async function findDuplicates(date: string, total: number, excludeJournalNo: number | null) {
  const { data: sameDay } = await supabase
    .from('journals')
    .select('id, journal_no, date, description, is_cancelled, related_journals, projects(code)')
    .eq('date', date)
    .eq('is_cancelled', false)
  if (!sameDay?.length) return []
  const { data: lines } = await supabase
    .from('journal_lines')
    .select('journal_id, debit')
    .in('journal_id', sameDay.map((j: any) => j.id))
  const sum = new Map<string, number>()
  for (const l of (lines ?? []) as any[]) sum.set(l.journal_id, (sum.get(l.journal_id) ?? 0) + Number(l.debit))
  return sameDay.filter((j: any) => sum.get(j.id) === total && j.journal_no !== excludeJournalNo)
}

function renderLines(lines: BuiltLine[]) {
  return lines
    .map((l) => {
      const cp = l.counterparty_name ? `  ${l.counterparty_name}` : '  (거래처 없음)'
      const note = l.note ? `  // ${l.note}` : ''
      // classification 뒤에 subtype이 이미 들어있으면(예: "현금 - 입금") 중복 표시하지 않는다.
      const meta = l.classification.endsWith(l.activity_subtype) ? l.classification : `${l.classification}/${l.activity_subtype}`
      return `  ${l.side === 'debit' ? '차' : '대'} ${pad(l.account_name, 18)} ${pad(won(l.amount), 13, 'right')}${cp}  [${meta}]${note}`
    })
    .join('\n')
}

// ── 툴 ───────────────────────────────────────────────────────────────────────

export const previewTool = {
  name: 'erp_preview_journal',
  config: {
    description:
      '전표를 검증하고 미리보기를 만든다(DB 변경 없음). 모든 쓰기 경로의 필수 첫 단계 — 여기서 나온 preview_token 없이는 대기열 상신도 확정 발행도 할 수 없다. ' +
      '차대 일치·원 단위 정수·계정 존재를 검사하고, classification/activity_type/activity_subtype은 계정의 정상측에서 자동 도출하며, 같은 날짜·같은 총액의 기존 전표가 있으면 중복 경고를 붙인다. ' +
      'journal_no를 주면 그 전표의 정정안으로 처리한다. 반환된 표를 사용자에게 보여주고 확인받은 뒤 erp_create_draft 또는 erp_commit_journal 로 넘길 것.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('전표 일자 YYYY-MM-DD'),
      description: z.string().min(1).describe('전표 대표적요'),
      project: z.string().describe('프로젝트 코드 (예: NADIA, JH308)'),
      lines: z.array(lineInputSchema).min(2).describe('차변/대변 라인. 합계가 일치해야 한다.'),
      journal_no: z.number().int().optional().describe('기존 전표를 정정할 때만 지정. 지정 시 라인 전체가 교체된다.'),
      related_journals: z
        .array(z.object({ journal_no: z.number().int(), relation: z.string() }))
        .optional()
        .describe('연계 전표 breadcrumb — 다자 분할 정산처럼 원 청구와 상환이 여러 전표로 쪼개질 때'),
      memo: z.string().optional().describe('대기열 상신 시 남길 생성 사유(선택)'),
    },
  },
  async handler(args: any) {
    const project = await resolveProject(args.project)
    const { lines, total } = await buildLines(args.lines)

    let existing: any = null
    if (args.journal_no) {
      const { data } = await supabase
        .from('journals')
        .select('id, journal_no, date, description, is_cancelled, related_journals, projects(code)')
        .eq('journal_no', args.journal_no)
      if (!data?.length) throw new Error(`#${args.journal_no} 전표를 찾을 수 없습니다`)
      if (data.length > 1) throw new Error(`#${args.journal_no} 전표가 여러 건입니다 — 사람이 직접 확인해야 합니다`)
      existing = data[0]
    }

    const payload: PreviewPayload = {
      mode: existing ? 'update' : 'create',
      date: args.date,
      description: args.description,
      project_id: project.id,
      project_code: project.code,
      journal_id: existing?.id ?? null,
      journal_no: existing?.journal_no ?? null,
      related_journals: args.related_journals ?? null,
      memo: args.memo ?? null,
      total,
      lines: lines.map(({ cpHint: _cpHint, ...rest }) => rest),
    }
    const token = putPreview(payload)

    const out = [
      existing ? `[정정안] #${existing.journal_no} 을(를) 아래로 교체` : '[신규 발행안]',
      `${args.date}  [${project.code}]  ${args.description}`,
      renderLines(lines),
      `  합계  차 ${won(total)} = 대 ${won(total)} ✅`,
    ]
    if (existing) out.push('', '── 현재 DB 상태(교체 대상) ──', await renderJournals([existing]))
    if (args.related_journals?.length) {
      out.push(`연계: ${args.related_journals.map((r: any) => `#${r.journal_no}(${r.relation})`).join(', ')}`)
    }

    const hints = lines.filter((l) => l.cpHint).map((l) => `  ${l.counterparty_name}: ${l.cpHint}`)
    if (hints.length) out.push('', '⚠ 거래처 표기 확인(마스터 미등록 → 자유텍스트로 기록됨):', ...hints)

    const dups = await findDuplicates(args.date, total, existing?.journal_no ?? null)
    if (dups.length) {
      out.push('', `⚠ 같은 날짜·같은 총액(${won(total)}) 전표가 이미 ${dups.length}건 있습니다 — 중복 발행인지 반드시 확인:`, await renderJournals(dups))
    }

    out.push(
      '',
      `preview_token: ${token}  (30분 유효)`,
      '→ 위 표를 사용자에게 보여주고 확인받은 뒤: erp_create_draft(대기열 상신) 또는 erp_commit_journal(확정 발행)',
    )
    return out.join('\n')
  },
}
