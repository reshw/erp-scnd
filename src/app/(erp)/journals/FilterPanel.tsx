'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import DateRangePicker from '@/components/ui/DateRangePicker'

interface Props {
  projects: string[]
  accounts: { id: string; name: string }[]
  counterparties: { id: string; name: string }[]
}

function CheckGroup({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string
  items: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
}) {
  const [q, setQ] = useState('')
  const filtered = q.trim()
    ? items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()))
    : items

  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-gray-600 mb-1">
        {label}
        {selected.size > 0 && (
          <span className="ml-1 text-blue-600">({selected.size})</span>
        )}
      </div>
      {items.length > 6 && (
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="검색..."
          className="border rounded px-2 py-0.5 text-xs w-full mb-1"
        />
      )}
      <div className="max-h-40 overflow-y-auto border rounded p-1.5 bg-white space-y-0.5">
        {filtered.map(item => (
          <label
            key={item.id}
            className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded"
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={e => onToggle(item.id, e.target.checked)}
              className="accent-blue-600 shrink-0"
            />
            <span className="truncate">{item.name}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="text-xs text-gray-400 px-1 py-1">결과 없음</div>
        )}
      </div>
    </div>
  )
}

function toggle(prev: Set<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(prev)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}

export default function FilterPanel({ projects, accounts, counterparties }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [selProjects, setSelProjects] = useState<Set<string>>(
    () => new Set(sp.get('projects')?.split(',').filter(Boolean) ?? [])
  )
  const [selAccounts, setSelAccounts] = useState<Set<string>>(
    () => new Set(sp.get('account_ids')?.split(',').filter(Boolean) ?? [])
  )
  const [selCps, setSelCps] = useState<Set<string>>(
    () => new Set(sp.get('cp_ids')?.split(',').filter(Boolean) ?? [])
  )
  const [note, setNote] = useState(sp.get('note') ?? '')
  const [from, setFrom] = useState(sp.get('from') ?? '')
  const [to, setTo] = useState(sp.get('to') ?? '')
  const [no, setNo] = useState(sp.get('no') ?? '')

  function buildParams(f: string, t: string) {
    const params = new URLSearchParams()
    params.set('searched', '1')
    if (selProjects.size) params.set('projects', [...selProjects].join(','))
    if (selAccounts.size) params.set('account_ids', [...selAccounts].join(','))
    if (selCps.size)      params.set('cp_ids', [...selCps].join(','))
    if (note) params.set('note', note)
    if (f) params.set('from', f)
    if (t) params.set('to', t)
    if (no) params.set('no', no)
    return params
  }

  function apply() {
    startTransition(() => router.push(`/journals?${buildParams(from, to).toString()}`))
  }

  function reset() {
    setSelProjects(new Set()); setSelAccounts(new Set()); setSelCps(new Set())
    setNote(''); setFrom(''); setTo(''); setNo('')
    startTransition(() => router.push('/journals'))
  }

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
      {/* 상단 텍스트 필터 행 */}
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">전표번호</div>
          <input type="number" value={no} onChange={e => setNo(e.target.value)}
            placeholder="번호" className="border rounded px-2 py-1.5 text-sm w-20 bg-white" />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">기간</div>
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => { setFrom(f); setTo(t) }}
            onMonthChange={(f, t) => {
              setFrom(f); setTo(t)
              startTransition(() => router.push(`/journals?${buildParams(f, t).toString()}`))
            }}
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">적요 검색</div>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="적요" className="border rounded px-2 py-1.5 text-sm w-36 bg-white" />
        </div>
      </div>

      {/* 체크박스 필터 그룹 */}
      <div className="grid grid-cols-3 gap-4">
        <CheckGroup
          label="프로젝트"
          items={projects.map(p => ({ id: p, name: p }))}
          selected={selProjects}
          onToggle={(id, checked) => setSelProjects(prev => toggle(prev, id, checked))}
        />
        <CheckGroup
          label="계정과목"
          items={accounts}
          selected={selAccounts}
          onToggle={(id, checked) => setSelAccounts(prev => toggle(prev, id, checked))}
        />
        <CheckGroup
          label="거래처"
          items={counterparties}
          selected={selCps}
          onToggle={(id, checked) => setSelCps(prev => toggle(prev, id, checked))}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={apply} disabled={isPending}>
          {isPending ? '조회 중...' : '조회'}
        </Button>
        <Button size="sm" variant="outline" onClick={reset} disabled={isPending}>
          초기화
        </Button>
      </div>
    </div>
  )
}
