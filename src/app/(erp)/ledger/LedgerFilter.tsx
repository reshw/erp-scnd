'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Props {
  accounts: { id: string; name: string }[]
  projects: { id: string; code: string }[]
  counterparties: { id: string; name: string }[]
}

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

export default function LedgerFilter({ accounts, projects, counterparties }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [accountId,  setAccountId]  = useState(sp.get('account_id') ?? '')
  const [projectId,  setProjectId]  = useState(sp.get('project_id') ?? '')
  const [cpId,       setCpId]       = useState(sp.get('cp_id') ?? '')
  const [from,       setFrom]       = useState(sp.get('from') ?? '')
  const [to,         setTo]         = useState(sp.get('to') ?? '')

  function apply() {
    if (!accountId) return
    const params = new URLSearchParams()
    params.set('account_id', accountId)
    if (projectId) params.set('project_id', projectId)
    if (cpId)      params.set('cp_id', cpId)
    if (from)      params.set('from', from)
    if (to)        params.set('to', to)
    startTransition(() => router.push(`/ledger?${params.toString()}`))
  }

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-1">
          <div className="text-xs font-semibold text-gray-600 mb-1">계정과목 *</div>
          <SearchSelect
            options={accounts.map(a => ({ id: a.id, label: a.name }))}
            value={accountId}
            onChange={setAccountId}
            placeholder="계정과목 선택..."
            required
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">프로젝트</div>
          <SearchSelect
            options={projects.map(p => ({ id: p.id, label: p.code }))}
            value={projectId}
            onChange={setProjectId}
            placeholder="전체"
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">거래처</div>
          <SearchSelect
            options={counterparties.map(c => ({ id: c.id, label: c.name }))}
            value={cpId}
            onChange={setCpId}
            placeholder="전체"
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">기간</div>
          <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm bg-white w-full" />
            <span className="text-gray-400 text-xs shrink-0">~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm bg-white w-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={apply} disabled={isPending || !accountId}>
            {isPending ? '조회 중...' : '조회'}
          </Button>
        </div>
      </div>
    </div>
  )
}
