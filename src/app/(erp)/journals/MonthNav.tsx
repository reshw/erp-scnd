'use client'

import { useRouter } from 'next/navigation'

export default function MonthNav({
  currentYm,
  extra,
}: {
  currentYm: string        // 'YYYY-MM' or ''
  extra: Record<string, string>  // other params to preserve (project, type, subtype, etc.)
}) {
  const router = useRouter()

  function buildUrl(ym: string) {
    const p = new URLSearchParams()
    if (ym) {
      const [y, m] = ym.split('-')
      p.set('year', y)
      p.set('month', String(parseInt(m)))
    }
    Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v) })
    p.set('searched', '1')
    return `/journals?${p}`
  }

  function shiftMonth(delta: number) {
    const base = currentYm || new Date().toISOString().slice(0, 7)
    const [y, m] = base.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    router.push(buildUrl(ym))
  }

  const displayYm = currentYm || new Date().toISOString().slice(0, 7)

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => shiftMonth(-1)}
        className="border rounded px-2 py-1 text-sm hover:bg-gray-50 text-gray-600"
      >‹</button>
      <input
        type="month"
        name="ym"
        defaultValue={displayYm}
        className="border rounded px-3 py-1.5 text-sm"
        onChange={e => {
          if (e.target.value) router.push(buildUrl(e.target.value))
        }}
      />
      <button
        type="button"
        onClick={() => shiftMonth(1)}
        className="border rounded px-2 py-1 text-sm hover:bg-gray-50 text-gray-600"
      >›</button>
    </div>
  )
}
