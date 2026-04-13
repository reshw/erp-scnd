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
  searchParams: Promise<{ project?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const supabase = createAdminClient()

  let query = supabase
    .from('journals')
    .select(`
      id, journal_no, date, description, is_cancelled,
      projects!left(code),
      journal_lines(debit, credit, classification, counterparty_name, accounts!inner(name))
    `)
    .order('date', { ascending: false })
    .order('journal_no', { ascending: false })
    .limit(1000)

  if (params.project) {
    const { data: proj } = await (supabase as any)
      .from('projects')
      .select('id')
      .eq('code', params.project)
      .single() as { data: { id: string } | null }
    if (proj) query = query.eq('project_id', proj.id)
  }
  if (params.from) query = query.gte('date', params.from)
  if (params.to)   query = query.lte('date', params.to)

  const { data: journals } = await query
  const rows = (journals ?? []) as unknown as Array<{
    id: string; journal_no: number; date: string; description: string | null; is_cancelled: boolean
    projects: { code: string } | null
    journal_lines: Array<{ debit: number; credit: number; classification: string; counterparty_name: string | null; accounts: { name: string } }>
  }>

  const { data: projects } = await (supabase as any).from('projects').select('code').order('code') as { data: Array<{ code: string }> | null }

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

      {/* 필터 */}
      <form className="flex gap-2 flex-wrap">
        <select name="project" defaultValue={params.project ?? ''}
          className="border rounded px-2 py-1 text-sm"
>
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
              const totalDebit  = j.journal_lines.reduce((s, l) => s + (l.debit  ?? 0), 0)
              const totalCredit = j.journal_lines.reduce((s, l) => s + (l.credit ?? 0), 0)
              const lines = j.journal_lines

              return lines.map((line, li) => (
                <TableRow
                  key={`${j.id}-${li}`}
                  className={`${j.is_cancelled ? 'opacity-40 line-through' : ''} ${li === 0 ? 'border-t-2 border-gray-200' : ''} hover:bg-gray-50`}
                >
                  {li === 0 && (
                    <>
                      <TableCell rowSpan={lines.length} className="text-sm text-gray-400 border-r align-top pt-3">
                        <Link href={`/journals/${j.id}`} className="hover:underline text-blue-600">
                          {j.journal_no}
                        </Link>
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
    </div>
  )
}
