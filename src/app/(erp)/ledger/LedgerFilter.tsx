'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import DateRangePicker from '@/components/ui/DateRangePicker'

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
  const [carry,      setCarry]      = useState(sp.get('carry') === '1')

  // "전체" 기간(from 없음)에선 이월잔액 개념 자체가 성립하지 않으므로 토글을 끈다.
  useEffect(() => { if (!from) setCarry(false) }, [from])

  function buildParams(f: string, t: string, c: boolean) {
    const params = new URLSearchParams()
    params.set('account_id', accountId)
    if (projectId) params.set('project_id', projectId)
    if (cpId)      params.set('cp_id', cpId)
    if (f) params.set('from', f)
    if (t) params.set('to', t)
    if (c && f) params.set('carry', '1')
    return params
  }

  function apply() {
    if (!accountId) return
    startTransition(() => router.push(`/ledger?${buildParams(from, to, carry).toString()}`))
  }

  function toggleCarry() {
    if (!from || !accountId) return
    const next = !carry
    setCarry(next)
    startTransition(() => router.push(`/ledger?${buildParams(from, to, next).toString()}`))
  }

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
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
          <div className="flex items-center gap-2">
            <DateRangePicker
              from={from}
              to={to}
              onChange={(f, t) => { setFrom(f); setTo(t) }}
              onMonthChange={(f, t) => {
                if (!accountId) return
                setFrom(f); setTo(t)
                startTransition(() => router.push(`/ledger?${buildParams(f, t, carry).toString()}`))
              }}
            />
            <Button size="sm" onClick={apply} disabled={isPending || !accountId}>
              {isPending ? '…' : '조회'}
            </Button>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">&nbsp;</div>
          <button
            type="button"
            onClick={toggleCarry}
            disabled={!from || !accountId || isPending}
            title={!from ? '전체 기간 조회에는 이월잔액을 적용할 수 없습니다 (월/기간 선택 시 사용 가능)' : '선택한 기간 이전 누계를 이월잔액 한 줄로 표시합니다'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              carry && from ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <span className={`inline-block w-3.5 h-3.5 rounded-sm border ${carry && from ? 'bg-blue-600 border-blue-600' : 'border-gray-400'}`}>
              {carry && from && <span className="block text-white text-[10px] leading-[13px] text-center">✓</span>}
            </span>
            이월잔액 적용
          </button>
        </div>
      </div>
    </div>
  )
}
