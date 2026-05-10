import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import SpendingChecklist from './SpendingChecklist'
import SpendingFilter from './SpendingFilter'

function thisMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthToRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const from = `${ym}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${ym}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; project?: string; from?: string; to?: string }>
}) {
  const sp = await searchParams
  const defaultMonth = thisMonthValue()
  const supabase = createAdminClient()

  const hasQuery = sp.month !== undefined || sp.from !== undefined || sp.to !== undefined

  let from: string, to: string, activeMonth: string
  if (sp.month) {
    ;({ from, to } = monthToRange(sp.month))
    activeMonth = sp.month
  } else if (sp.from && sp.to) {
    from = sp.from
    to   = sp.to
    activeMonth = ''
  } else {
    ;({ from, to } = monthToRange(defaultMonth))
    activeMonth = defaultMonth
  }

  // 프로젝트 목록
  const { data: projects } = await (supabase as any)
    .from('projects').select('id, code').order('code') as { data: Array<{ id: string; code: string }> | null }
  const projList = projects ?? []

  let executions: any[] = []
  if (hasQuery) {
    let sourceIds: string[] | null = null

    if (sp.project) {
      const proj = projList.find(p => p.code === sp.project)
      if (proj) {
        const [{ data: loans }, { data: plans }] = await Promise.all([
          (supabase as any).from('loans').select('id').eq('project_id', proj.id) as any,
          (supabase as any).from('spending_plans').select('id').eq('project_id', proj.id) as any,
        ])
        sourceIds = [
          ...((loans ?? []).map((l: any) => l.id)),
          ...((plans ?? []).map((p: any) => p.id)),
        ]
      }
    }

    if (sourceIds === null || sourceIds.length > 0) {
      let query = (supabase as any)
        .from('spending_executions')
        .select('*')
        .gte('planned_date', from)
        .lte('planned_date', to)
        .order('planned_date')

      if (sourceIds !== null) {
        query = query.in('source_id', sourceIds)
      }

      const { data } = await query as any
      executions = data ?? []
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">지출예정</h2>
        <div className="flex gap-2">
          <Link href="/spending/plans">
            <Button size="sm" variant="outline">지출계획 관리</Button>
          </Link>
        </div>
      </div>

      <SpendingFilter
        projects={projList}
        currentMonth={activeMonth || defaultMonth}
        currentProject={sp.project ?? ''}
      />

      {/* 날짜 범위 직접 지정 (보조) */}
      <details className="text-sm text-gray-500">
        <summary className="cursor-pointer select-none">기간 직접 지정</summary>
        <form className="flex items-center gap-2 mt-2">
          <input type="date" name="from" defaultValue={from}
            className="border rounded px-3 py-1.5 text-sm" />
          <span className="text-gray-400">~</span>
          <input type="date" name="to" defaultValue={to}
            className="border rounded px-3 py-1.5 text-sm" />
          <Button type="submit" size="sm" variant="outline">조회</Button>
        </form>
      </details>

      {hasQuery
        ? <SpendingChecklist executions={executions} />
        : <p className="text-sm text-gray-400 py-8 text-center">월을 선택하고 조회 버튼을 누르세요.</p>
      }
    </div>
  )
}
