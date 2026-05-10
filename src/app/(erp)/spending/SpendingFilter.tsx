'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Project { id: string; code: string }

export default function SpendingFilter({
  projects,
  currentMonth,
  currentProject,
}: {
  projects: Project[]
  currentMonth: string
  currentProject: string
}) {
  const router = useRouter()

  function buildUrl(month: string, project: string) {
    const p = new URLSearchParams()
    p.set('month', month)
    if (project) p.set('project', project)
    return `/spending?${p}`
  }

  function shiftMonth(delta: number) {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    router.push(buildUrl(ym, currentProject))
  }

  return (
    <form
      className="flex items-center gap-2 text-sm"
      onSubmit={e => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const month   = fd.get('month') as string
        const project = fd.get('project') as string
        router.push(buildUrl(month, project))
      }}
    >
      {/* 월 네비게이션 */}
      <button
        type="button"
        onClick={() => shiftMonth(-1)}
        className="border rounded px-2 py-1 hover:bg-gray-50 text-gray-600"
      >‹</button>

      <input
        type="month"
        name="month"
        defaultValue={currentMonth}
        className="border rounded px-3 py-1.5 text-sm"
      />

      <button
        type="button"
        onClick={() => shiftMonth(1)}
        className="border rounded px-2 py-1 hover:bg-gray-50 text-gray-600"
      >›</button>

      {/* 프로젝트 필터 */}
      {projects.length > 0 && (
        <select
          name="project"
          defaultValue={currentProject}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="">전체 프로젝트</option>
          {projects.map(p => (
            <option key={p.id} value={p.code}>{p.code}</option>
          ))}
        </select>
      )}

      <Button type="submit" size="sm" variant="outline">조회</Button>
    </form>
  )
}
