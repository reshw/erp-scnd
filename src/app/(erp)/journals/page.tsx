import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(n)
}

const ACTIVITY_COLOR: Record<string, string> = {
  현금: 'bg-blue-100 text-blue-700',
  영업: 'bg-green-100 text-green-700',
  재무: 'bg-purple-100 text-purple-700',
  투자: 'bg-orange-100 text-orange-700',
  개인: 'bg-gray-100 text-gray-700',
  세무: 'bg-red-100 text-red-700',
}

export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    no?: string
    project?: string
    from?: string
    to?: string
    year?: string
    month?: string
    subtype?: string
    searched?: string
    all?: string
  }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const hasFilter = !!(params.no || params.project || params.from || params.to ||
                       params.year || params.month || params.subtype)
  const searched  = params.searched === '1'
  const showAll   = params.all === '1'

  // ── 프로젝트 목록 (필터 폼용, 항상 로드) ────────────────────────────────
  const { data: projects } = await (supabase as any)
    .from('projects').select('code').order('code') as { data: Array<{ code: string }> | null }

  // ── 조회 미실행 상태 ──────────────────────────────────────────────────────
  // 1) 첫 방문 (searched 없음, all 없음): 폼만 표시
  // 2) 빈 필터로 조회 (searched=1, 필터 없음, all 없음): 전체조회 경고
  const needsConfirm = searched && !hasFilter && !showAll
  const shouldFetch  = hasFilter || showAll

  // ── 활성 필터 chip용 ──────────────────────────────────────────────────────
  const activeFilters: string[] = []
  if (params.year && params.month) activeFilters.push(`${params.year}년 ${params.month}월`)
  else if (params.year) activeFilters.push(`${params.year}년`)
  if (params.subtype) activeFilters.push(params.subtype)

  const clearFilterUrl = new URLSearchParams()
  if (params.project) clearFilterUrl.set('project', params.project)
  if (params.from) clearFilterUrl.set('from', params.from)
  if (params.to) clearFilterUrl.set('to', params.to)
  clearFilterUrl.set('searched', '1')

  // ── 데이터 fetch ──────────────────────────────────────────────────────────
  let rows: Array<{
    id: string; journal_no: number; date: string; description: string | null; is_cancelled: boolean
    projects: { code: string } | null
    journal_lines: Array<{
      debit: number; credit: number; classification: string
      activity_subtype: string | null; counterparty_name: string | null
      accounts: { name: string }
    }>
  }> = []

  if (shouldFetch) {
    // year/month → date range 변환
    let fromDate = params.from ?? ''
    let toDate   = params.to   ?? ''
    if (params.year && params.month) {
      const y = parseInt(params.year), m = parseInt(params.month)
      fromDate = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate()
      toDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`
    } else if (params.year) {
      fromDate = `${params.year}-01-01`
      toDate   = `${params.year}-12-31`
    }

    // subtype 필터: 해당 subtype을 가진 journal_id 목록
    let subtypeJournalIds: string[] | null = null
    if (params.subtype) {
      let lq = (supabase as any)
        .from('journal_lines')
        .select('journal_id')
        .eq('activity_subtype', params.subtype)
      if (fromDate) lq = lq.gte('date', fromDate)
      if (toDate)   lq = lq.lte('date', toDate)
      const { data: lineRows } = await lq as { data: Array<{ journal_id: string }> | null }
      subtypeJournalIds = [...new Set((lineRows ?? []).map(l => l.journal_id))]
    }

    let query = supabase
      .from('journals')
      .select(`
        id, journal_no, date, description, is_cancelled,
        projects!left(code),
        journal_lines(debit, credit, classification, activity_subtype, counterparty_name, accounts!inner(name))
      `)
      .order('date', { ascending: false })
      .order('journal_no', { ascending: false })
      .limit(2000)

    if (params.no) {
      const noNum = parseInt(params.no)
      if (!isNaN(noNum)) query = query.eq('journal_no', noNum)
    } else {
      if (params.project) {
        const { data: proj } = await (supabase as any)
          .from('projects').select('id').eq('code', params.project).single() as { data: { id: string } | null }
        if (proj) query = query.eq('project_id', proj.id)
      }
      if (fromDate) query = query.gte('date', fromDate)
      if (toDate)   query = query.lte('date', toDate)
      if (subtypeJournalIds !== null) {
        if (subtypeJournalIds.length === 0) {
          query = query.eq('id', '00000000-0000-0000-0000-000000000000')
        } else {
          query = query.in('id', subtypeJournalIds)
        }
      }
    }

    const { data: journals } = await query
    rows = (journals ?? []) as typeof rows
  }

  // ── 전체 조회 확인 URL (all=1 추가, searched는 제거) ──────────────────────
  const confirmAllUrl = '/journals?all=1'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">현금출납장</h2>
        <div className="flex gap-2">
          <Link href="/journals/upload">
            <Button size="sm" variant="outline">일괄 업로드</Button>
          </Link>
          <Link href="/journals/new">
            <Button size="sm">+ 전표 입력</Button>
          </Link>
        </div>
      </div>

      {/* 필터 폼 */}
      <form className="flex gap-2 flex-wrap items-center">
        <input type="hidden" name="searched" value="1" />
        <input
          type="number"
          name="no"
          defaultValue={params.no ?? ''}
          placeholder="전표번호"
          className="border rounded px-2 py-1 text-sm w-24"
        />
        <select name="project" defaultValue={params.project ?? ''}
          className="border rounded px-2 py-1 text-sm">
          <option value="">전체 프로젝트</option>
          {(projects ?? []).map(p => (
            <option key={p.code} value={p.code}>{p.code}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={params.from ?? ''}
          className="border rounded px-2 py-1 text-sm" />
        <input type="date" name="to" defaultValue={params.to ?? ''}
          className="border rounded px-2 py-1 text-sm" />
        <Button type="submit" size="sm" variant="outline">조회</Button>
      </form>

      {/* 활성 필터 chip */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">필터:</span>
          {activeFilters.map((f, i) => (
            <span key={i} className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
              {f}
            </span>
          ))}
          <Link href={`/journals?${clearFilterUrl.toString()}`} className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">
            필터 초기화
          </Link>
        </div>
      )}

      {/* 전체 조회 경고 */}
      {needsConfirm && (
        <div className="border border-yellow-300 bg-yellow-50 rounded-lg p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-yellow-500 text-xl">⚠</span>
            <div>
              <p className="font-semibold text-gray-800">전체 전표를 조회합니까?</p>
              <p className="text-sm text-gray-500 mt-0.5">필터 없이 조회하면 전체 데이터를 불러옵니다. 건수가 많을 경우 시간이 걸릴 수 있습니다.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={confirmAllUrl}>
              <Button size="sm">확인 — 전체 조회</Button>
            </Link>
            <Link href="/journals">
              <Button size="sm" variant="outline">취소</Button>
            </Link>
          </div>
        </div>
      )}

      {/* 초기 안내 */}
      {!searched && !showAll && (
        <div className="text-sm text-gray-400 py-8 text-center border rounded-lg">
          필터를 설정하고 조회 버튼을 누르세요.
        </div>
      )}

      {/* 결과 */}
      {shouldFetch && (
        <>
          <div className="text-sm text-gray-500">{rows.length}건</div>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-16">No.</TableHead>
                  <TableHead className="w-28">날짜</TableHead>
                  <TableHead className="w-24">프로젝트</TableHead>
                  <TableHead>계정과목</TableHead>
                  <TableHead className="w-32">거래처</TableHead>
                  <TableHead>적요</TableHead>
                  <TableHead className="text-right w-32">차변</TableHead>
                  <TableHead className="text-right w-32">대변</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((j) => {
                  const lines = j.journal_lines
                  return lines.map((line, li) => (
                    <TableRow
                      key={`${j.id}-${li}`}
                      className={`${j.is_cancelled ? 'opacity-40 line-through bg-red-50/30' : ''} ${li === 0 ? 'border-t-2 border-gray-200' : ''} hover:bg-gray-50`}
                    >
                      {li === 0 && (
                        <>
                          <TableCell rowSpan={lines.length} className="text-sm text-gray-400 border-r align-top pt-3">
                            <Link href={`/journals/${j.id}`} className="hover:underline text-blue-600">
                              {j.journal_no}
                            </Link>
                            {j.is_cancelled && (
                              <div className="text-xs text-red-500 font-medium mt-0.5">취소</div>
                            )}
                          </TableCell>
                          <TableCell rowSpan={lines.length} className="text-sm border-r align-top pt-3 whitespace-nowrap">
                            {j.date}
                          </TableCell>
                          <TableCell rowSpan={lines.length} className="text-sm border-r align-top pt-3">
                            {j.projects?.code ?? '-'}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${ACTIVITY_COLOR[line.classification?.split(' - ')[0]] ?? 'bg-gray-100'}`}>
                            {line.classification?.split(' - ')[0]}
                          </span>
                          <span>{line.accounts?.name}</span>
                        </div>
                        {line.activity_subtype && (
                          <div className="text-xs text-gray-400 mt-0.5 ml-0.5">{line.activity_subtype}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {line.counterparty_name ?? ''}
                      </TableCell>
                      {li === 0 && (
                        <TableCell rowSpan={lines.length} className="text-sm text-gray-600 border-l align-top pt-3 max-w-[200px] truncate">
                          {j.description ?? '-'}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-sm tabular-nums">
                        {line.debit  > 0 ? fmt(line.debit)  : ''}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {line.credit > 0 ? fmt(line.credit) : ''}
                      </TableCell>
                    </TableRow>
                  ))
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
