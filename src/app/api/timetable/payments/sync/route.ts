import { createAdminClient } from '@/lib/supabase/admin'
import { ACCOUNT_META_COLUMNS, insertJournalWithLines, type AccountMeta } from '@/lib/journal'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/timetable/payments/sync
 *
 * timetable(나디아요가)의 결제원장을 커서로 당겨 매출전표를 자동 발행한다.
 * 일 1회 GitHub Actions에서 호출한다(Vercel 크론은 신뢰할 수 없어 쓰지 않는다).
 * 인증: Authorization: Bearer <CRON_SECRET> (proxy.ts에서 /api/timetable 경로 제외됨)
 *
 * 전표 형태 — 승인건(amount > 0):
 *   차변 미수금(채널)  총액
 *   대변 판매수입      공급가액
 *   대변 부가세예수금   세액        (tax_type='exempt'면 전액 판매수입)
 * 취소건(amount < 0)은 같은 라인을 차대만 뒤집어 낸다.
 *
 * timetable 원장이 append-only라 취소는 반대행으로 새로 들어온다. ERP는 행 단위로
 * external_id 유니크 제약(timetable_payment_postings)에 기대어 멱등을 보장하므로,
 * 커서를 겹쳐 읽어도(아래 CURSOR_OVERLAP_MS) 같은 전표를 두 번 끊지 않는다.
 */

const TIMETABLE_API = process.env.TIMETABLE_PAYMENTS_API_URL ?? 'https://nadia.mdl.kr/api/erp/payments'
const PAGE_LIMIT = 500
const MAX_PAGES = 50

/**
 * 커서를 저장값보다 이만큼 앞당겨 재조회한다.
 * timetable API가 `updated_at > since`에 2차 정렬키 없이 페이지를 끊어서,
 * updated_at이 같은 행(분할배분처럼 한 트랜잭션에서 들어간 행들)이 경계에 걸리면
 * 유실될 수 있다. 겹쳐 읽고 external_id로 중복을 버리면 그 구멍이 막힌다.
 * 트리거·배포 지연으로 늦게 들어온 행을 회수하는 효과도 있다.
 */
const CURSOR_OVERLAP_MS = 60 * 60 * 1000

const SYNC_KEY = 'timetable_payments'
const PROJECT_CODE = 'NADIA'

type PaymentRow = {
  external_id: string | null
  payment_group_id: string | null
  source: string
  method: string | null
  amount: number
  status: string
  reverses_external_id: string | null
  product_name: string | null
  tax_type: string
  is_test: boolean
  paid_at: string | null
  updated_at: string
}

/**
 * 채널 → 차변 계정. 승인 시점엔 현금이 안 들어와 있으므로 전부 미수금으로 잡고,
 * 후속 단계에서 정산(입금) 데이터가 붙으면 그때 대변으로 소멸시킨다.
 * 값이 null이면 자동전표 대상이 아니라는 뜻(사유는 receivableAccountName 참조).
 */
function receivableAccountName(source: string, method: string | null): string | null {
  switch (source) {
    case 'toss':
      // POS 현장결제. CASH(현금)·EXTERNAL(외부단말)은 통장으로 들어오는 돈이 아니라 수동처리한다.
      return method === 'CASH' || method === 'EXTERNAL' ? null : '미수금(신용카드)'
    case 'card':
      return '미수금(신용카드)'
    case 'portone':
    case 'kakaopay':
      return '미수금(PG)'
    case 'bank':
      return '미수금(무통장입금)'
    case 'cash':
      return null // 현금 수령 — 금고/입금 흐름을 사람이 판단해야 해서 자동발행하지 않는다
    default:
      return null
  }
}

/** UTC ISO8601 → KST 달력일(YYYY-MM-DD). timetable은 시각을 UTC로 내보낸다. */
function kstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pullToken = process.env.ERP_PAYMENTS_PULL_TOKEN
  if (!pullToken) {
    return NextResponse.json({ error: 'ERP_PAYMENTS_PULL_TOKEN이 설정되지 않았습니다' }, { status: 500 })
  }

  const supabase = createAdminClient()
  const db = supabase as any

  // 1. 커서 조회 — 저장값에서 겹침폭을 뺀 지점부터 다시 읽는다
  const { data: state } = await db.from('sync_state').select('cursor').eq('key', SYNC_KEY).maybeSingle()
  const storedCursor: string | null = state?.cursor ?? null
  const since = storedCursor
    ? new Date(new Date(storedCursor).getTime() - CURSOR_OVERLAP_MS).toISOString()
    : null

  // 2. timetable에서 페이지 단위로 전부 당긴다
  const rows: PaymentRow[] = []
  let pageCursor = since
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(TIMETABLE_API)
    url.searchParams.set('limit', String(PAGE_LIMIT))
    if (pageCursor) url.searchParams.set('since', pageCursor)

    const res = await fetch(url, { headers: { authorization: `Bearer ${pullToken}` }, cache: 'no-store' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `timetable API ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 }
      )
    }
    const json = await res.json() as { data: PaymentRow[]; next_cursor: string | null }
    rows.push(...(json.data ?? []))
    if (!json.next_cursor) break
    pageCursor = json.next_cursor
  }

  if (rows.length === 0) {
    await db.from('sync_state').update({ synced_at: new Date().toISOString() }).eq('key', SYNC_KEY)
    return NextResponse.json({ ok: true, fetched: 0, posted: 0, skipped: 0, duplicate: 0, cursor: storedCursor })
  }

  // 3. 이미 처리한 external_id는 건너뛴다(겹쳐 읽기 때문에 항상 섞여 들어온다)
  const externalIds = rows.map((r) => r.external_id).filter((v): v is string => !!v)
  const { data: posted } = await db
    .from('timetable_payment_postings')
    .select('external_id')
    .in('external_id', externalIds)
  const alreadyPosted = new Set((posted ?? []).map((p: { external_id: string }) => p.external_id))

  // 4. 계정과목·프로젝트 준비
  const [{ data: accounts }, { data: project }] = await Promise.all([
    db.from('accounts').select(ACCOUNT_META_COLUMNS)
      .in('name', ['판매수입', '부가세예수금', '미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)']),
    db.from('projects').select('id').eq('code', PROJECT_CODE).single(),
  ])
  const accountByName = new Map<string, AccountMeta>((accounts ?? []).map((a: AccountMeta) => [a.name, a]))
  const salesAcc = accountByName.get('판매수입')
  const vatAcc = accountByName.get('부가세예수금')
  if (!salesAcc || !vatAcc) {
    return NextResponse.json({ error: '계정과목(판매수입/부가세예수금)을 찾을 수 없습니다' }, { status: 500 })
  }

  // 5. 행 단위로 전표 발행. 전표번호 채번이 직렬이라 순차 처리한다.
  let postedCount = 0
  let skippedCount = 0
  let duplicateCount = 0
  const failures: { external_id: string | null; error: string }[] = []
  let maxUpdatedAt = storedCursor

  for (const row of rows) {
    if (!maxUpdatedAt || row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at

    if (!row.external_id) {
      failures.push({ external_id: null, error: 'external_id가 비어 있어 멱등 보장이 안 됩니다' })
      continue
    }
    if (alreadyPosted.has(row.external_id)) { duplicateCount++; continue }

    // 전표 대상이 아닌 행도 기록은 남긴다 — 다음 실행에서 다시 검토하지 않도록
    const skipReason =
      row.is_test ? '테스트 결제'
      : row.amount === 0 ? '0원(무료부여)'
      : receivableAccountName(row.source, row.method) === null ? `자동전표 제외 채널(${row.source}/${row.method ?? '-'})`
      : null

    if (skipReason) {
      const { error } = await db.from('timetable_payment_postings')
        .insert({ external_id: row.external_id, group_id: row.payment_group_id, journal_id: null, skipped: skipReason, payload: row })
      if (error && error.code !== '23505') failures.push({ external_id: row.external_id, error: error.message })
      else skippedCount++
      continue
    }

    const receivableAcc = accountByName.get(receivableAccountName(row.source, row.method)!)
    if (!receivableAcc) {
      failures.push({ external_id: row.external_id, error: `미수금 계정과목을 찾을 수 없습니다(${row.source})` })
      continue
    }

    const isReversal = row.amount < 0
    const gross = Math.abs(row.amount)
    // 절사 누적오차를 피하려고 총액 기준으로 한 번만 나눈다(timetable revenue.ts와 동일 규칙)
    const supply = row.tax_type === 'exempt' ? gross : Math.round(gross / 1.1)
    const vat = gross - supply

    const receivableSide = isReversal ? 'credit' : 'debit'
    const revenueSide = isReversal ? 'debit' : 'credit'

    const label = row.product_name?.trim() || '결제'
    const channel = `${row.source}${row.method ? `/${row.method}` : ''}`
    const description = `${isReversal ? '[취소] ' : ''}${label} (${channel})`
    const date = kstDate(row.paid_at ?? row.updated_at)

    const lines = [
      { account: receivableAcc, side: receivableSide as 'debit' | 'credit', amount: gross },
      { account: salesAcc, side: revenueSide as 'debit' | 'credit', amount: supply },
    ]
    if (vat > 0) lines.push({ account: vatAcc, side: revenueSide as 'debit' | 'credit', amount: vat })

    try {
      const journal = await insertJournalWithLines(supabase, {
        date,
        description,
        project_id: project?.id ?? null,
        lines,
      })

      const { error: pe } = await db.from('timetable_payment_postings')
        .insert({ external_id: row.external_id, group_id: row.payment_group_id, journal_id: journal.id, payload: row })
      if (pe) {
        // 동시 실행이 같은 행을 먼저 전표화한 경우 — 방금 만든 중복 전표는 버린다
        await db.from('journals').delete().eq('id', journal.id)
        if (pe.code === '23505') duplicateCount++
        else failures.push({ external_id: row.external_id, error: pe.message })
        continue
      }
      postedCount++
    } catch (e) {
      failures.push({ external_id: row.external_id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // 6. 커서 전진. 실패한 행이 있으면 커서를 올리지 않고 다음 실행에서 다시 시도한다.
  const advance = failures.length === 0
  if (advance) {
    await db.from('sync_state')
      .update({ cursor: maxUpdatedAt, synced_at: new Date().toISOString() })
      .eq('key', SYNC_KEY)
  } else {
    await db.from('sync_state').update({ synced_at: new Date().toISOString() }).eq('key', SYNC_KEY)
  }

  return NextResponse.json({
    ok: failures.length === 0,
    fetched: rows.length,
    posted: postedCount,
    skipped: skippedCount,
    duplicate: duplicateCount,
    cursor: advance ? maxUpdatedAt : storedCursor,
    ...(failures.length > 0 && { failures }),
  }, { status: failures.length > 0 ? 500 : 200 })
}
