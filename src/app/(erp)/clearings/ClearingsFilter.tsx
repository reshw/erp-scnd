'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  required,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  required?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find(o => o.id === value)?.label ?? ''
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())).slice(0, 40)
    : options.slice(0, 40)

  return (
    <div className="relative">
      <div className={`flex items-center border rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400 bg-white ${required && !value ? 'border-red-300' : ''}`}>
        <input
          type="text"
          value={open ? query : selectedLabel}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 text-sm outline-none min-w-0"
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); setQuery('') }}
            className="px-2 text-gray-300 hover:text-gray-500 text-xs">✕</button>
        )}
      </div>
      {open && (
        <ul className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-52 overflow-y-auto text-sm">
          {!required && (
            <li onMouseDown={() => { onChange(''); setOpen(false) }}
              className="px-3 py-2 text-gray-400 cursor-pointer hover:bg-gray-50">전체</li>
          )}
          {filtered.map(o => (
            <li key={o.id} onMouseDown={() => { onChange(o.id); setOpen(false) }}
              className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${o.id === value ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}>
              {o.label}
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-2 text-gray-400">결과 없음</li>}
        </ul>
      )}
    </div>
  )
}

// 거래처별 미결잔액을 챙겨봐야 하는 잔액성 계정 프리셋 — 선택 즉시 조회까지 실행한다.
const PRESET_ACCOUNT_NAMES = [
  '미수금(신용카드)', '미수금(무통장입금)', '미수금(PG)',
  '선급금', '선급금(투자)', '선수금',
  '미지급금(매입)', '미지급금(원리금)', '미지급금(기타)', '관리비예수금',
]

export default function ClearingsFilter({
  accounts,
  projects,
}: {
  accounts: { id: string; name: string }[]
  projects: { id: string; code: string }[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [accountId,  setAccountId]  = useState(sp.get('account_id') ?? '')
  const [projectIds, setProjectIds] = useState<Set<string>>(
    new Set((sp.get('project_ids') ?? '').split(',').filter(Boolean))
  )
  const [asOf,       setAsOf]       = useState(sp.get('as_of') ?? '')
  const [openOnly,   setOpenOnly]   = useState(sp.get('open_only') === '1')
  const [projectOpen, setProjectOpen] = useState(false)

  const presets = PRESET_ACCOUNT_NAMES
    .map(name => accounts.find(a => a.name === name))
    .filter((a): a is { id: string; name: string } => !!a)

  function toggleProject(id: string) {
    setProjectIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function buildParams(id: string = accountId) {
    const params = new URLSearchParams()
    params.set('account_id', id)
    if (projectIds.size) params.set('project_ids', [...projectIds].join(','))
    if (asOf) params.set('as_of', asOf)
    if (openOnly) params.set('open_only', '1')
    return params
  }

  function apply() {
    if (!accountId) return
    startTransition(() => router.push(`/clearings?${buildParams().toString()}`))
  }

  function applyPreset(id: string) {
    setAccountId(id)
    startTransition(() => router.push(`/clearings?${buildParams(id).toString()}`))
  }

  const projectLabel = projectIds.size === 0
    ? '전체'
    : projectIds.size === 1
      ? projects.find(p => projectIds.has(p.id))?.code ?? '1개'
      : `${projectIds.size}개 선택`

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                p.id === accountId
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">계정과목 *</div>
          <SearchSelect
            options={accounts.map(a => ({ id: a.id, label: a.name }))}
            value={accountId}
            onChange={setAccountId}
            placeholder="계정과목 선택..."
            required
          />
        </div>
        <div className="relative">
          <div className="text-xs font-semibold text-gray-600 mb-1">프로젝트</div>
          <button
            type="button"
            onClick={() => setProjectOpen(v => !v)}
            onBlur={() => setTimeout(() => setProjectOpen(false), 150)}
            className="w-full flex items-center justify-between border rounded px-3 py-1.5 text-sm bg-white text-left"
          >
            <span className={projectIds.size ? '' : 'text-gray-400'}>{projectLabel}</span>
            <span className="text-gray-300">▾</span>
          </button>
          {projectOpen && (
            <ul className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-52 overflow-y-auto text-sm p-1">
              <li
                onMouseDown={() => setProjectIds(new Set())}
                className="px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50 text-gray-400"
              >
                전체 (선택 해제)
              </li>
              {projects.map(p => (
                <li
                  key={p.id}
                  onMouseDown={() => toggleProject(p.id)}
                  className="px-2 py-1.5 rounded cursor-pointer hover:bg-blue-50 flex items-center gap-2"
                >
                  <input type="checkbox" readOnly checked={projectIds.has(p.id)} className="rounded" />
                  {p.code}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">기준일</div>
          <input
            type="date"
            value={asOf}
            onChange={e => setAsOf(e.target.value)}
            placeholder="오늘"
            className="border rounded px-2 py-[7px] text-sm bg-white w-full"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-600">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={e => setOpenOnly(e.target.checked)}
              className="rounded"
            />
            미결만 보기
          </label>
          <Button size="sm" onClick={apply} disabled={isPending || !accountId}>
            {isPending ? '…' : '조회'}
          </Button>
        </div>
      </div>
    </div>
  )
}
