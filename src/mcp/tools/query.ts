/**
 * 조회 툴 — 전표를 쓰기 전에 "근거"를 끌어오는 쪽.
 *
 * 설계 원칙: 문서를 통째로 주입하지 않고 여기서 필요한 조각만 뽑아 온다. 그래서 반환값은
 * 전부 사람이 바로 읽는 압축 텍스트고, UUID처럼 모델이 쓸 일 없는 식별자는 내보내지
 * 않는다(계정명/프로젝트 코드가 UNIQUE라 이름만으로 충분하다).
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import {
  supabase, fetchAll, getAccounts, getProjects,
  resolveAccount, resolveProject, won, pad, safePattern,
} from '../db.ts'

const JOURNAL_COLUMNS = 'id, journal_no, date, description, is_cancelled, related_journals, projects(code)'
const LINE_COLUMNS = 'journal_id, account_id, debit, credit, counterparty_name, note, classification, activity_type, activity_subtype'

async function idSet(build: () => any, key = 'id'): Promise<Set<string>> {
  return new Set((await fetchAll(build)).map((r) => r[key]))
}

/** 전표 여러 장을 라인까지 붙여 "#no 날짜 [프로젝트] 적요 + 차/대 라인" 텍스트로 만든다. */
export async function renderJournals(journals: any[]): Promise<string> {
  if (!journals.length) return '(없음)'
  const nameById = new Map((await getAccounts()).map((a) => [a.id, a.name]))
  const lines = await fetchAll(() =>
    supabase.from('journal_lines').select(LINE_COLUMNS).in('journal_id', journals.map((j) => j.id)),
  )
  const byJournal = new Map<string, any[]>()
  for (const l of lines) {
    if (!byJournal.has(l.journal_id)) byJournal.set(l.journal_id, [])
    byJournal.get(l.journal_id)!.push(l)
  }

  return journals
    .map((j) => {
      const head = `#${j.journal_no} ${j.date} [${j.projects?.code ?? '-'}] ${j.description ?? ''}${j.is_cancelled ? '  ※취소됨' : ''}`
      const body = (byJournal.get(j.id) ?? [])
        .map((l) => {
          const isDebit = Number(l.debit) > 0
          const cp = l.counterparty_name ? `  ${l.counterparty_name}` : ''
          const note = l.note && l.note !== j.description ? `  // ${l.note}` : ''
          return `  ${isDebit ? '차' : '대'} ${pad(nameById.get(l.account_id) ?? '?', 18)} ${pad(won(isDebit ? l.debit : l.credit), 13, 'right')}${cp}${note}`
        })
        .join('\n')
      const rel = j.related_journals?.length
        ? `\n  ↔ 연계: ${j.related_journals.map((r: any) => `#${r.journal_no}(${r.relation})`).join(', ')}`
        : ''
      return head + '\n' + body + rel
    })
    .join('\n\n')
}

// ── 마스터 ───────────────────────────────────────────────────────────────────

export const masterTool = {
  name: 'erp_master',
  config: {
    description:
      '계정과목/프로젝트/거래처 마스터 조회. 전표를 쓰기 전에 정확한 계정명과 정상측(normal_side)을 확인하는 용도. 계정명·프로젝트 코드는 UNIQUE라 다른 툴에는 이름 그대로 넘기면 된다(UUID 불필요).',
    inputSchema: {
      kind: z.enum(['accounts', 'projects', 'counterparties']).describe('조회할 마스터 종류'),
      query: z.string().optional().describe('이름 부분일치 필터. 생략하면 전체'),
    },
  },
  async handler({ kind, query }: { kind: string; query?: string }) {
    if (kind === 'projects') {
      const rows = (await getProjects()).filter((p) => !query || p.code.includes(query) || p.name.includes(query))
      return rows.map((p) => `${pad(p.code, 14)} ${p.name}${p.is_active === false ? '  ※비활성' : ''}`).join('\n')
    }
    if (kind === 'accounts') {
      const rows = (await getAccounts()).filter((a) => !query || a.name.includes(query))
      if (!rows.length) return `"${query}"에 맞는 계정이 없습니다`
      return [
        `${rows.length}건 — 계정명 / 정상측 / 활동유형 / 증감 라벨(라인의 classification은 여기서 자동 도출됨)`,
        ...rows.map(
          (a) =>
            `${pad(a.name, 20)} ${pad(a.normal_side, 7)} ${pad(a.activity_type, 5)} 증가=${a.increase_label}(${a.increase_type}) / 감소=${a.decrease_label}(${a.decrease_type})${a.is_active === false ? '  ※비활성' : ''}`,
        ),
      ].join('\n')
    }
    let q = supabase.from('counterparties').select('name, business_no, bank_name, note').order('name')
    if (query) q = q.ilike('name', `%${safePattern(query)}%`)
    const { data, error } = await q.limit(40)
    if (error) throw new Error(error.message)
    if (!data.length) return `마스터에 "${query ?? ''}" 거래처 없음 — 은행계좌 등은 자유텍스트로 기록하는 게 관행입니다`
    return data.map((c: any) => `${pad(c.name, 24)} ${c.business_no ?? ''} ${c.bank_name ?? ''} ${c.note ?? ''}`.trimEnd()).join('\n')
  },
}

// ── 전표 검색 ────────────────────────────────────────────────────────────────

export const searchTool = {
  name: 'erp_search_journals',
  config: {
    description:
      '과거 전표 검색. 이 장부의 기본 규칙이 "새 패턴을 만들지 말고 같은 거래처·비슷한 적요의 과거 처리를 따른다"이므로, 전표를 만들기 전에 거의 항상 먼저 호출한다. 조건은 AND 결합.',
    inputSchema: {
      q: z.string().optional().describe('전표 적요 또는 라인 note 부분일치'),
      account: z.string().optional().describe('계정명(부분일치 가능)'),
      counterparty: z.string().optional().describe('거래처명 부분일치'),
      project: z.string().optional().describe('프로젝트 코드'),
      date_from: z.string().optional().describe('YYYY-MM-DD'),
      date_to: z.string().optional().describe('YYYY-MM-DD'),
      amount: z.number().int().optional().describe('차변 또는 대변이 정확히 이 금액인 라인 — 금액으로 원 전표를 찾을 때'),
      journal_no: z.number().int().optional().describe('전표번호 직접 지정(상세 조회용)'),
      include_cancelled: z.boolean().optional().describe('기본 false — 취소 전표 제외'),
      limit: z.number().int().optional().describe('기본 10, 최대 50'),
    },
  },
  async handler(args: any) {
    const limit = Math.min(args.limit ?? 10, 50)
    const sets: Set<string>[] = []

    if (args.project || args.date_from || args.date_to || args.journal_no) {
      const pid = args.project ? (await resolveProject(args.project)).id : null
      sets.push(
        await idSet(() => {
          let b = supabase.from('journals').select('id')
          if (pid) b = b.eq('project_id', pid)
          if (args.date_from) b = b.gte('date', args.date_from)
          if (args.date_to) b = b.lte('date', args.date_to)
          if (args.journal_no) b = b.eq('journal_no', args.journal_no)
          return b
        }),
      )
    }

    if (args.account || args.counterparty || args.amount) {
      const acc = args.account ? await resolveAccount(args.account) : null
      sets.push(
        await idSet(() => {
          let b = supabase.from('journal_lines').select('journal_id')
          if (acc) b = b.eq('account_id', acc.id)
          if (args.counterparty) b = b.ilike('counterparty_name', `%${safePattern(args.counterparty)}%`)
          if (args.amount) b = b.or(`debit.eq.${args.amount},credit.eq.${args.amount}`)
          return b
        }, 'journal_id'),
      )
    }

    if (args.q) {
      const p = `%${safePattern(args.q)}%`
      const [a, b] = await Promise.all([
        idSet(() => supabase.from('journals').select('id').ilike('description', p)),
        idSet(() => supabase.from('journal_lines').select('journal_id').ilike('note', p), 'journal_id'),
      ])
      sets.push(new Set([...a, ...b]))
    }

    let ids: Set<string> | null = null
    if (sets.length) {
      ids = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))))
      if (!ids.size) return '조건에 맞는 전표가 없습니다'
    }

    let journals: any[]
    if (ids && ids.size <= 150) {
      let b = supabase.from('journals').select(JOURNAL_COLUMNS).in('id', [...ids])
      if (!args.include_cancelled) b = b.eq('is_cancelled', false)
      const { data, error } = await b
        .order('date', { ascending: false })
        .order('journal_no', { ascending: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      journals = data
    } else {
      // id가 많으면 in() URL이 너무 길어지므로 정렬·페이징해서 받고 메모리에서 거른다.
      const all = await fetchAll(() => {
        let b = supabase.from('journals').select(JOURNAL_COLUMNS)
        if (!args.include_cancelled) b = b.eq('is_cancelled', false)
        return b.order('date', { ascending: false }).order('journal_no', { ascending: false })
      })
      journals = (ids ? all.filter((j) => ids!.has(j.id)) : all).slice(0, limit)
    }

    if (!journals.length) return '조건에 맞는 전표가 없습니다'
    return `${journals.length}건 표시 (조건 일치 ${ids ? ids.size : '전체'}건 중 최신순)\n\n${await renderJournals(journals)}`
  },
}

// ── 잔액 / 무결성 ────────────────────────────────────────────────────────────

export const balanceTool = {
  name: 'erp_balance',
  config: {
    description:
      '계정별·거래처별·프로젝트별 차변합/대변합/잔액. 이 장부의 정오 판정 기준은 "거래처별 보통예금 잔액 = 실제 은행 잔액"이므로, 통장 전표를 발행하거나 정정한 뒤에는 account="보통예금", group_by="counterparty"로 반드시 대조한다.',
    inputSchema: {
      group_by: z.enum(['account', 'counterparty', 'project']).optional().describe('기본 account'),
      account: z.string().optional().describe('계정명으로 범위 한정'),
      counterparty: z.string().optional().describe('거래처명 부분일치로 범위 한정'),
      project: z.string().optional().describe('프로젝트 코드로 범위 한정'),
      date_from: z.string().optional().describe('YYYY-MM-DD 부터'),
      date_to: z.string().optional().describe('YYYY-MM-DD 시점까지 누계'),
    },
  },
  async handler(args: any) {
    const groupBy = args.group_by ?? 'account'
    const acc = args.account ? await resolveAccount(args.account) : null
    const proj = args.project ? await resolveProject(args.project) : null

    const rows = await fetchAll(() => {
      let b = supabase
        .from('journal_lines')
        .select('account_id, counterparty_name, debit, credit, journals!inner(project_id, is_cancelled)')
        .eq('journals.is_cancelled', false)
      if (acc) b = b.eq('account_id', acc.id)
      if (proj) b = b.eq('journals.project_id', proj.id)
      if (args.counterparty) b = b.ilike('counterparty_name', `%${safePattern(args.counterparty)}%`)
      if (args.date_from) b = b.gte('date', args.date_from)
      if (args.date_to) b = b.lte('date', args.date_to)
      return b
    })
    if (!rows.length) return '해당 조건의 라인이 없습니다'

    const accounts = await getAccounts()
    const accById = new Map(accounts.map((a) => [a.id, a]))
    const projById = new Map((await getProjects()).map((p) => [p.id, p]))

    const keyOf = (r: any) =>
      groupBy === 'account'
        ? accById.get(r.account_id)?.name ?? '?'
        : groupBy === 'counterparty'
          ? r.counterparty_name ?? '(거래처 없음)'
          : projById.get(r.journals.project_id)?.code ?? '(프로젝트 없음)'

    const agg = new Map<string, { debit: number; credit: number }>()
    for (const r of rows) {
      const k = keyOf(r)
      const cur = agg.get(k) ?? { debit: 0, credit: 0 }
      cur.debit += Number(r.debit)
      cur.credit += Number(r.credit)
      agg.set(k, cur)
    }

    // 잔액 부호는 계정의 정상측을 따른다. 계정을 하나로 좁혔으면 그 계정 기준, 계정별
    // 집계면 각 계정 기준, 그 외(여러 계정 혼합)는 차−대 그대로 둔다.
    const balOf = (v: { debit: number; credit: number }, k: string) => {
      const a = groupBy === 'account' ? accounts.find((x) => x.name === k) : acc
      if (!a) return v.debit - v.credit
      return a.normal_side === 'debit' ? v.debit - v.credit : v.credit - v.debit
    }

    const entries = [...agg.entries()].sort((a, b) => Math.abs(balOf(b[1], b[0])) - Math.abs(balOf(a[1], a[0])))
    const scope =
      [
        acc ? `계정=${acc.name}(정상측 ${acc.normal_side})` : null,
        proj ? `프로젝트=${proj.code}` : null,
        args.counterparty ? `거래처~${args.counterparty}` : null,
        args.date_from || args.date_to ? `기간 ${args.date_from ?? '처음'}~${args.date_to ?? '현재'}` : null,
      ]
        .filter(Boolean)
        .join(' / ') || '전체'
    const tot = entries.reduce((a, [, v]) => ({ debit: a.debit + v.debit, credit: a.credit + v.credit }), { debit: 0, credit: 0 })

    return [
      `범위: ${scope} / 취소전표 제외 (${rows.length}개 라인)`,
      `${pad(groupBy, 24)} ${pad('차변합', 14, 'right')} ${pad('대변합', 14, 'right')} ${pad('잔액', 14, 'right')}`,
      ...entries.map(
        ([k, v]) => `${pad(k, 24)} ${pad(won(v.debit), 14, 'right')} ${pad(won(v.credit), 14, 'right')} ${pad(won(balOf(v, k)), 14, 'right')}`,
      ),
      `${pad('합계', 24)} ${pad(won(tot.debit), 14, 'right')} ${pad(won(tot.credit), 14, 'right')}`,
    ].join('\n')
  },
}

export const integrityTool = {
  name: 'erp_integrity_check',
  config: {
    description: '장부 무결성 점검 — 차대가 맞지 않는 전표/프로젝트를 찾는다(정상이면 0건). 전표를 발행·정정한 뒤 마무리로 호출한다.',
    inputSchema: {},
  },
  async handler() {
    const [uj, up] = await Promise.all([
      supabase.from('unbalanced_journals').select('journal_id, total_debit, total_credit, diff'),
      supabase.from('unbalanced_project_totals').select('project_id, total_debit, total_credit, diff'),
    ])
    if (uj.error) throw new Error(uj.error.message)
    if (up.error) throw new Error(up.error.message)

    const out: string[] = []
    if (!uj.data.length) out.push('✅ 차대 불균형 전표 0건')
    else {
      const { data: js } = await supabase
        .from('journals')
        .select('id, journal_no, date, description')
        .in('id', uj.data.map((r: any) => r.journal_id))
      const byId = new Map((js ?? []).map((j: any) => [j.id, j]))
      out.push(`❌ 차대 불균형 전표 ${uj.data.length}건`)
      for (const r of uj.data) {
        const j: any = byId.get(r.journal_id)
        out.push(`  #${j?.journal_no} ${j?.date} ${j?.description ?? ''} — 차 ${won(r.total_debit)} / 대 ${won(r.total_credit)} (차이 ${won(r.diff)})`)
      }
    }

    const pById = new Map((await getProjects()).map((p) => [p.id, p]))
    if (!up.data.length) out.push('✅ 프로젝트별 차대 불균형 0건')
    else {
      out.push(`❌ 프로젝트별 차대 불균형 ${up.data.length}건`)
      for (const r of up.data) {
        out.push(`  ${pById.get(r.project_id)?.code ?? '(없음)'} — 차 ${won(r.total_debit)} / 대 ${won(r.total_credit)} (차이 ${won(r.diff)})`)
      }
    }
    return out.join('\n')
  },
}

// ── 관행/결정 문서 ───────────────────────────────────────────────────────────

export interface DocSection { src: string; title: string; body: string }

function readSections(fileUrl: URL, src: string): DocSection[] {
  let raw: string
  try {
    raw = readFileSync(fileUrl, 'utf8')
  } catch {
    return []
  }
  // H2에서만 자른다 — H3까지 쪼개면 "무엇을 바꿨나" 같은 제목만 남아 목차가 무의미해지고,
  // 하위 절이 부모 맥락에서 떨어져 나온다.
  return raw
    .split(/\n(?=## )/)
    .map((p) => ({ src, title: p.split('\n')[0].replace(/^#+\s*/, '').trim(), body: p.trim() }))
    .filter((s) => s.title)
}

export async function collectDocs(source: string): Promise<DocSection[]> {
  const want = (s: string) => source === 'all' || source === s
  const docs: DocSection[] = []
  if (want('posting')) docs.push(...readSections(new URL('../../../docs/manual-posting-conventions.md', import.meta.url), 'posting'))
  if (want('decisions')) docs.push(...readSections(new URL('../../../docs/decisions.md', import.meta.url), 'decisions'))
  if (want('db')) {
    const { data } = await supabase.from('posting_conventions').select('topic, body, project_id')
    const pById = new Map((await getProjects()).map((p) => [p.id, p]))
    for (const r of (data ?? []) as any[]) {
      docs.push({ src: `db:${pById.get(r.project_id)?.code ?? '?'}`, title: r.topic, body: r.body })
    }
  }
  return docs
}

export const conventionsTool = {
  name: 'erp_conventions',
  config: {
    description:
      '전표 발행 관행과 과거 결정 기록을 목차 → 본문 순으로 가져온다. topic 없이 호출하면 제목 목록만 오고, topic을 주면 해당 섹션 본문만 온다. 선급금/인출금/출자금/가수금, 미지급금 3종, 하나카드 3자 분할 정산처럼 계정 선택이 헷갈리는 케이스는 발행 전에 반드시 확인할 것.',
    inputSchema: {
      topic: z.string().optional().describe('섹션 제목 또는 본문 부분일치. 생략하면 목차만 반환'),
      source: z.enum(['posting', 'decisions', 'db', 'all']).optional().describe('posting=수기 전표 관행 문서, decisions=결정 기록, db=프로젝트별 posting_conventions 테이블. 기본 all'),
    },
  },
  async handler({ topic, source = 'all' }: { topic?: string; source?: string }) {
    const docs = await collectDocs(source)
    if (!topic) {
      const byS = new Map<string, string[]>()
      for (const d of docs) {
        if (!byS.has(d.src)) byS.set(d.src, [])
        byS.get(d.src)!.push(d.title)
      }
      return [
        '목차만 반환했습니다 — 필요한 섹션 제목을 topic으로 다시 호출하세요.',
        ...[...byS.entries()].map(([s, titles]) => `\n[${s}]\n${titles.map((t) => `  - ${t}`).join('\n')}`),
      ].join('\n')
    }
    // 제목이 걸린 섹션이 있으면 그것만 준다 — 본문 언급까지 섞으면 엉뚱한 절이 먼저 나온다.
    const byTitle = docs.filter((d) => d.title.includes(topic))
    const hit = byTitle.length ? byTitle : docs.filter((d) => d.body.includes(topic))
    if (!hit.length) return `"${topic}"에 맞는 섹션이 없습니다. topic 없이 호출해 목차를 먼저 보세요.`
    const shown = hit.slice(0, 3)
    const more = hit.length > shown.length ? `\n\n(본문에 "${topic}"이 언급된 섹션이 ${hit.length - shown.length}개 더 있습니다)` : ''
    return shown.map((d) => `── [${d.src}] ${d.title} ──\n${d.body}`).join('\n\n') + more
  },
}

export const queryTools = [masterTool, searchTool, balanceTool, integrityTool, conventionsTool]
