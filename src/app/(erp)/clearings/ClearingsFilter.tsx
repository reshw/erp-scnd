'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import DateRangePicker from '@/components/ui/DateRangePicker'

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

export default function ClearingsFilter({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [accountId, setAccountId] = useState(sp.get('account_id') ?? '')
  const [from,      setFrom]      = useState(sp.get('from') ?? '')
  const [to,        setTo]        = useState(sp.get('to') ?? '')
  const [openOnly,  setOpenOnly]  = useState(sp.get('open_only') === '1')

  function buildParams(f: string, t: string) {
    const params = new URLSearchParams()
    params.set('account_id', accountId)
    if (f) params.set('from', f)
    if (t) params.set('to', t)
    if (openOnly) params.set('open_only', '1')
    return params
  }

  function apply() {
    if (!accountId) return
    startTransition(() => router.push(`/clearings?${buildParams(from, to).toString()}`))
  }

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
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
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">기간</div>
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => { setFrom(f); setTo(t) }}
            onMonthChange={(f, t) => {
              if (!accountId) return
              setFrom(f); setTo(t)
              startTransition(() => router.push(`/clearings?${buildParams(f, t).toString()}`))
            }}
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
