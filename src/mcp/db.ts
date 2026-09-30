/**
 * MCP 서버 전용 DB 레이어.
 *
 * Next.js 앱과 같은 Supabase 서비스 롤 키를 쓰지만, 앱의 createAdminClient()를 그대로
 * 재사용하지는 않는다 — 그쪽은 `@/types/database` 경로 별칭을 import하는데, MCP 서버는
 * Claude Code가 띄우는 순수 node 프로세스라 Next.js의 별칭 해석기를 못 탄다.
 * 마찬가지 이유로 .env.local도 여기서 직접 읽는다(cwd가 아니라 이 파일 위치 기준).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  let raw: string
  try {
    raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 를 .env.local에서 찾지 못했습니다')
}

export const supabase: any = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * PostgREST 기본 max-rows(1000)에 조용히 잘려 무결성 체크가 오탐을 낸 전례가 있어
 * (027 마이그레이션 주석 참고) 목록 조회는 항상 페이징해서 전부 가져온다.
 */
export async function fetchAll(buildQuery: () => any): Promise<any[]> {
  const PAGE = 1000
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < PAGE) return out
  }
}

// ── 마스터 캐시 ──────────────────────────────────────────────────────────────
// 계정 50개 / 프로젝트 10개 수준이라 통째로 캐시한다. 세션 중 추가될 수 있어 TTL을 둔다.

export interface AccountRow {
  id: string
  name: string
  activity_type: string
  normal_side: 'debit' | 'credit'
  increase_type: string
  increase_label: string
  decrease_type: string
  decrease_label: string
  is_active: boolean | null
}
export interface ProjectRow {
  id: string
  code: string
  name: string
  is_active: boolean | null
}

export const ACCOUNT_COLUMNS =
  'id, name, activity_type, normal_side, increase_type, increase_label, decrease_type, decrease_label, is_active'

const TTL_MS = 5 * 60 * 1000
const cache: { accounts: AccountRow[] | null; projects: ProjectRow[] | null; at: number } = {
  accounts: null,
  projects: null,
  at: 0,
}

async function loadMasters() {
  if (cache.accounts && cache.projects && Date.now() - cache.at < TTL_MS) return
  const [a, p] = await Promise.all([
    supabase.from('accounts').select(ACCOUNT_COLUMNS).order('name'),
    supabase.from('projects').select('id, code, name, is_active').order('code'),
  ])
  if (a.error) throw new Error(a.error.message)
  if (p.error) throw new Error(p.error.message)
  cache.accounts = a.data
  cache.projects = p.data
  cache.at = Date.now()
}

export async function getAccounts(): Promise<AccountRow[]> {
  await loadMasters()
  return cache.accounts!
}
export async function getProjects(): Promise<ProjectRow[]> {
  await loadMasters()
  return cache.projects!
}

/** 계정명(정확→부분) 또는 UUID로 계정 1건을 확정한다. 모호하면 후보를 던져 되묻게 한다. */
export async function resolveAccount(input: string): Promise<AccountRow> {
  const s = String(input ?? '').trim()
  if (!s) throw new Error('계정과목이 비어 있습니다')
  const accounts = await getAccounts()

  const byId = accounts.find((a) => a.id === s)
  if (byId) return byId
  const exact = accounts.filter((a) => a.name === s)
  if (exact.length === 1) return exact[0]

  const partial = accounts.filter((a) => a.name.includes(s))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new Error(
      `"${s}"에 해당하는 계정이 ${partial.length}개입니다: ${partial.map((a) => a.name).join(', ')} — 정확한 계정명으로 지정하세요`,
    )
  }
  throw new Error(`"${s}" 계정을 찾을 수 없습니다. erp_master(kind:"accounts")로 목록을 확인하세요`)
}

/** 프로젝트 코드/이름/UUID로 프로젝트 1건을 확정한다. */
export async function resolveProject(input: string): Promise<ProjectRow> {
  const s = String(input ?? '').trim()
  if (!s) throw new Error('프로젝트가 비어 있습니다')
  const projects = await getProjects()

  const hit =
    projects.find((p) => p.id === s) ?? projects.find((p) => p.code === s) ?? projects.find((p) => p.name === s)
  if (hit) return hit

  const partial = projects.filter((p) => p.code.includes(s) || p.name.includes(s))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new Error(`"${s}"에 해당하는 프로젝트가 여러 개입니다: ${partial.map((p) => p.code).join(', ')}`)
  }
  throw new Error(`"${s}" 프로젝트를 찾을 수 없습니다. 사용 가능: ${projects.map((p) => p.code).join(', ')}`)
}

/**
 * 거래처를 해석한다. 은행계좌("통장-IM뱅크" 등)는 거래처 마스터에 없는 게 이 장부의
 * 관행이라, 정확히 일치하는 마스터가 있을 때만 counterparty_id를 묶고 나머지는
 * counterparty_name 자유텍스트로 둔다. 오타로 새 표기가 생기는 걸 막으려고
 * 과거에 실제 쓰인 유사 표기를 hint로 함께 돌려준다.
 */
export async function resolveCounterparty(
  input?: string | null,
): Promise<{ id: string | null; name: string | null; hint: string | null }> {
  const s = String(input ?? '').trim()
  if (!s) return { id: null, name: null, hint: null }

  const { data: exact } = await supabase.from('counterparties').select('id, name').eq('name', s).limit(2)
  if (exact?.length === 1) return { id: exact[0].id, name: exact[0].name, hint: null }

  const { data: used } = await supabase
    .from('journal_lines')
    .select('counterparty_name')
    .ilike('counterparty_name', `%${s}%`)
    .not('counterparty_name', 'is', null)
    .limit(50)
  const names = [...new Set((used ?? []).map((r: any) => r.counterparty_name as string))].filter((n) => n !== s)
  return { id: null, name: s, hint: names.length ? `과거 유사 표기: ${names.slice(0, 5).join(', ')}` : null }
}

// ── 포맷 ─────────────────────────────────────────────────────────────────────

export const won = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('ko-KR')

/** 한글은 2칸으로 세어 표 정렬이 덜 어긋나게 한다. */
export function pad(s: unknown, width: number, align: 'left' | 'right' = 'left') {
  const str = String(s)
  const w = [...str].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)
  const fill = ' '.repeat(Math.max(0, width - w))
  return align === 'right' ? fill + str : str + fill
}

/** PostgREST or()/ilike 패턴에서 구분자로 해석되는 문자를 제거한다. */
export const safePattern = (s: string) => String(s).replace(/[(),*%]/g, ' ').trim()
