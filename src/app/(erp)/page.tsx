import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default async function DashboardPage() {
  const supabase = createAdminClient()

  // 보통예금 account ID 조회
  const { data: bankAcc } = await supabase
    .from('accounts')
    .select('id')
    .eq('name', '보통예금')
    .single()

  const bankAccId = (bankAcc as any)?.id as string | undefined

  // 보통예금 라인 전체 (project_id, counterparty_name 포함)
  const { data: bankLinesRaw } = bankAccId
    ? await (supabase as any)
        .from('journal_lines')
        .select('debit, credit, counterparty_name, journals!inner(project_id)')
        .eq('account_id', bankAccId)
        .limit(100000) as any
    : { data: [] }

  const bankLines = (bankLinesRaw ?? []) as Array<{
    debit: number; credit: number; counterparty_name: string | null
    journals: { project_id: string | null }
  }>

  // 프로젝트 목록
  const { data: projectsRaw } = await supabase.from('projects').select('id, code').order('code')
  const projects = (projectsRaw ?? []) as Array<{ id: string; code: string }>

  // 프로젝트별 보통예금 잔고
  const projectBalance: Record<string, number> = {}
  for (const l of bankLines) {
    const pid = l.journals?.project_id
    if (!pid) continue
    projectBalance[pid] = (projectBalance[pid] ?? 0) + (l.debit ?? 0) - (l.credit ?? 0)
  }

  // 통장별 잔고
  const bankBalance: Record<string, number> = {}
  for (const l of bankLines) {
    const cp = l.counterparty_name
    if (!cp) continue
    bankBalance[cp] = (bankBalance[cp] ?? 0) + (l.debit ?? 0) - (l.credit ?? 0)
  }
  const bankEntries = Object.entries(bankBalance).sort((a, b) => b[1] - a[1])
  const totalBankBalance = bankEntries.reduce((s, [, v]) => s + v, 0)

  // ── 무결성 체크: 전표별 차대 불균형 ──────────────────
  const { data: allLinesRaw } = await (supabase as any)
    .from('journal_lines')
    .select('journal_id, debit, credit')
    .limit(100000) as any

  const allLines = (allLinesRaw ?? []) as Array<{ journal_id: string; debit: number; credit: number }>

  // journal_id별 합산
  const lineSum: Record<string, { debit: number; credit: number }> = {}
  for (const l of allLines) {
    if (!lineSum[l.journal_id]) lineSum[l.journal_id] = { debit: 0, credit: 0 }
    lineSum[l.journal_id].debit  += Number(l.debit)  ?? 0
    lineSum[l.journal_id].credit += Number(l.credit) ?? 0
  }

  // 불균형 journal_id 목록
  const unbalancedIds = Object.entries(lineSum)
    .filter(([, s]) => Math.abs(s.debit - s.credit) > 0)
    .map(([id, s]) => ({ id, diff: s.debit - s.credit, debit: s.debit, credit: s.credit }))

  // 불균형 전표 헤더 조회
  let unbalancedJournals: Array<{ id: string; journal_no: number; date: string; description: string | null; diff: number }> = []
  if (unbalancedIds.length > 0) {
    const { data: ubJournals } = await (supabase as any)
      .from('journals')
      .select('id, journal_no, date, description')
      .in('id', unbalancedIds.map(u => u.id))
      .order('date') as any
    const diffMap = Object.fromEntries(unbalancedIds.map(u => [u.id, u.diff]))
    unbalancedJournals = (ubJournals ?? []).map((j: any) => ({
      ...j, diff: diffMap[j.id] ?? 0,
    }))
  }

  // ── 프로젝트별 전체 차대 불균형 ──────────────────────
  const { data: allJournalsRaw } = await (supabase as any)
    .from('journals')
    .select('id, project_id')
    .limit(10000) as any
  const journalProjectMap: Record<string, string | null> = {}
  for (const j of (allJournalsRaw ?? [])) journalProjectMap[j.id] = j.project_id

  const projectLineSum: Record<string, { debit: number; credit: number }> = {}
  for (const l of allLines) {
    const pid = journalProjectMap[l.journal_id] ?? '__none__'
    if (!projectLineSum[pid]) projectLineSum[pid] = { debit: 0, credit: 0 }
    projectLineSum[pid].debit  += Number(l.debit)
    projectLineSum[pid].credit += Number(l.credit)
  }
  const projectCodeMap = Object.fromEntries(projects.map(p => [p.id, p.code]))
  const unbalancedProjects = Object.entries(projectLineSum)
    .filter(([, s]) => Math.abs(s.debit - s.credit) > 0)
    .map(([pid, s]) => ({
      code: pid === '__none__' ? '(프로젝트 없음)' : (projectCodeMap[pid] ?? pid),
      diff: s.debit - s.credit,
    }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  // 최근 전표
  const { data: journalsRaw } = await supabase
    .from('journals')
    .select('id, journal_no, date, description, is_cancelled, projects!left(code)')
    .order('date', { ascending: false })
    .order('journal_no', { ascending: false })
    .limit(20)

  const journalsData = (journalsRaw ?? []) as unknown as Array<{
    id: string; journal_no: number; date: string; description: string | null
    is_cancelled: boolean; projects: { code: string } | null
  }>

  const journalIds = journalsData.map(j => j.id)
  const { data: linesRaw } = journalIds.length
    ? await supabase.from('journal_lines').select('journal_id, debit').in('journal_id', journalIds)
    : { data: [] }

  const linesByJournal: Record<string, number> = {}
  for (const l of (linesRaw ?? []) as unknown as Array<{ journal_id: string; debit: number }>) {
    linesByJournal[l.journal_id] = (linesByJournal[l.journal_id] ?? 0) + (l.debit ?? 0)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">대시보드</h2>

      {/* 프로젝트별 / 통장별 잔고 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 프로젝트별 */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">프로젝트</th>
                <th className="text-right px-4 py-2">보통예금 잔고</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {projects.map(p => {
                const bal = projectBalance[p.id] ?? 0
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-gray-700">{p.code}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${bal < 0 ? 'text-red-600' : ''}`}>{fmt(bal)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 font-bold text-sm">
              <tr>
                <td className="px-4 py-2 text-gray-600">합계</td>
                <td className={`px-4 py-2 text-right tabular-nums ${totalBankBalance < 0 ? 'text-red-600' : ''}`}>{fmt(totalBankBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 통장별 */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">통장</th>
                <th className="text-right px-4 py-2">잔고</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bankEntries.map(([name, bal]) => (
                <tr key={name}>
                  <td className="px-4 py-2 text-gray-700">{name}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${bal < 0 ? 'text-red-600' : ''}`}>{fmt(bal)}</td>
                </tr>
              ))}
              {bankEntries.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400">데이터 없음</td></tr>
              )}
            </tbody>
            <tfoot className="bg-gray-50 font-bold text-sm">
              <tr>
                <td className="px-4 py-2 text-gray-600">합계</td>
                <td className={`px-4 py-2 text-right tabular-nums ${totalBankBalance < 0 ? 'text-red-600' : ''}`}>{fmt(totalBankBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 무결성 검사 */}
      {unbalancedJournals.length === 0 && unbalancedProjects.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <span>✓</span>
          <span>무결성 검사 완료 — 모든 전표의 차변·대변이 일치합니다.</span>
        </div>
      )}
      {(unbalancedJournals.length > 0 || unbalancedProjects.length > 0) && (
        <div className="space-y-2">
          {/* 전표 불균형 */}
          {unbalancedJournals.length > 0 && (
            <details className="border border-red-200 rounded-lg bg-red-50">
              <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-red-700 flex items-center gap-2">
                <span className="text-red-500">⚠</span>
                차대 불균형 전표 {unbalancedJournals.length}건 — 클릭하여 확인
              </summary>
              <div className="border-t border-red-200">
                <table className="w-full text-sm">
                  <thead className="bg-red-100 text-xs text-red-600">
                    <tr>
                      <th className="text-left px-4 py-2">No.</th>
                      <th className="text-left px-4 py-2">날짜</th>
                      <th className="text-left px-4 py-2">적요</th>
                      <th className="text-right px-4 py-2">차대 차액</th>
                      <th className="w-16 px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {unbalancedJournals.map(j => (
                      <tr key={j.id} className="bg-white">
                        <td className="px-4 py-2">{j.journal_no}</td>
                        <td className="px-4 py-2">{j.date}</td>
                        <td className="px-4 py-2 text-gray-600">{j.description ?? '-'}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-red-600 font-medium">
                          {j.diff > 0 ? '+' : ''}{fmt(j.diff)}
                        </td>
                        <td className="px-4 py-2">
                          <Link href={`/journals/${j.id}`} className="text-blue-600 hover:underline text-xs">수정</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* 프로젝트 불균형 */}
          {unbalancedProjects.length > 0 && (
            <details className="border border-orange-200 rounded-lg bg-orange-50">
              <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-orange-700 flex items-center gap-2">
                <span className="text-orange-500">⚠</span>
                프로젝트별 차대 불균형 {unbalancedProjects.length}건 — 클릭하여 확인
              </summary>
              <div className="border-t border-orange-200">
                <table className="w-full text-sm">
                  <thead className="bg-orange-100 text-xs text-orange-600">
                    <tr>
                      <th className="text-left px-4 py-2">프로젝트</th>
                      <th className="text-right px-4 py-2">차대 차액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-100">
                    {unbalancedProjects.map(p => (
                      <tr key={p.code} className="bg-white">
                        <td className="px-4 py-2 font-medium">{p.code}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-orange-700 font-medium">
                          {p.diff > 0 ? '+' : ''}{fmt(p.diff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* 최근 전표 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">최근 전표</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>날짜</TableHead>
                  <TableHead>프로젝트</TableHead>
                  <TableHead>적요</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journalsData.map((j) => (
                  <TableRow key={j.id} className={j.is_cancelled ? 'opacity-40 line-through' : ''}>
                    <TableCell className="text-sm text-gray-500">
                      <Link href={`/journals/${j.id}`} className="text-blue-600 hover:underline">{j.journal_no}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{j.date}</TableCell>
                    <TableCell className="text-sm">{(j.projects as any)?.code ?? '-'}</TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate">{j.description ?? '-'}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{fmt(linesByJournal[j.id] ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
