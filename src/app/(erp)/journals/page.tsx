import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import MonthNav from './MonthNav'
import FilterPanel from './FilterPanel'

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
    projects?: string   // 체크박스: comma-sep project codes
    project?: string    // MonthNav 호환 (단일)
    account_ids?: string // 체크박스: comma-sep account UUIDs
    cp_ids?: string      // 체크박스: comma-sep counterparty UUIDs
    note?: string
    from?: string
    to?: string
    year?: string
    month?: string
    type?: string
    subtype?: string
    searched?: string
    all?: string
  }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  const hasFilter = !!(
    params.no || params.projects || params.project ||
    params.from || params.to || params.year || params.month ||
    params.type || params.subtype ||
    params.account_ids || params.cp_ids || params.note
  )
  const searched  = params.searched === '1'
  const showAll   = params.all === '1'
  const needsConfirm = searched && !hasFilter && !showAll
  const shouldFetch  = hasFilter || showAll

  // ── 필터 패널용 목록 ──────────────────────────────────────────────────────
  const [
    { data: projectRows },
    { data: accountRows },
    { data: cpRows },
  ] = await Promise.all([
    (supabase as any).from('projects').select('code').order('code') as any,
    (supabase as any).from('accounts').select('id,name').eq('is_active', true).order('name') as any,
    (supabase as any).from('counterparties').select('id,name').order('name') as any,
  ])

  const projectCodes: string[] = (projectRows ?? []).map((p: any) => p.code)
  const accountList: { id: string; name: string }[] = accountRows ?? []
  const cpList: { id: string; name: string }[]      = cpRows ?? []

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
    // year/month → date range
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

    // journal_lines 레벨 필터 → journal_id 목록
    let lineFilterIds: string[] | null = null
    const selAccountIds = params.account_ids?.split(',').filter(Boolean) ?? []
    const selCpIds      = params.cp_ids?.split(',').filter(Boolean) ?? []
    const hasLineFilter = !!(params.type || params.subtype || selAccountIds.length || selCpIds.length)

    if (hasLineFilter) {
      if (selAccountIds.length === 0 && selCpIds.length === 0 && !params.type && !params.subtype) {
        lineFilterIds = []
      } else {
        let lq = (supabase as any).from('journal_lines').select('journal_id')
        if (params.type)          lq = lq.eq('activity_type', params.type)
        if (params.subtype)       lq = lq.eq('activity_subtype', params.subtype)
        if (selAccountIds.length) lq = lq.in('account_id', selAccountIds)
        if (selCpIds.length)      lq = lq.in('counterparty_id', selCpIds)
        if (fromDate) lq = lq.gte('date', fromDate)
        if (toDate)   lq = lq.lte('date', toDate)
        const { data: lineRows } = await lq as any
        lineFilterIds = [...new Set<string>((lineRows ?? []).map((l: any) => l.journal_id))]
      }
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
      // 프로젝트 필터: projects (multi) 또는 project (단일, MonthNav 호환)
      const selProjects = params.projects?.split(',').filter(Boolean) ?? []
      if (selProjects.length > 0) {
        const { data: projIds } = await (supabase as any)
          .from('projects').select('id,code').in('code', selProjects) as any
        const ids = (projIds ?? []).map((p: any) => p.id)
        if (ids.length > 0) query = query.in('project_id', ids)
        else query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      } else if (params.project) {
        const { data: proj } = await (supabase as any)
          .from('projects').select('id').eq('code', params.project).single() as any
        if (proj) query = query.eq('project_id', proj.id)
      }

      if (fromDate)  query = query.gte('date', fromDate)
      if (toDate)    query = query.lte('date', toDate)
      if (params.note) query = (query as any).ilike('description', `%${params.note}%`)

      if (lineFilterIds !== null) {
        if (lineFilterIds.length === 0) {
          query = query.eq('id', '00000000-0000-0000-0000-000000000000')
        } else {
          query = query.in('id', lineFilterIds)
        }
      }
    }

    const { data: journals } = await query
    rows = (journals ?? []) as typeof rows
  }

  // ── 합계 계산 ─────────────────────────────────────────────────────────────
  let totalDebit = 0, totalCredit = 0
  for (const j of rows) {
    for (const l of j.journal_lines) {
      totalDebit  += l.debit
      totalCredit += l.credit
    }
  }

  const confirmAllUrl = '/journals?all=1'

  // MonthNav extra (단일 project 호환 유지)
  const currentYm = (params.year && params.month)
    ? `${params.year}-${String(parseInt(params.month)).padStart(2, '0')}`
    : ''
  const navExtra: Record<string, string> = {}
  if (params.project)  navExtra.project  = params.project
  if (params.projects) navExtra.projects = params.projects
  if (params.type)     navExtra.type     = params.type
  if (params.subtype)  navExtra.subtype  = params.subtype

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

      <MonthNav currentYm={currentYm} extra={navExtra} />

      <FilterPanel
        projects={projectCodes}
        accounts={accountList}
        counterparties={cpList}
      />

      {needsConfirm && (
        <div className="border border-yellow-300 bg-yellow-50 rounded-lg p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-yellow-500 text-xl">⚠</span>
            <div>
              <p className="font-semibold text-gray-800">전체 전표를 조회합니까?</p>
              <p className="text-sm text-gray-500 mt-0.5">필터 없이 조회하면 전체 데이터를 불러옵니다.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={confirmAllUrl}><Button size="sm">확인 — 전체 조회</Button></Link>
            <Link href="/journals"><Button size="sm" variant="outline">취소</Button></Link>
          </div>
        </div>
      )}

      {!searched && !showAll && (
        <div className="text-sm text-gray-400 py-8 text-center border rounded-lg">
          필터를 설정하고 조회 버튼을 누르세요.
        </div>
      )}

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
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold text-sm">
                    <td colSpan={6} className="px-4 py-2 text-gray-500">합계 ({rows.length}건)</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(totalDebit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(totalCredit)}</td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
