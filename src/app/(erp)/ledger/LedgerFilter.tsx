'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import DateRangePicker from '@/components/ui/DateRangePicker'

interface Props {
  accounts: { id: string; name: string }[]
  projects: { id: string; code: string; entity_id: string | null }[]
  entities: { id: string; name: string }[]
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

function ProjectCheckSelect({
  projects,
  entities,
  entityId,
  selected,
  onToggle,
}: {
  projects: { id: string; code: string; entity_id: string | null }[]
  entities: { id: string; name: string }[]
  entityId: string
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const visible = projects.filter(p => {
    if (entityId && p.entity_id !== entityId) return false
    if (query.trim() && !p.code.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  const entityName = (id: string | null) => entities.find(e => e.id === id)?.name ?? '미분류'
  const groups = new Map<string, { id: string; code: string; entity_id: string | null }[]>()
  for (const p of visible) {
    const key = p.entity_id ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }

  const label = selected.size === 0 ? '' : selected.size === 1
    ? projects.find(p => selected.has(p.id))?.code ?? ''
    : `프로젝트 ${selected.size}개`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between border rounded px-3 py-1.5 text-sm bg-white text-left"
      >
        <span className={label ? '' : 'text-gray-400'}>{label || '전체'}</span>
        <span className="text-gray-300 text-xs ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border rounded-lg shadow-lg" onMouseLeave={() => setOpen(false)}>
          <div className="p-2 border-b">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="프로젝트 검색..."
              className="w-full border rounded px-2 py-1 text-xs outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5 space-y-2">
            {[...groups.entries()].map(([entKey, list]) => (
              <div key={entKey || 'none'}>
                <div className="text-[11px] font-semibold text-gray-400 px-1.5 pt-1 pb-0.5">{entityName(entKey || null)}</div>
                {list.map(p => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm cursor-pointer hover:bg-gray-50 px-1.5 py-1 rounded">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={e => onToggle(p.id, e.target.checked)}
                      className="accent-blue-600"
                    />
                    <span>{p.code}</span>
                  </label>
                ))}
              </div>
            ))}
            {visible.length === 0 && <div className="text-xs text-gray-400 px-1.5 py-2">결과 없음</div>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LedgerFilter({ accounts, projects, entities, counterparties }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [accountId,  setAccountId]  = useState(sp.get('account_id') ?? '')
  const [entityId,   setEntityId]   = useState(sp.get('entity_id') ?? '')
  const [projectIds, setProjectIds] = useState<Set<string>>(
    () => new Set(sp.get('project_ids')?.split(',').filter(Boolean) ?? [])
  )
  const [cpId,       setCpId]       = useState(sp.get('cp_id') ?? '')
  const [from,       setFrom]       = useState(sp.get('from') ?? '')
  const [to,         setTo]         = useState(sp.get('to') ?? '')
  const [carry,      setCarry]      = useState(sp.get('carry') === '1')

  // "전체" 기간(from 없음)에선 이월잔액 개념 자체가 성립하지 않으므로 토글을 끈다.
  useEffect(() => { if (!from) setCarry(false) }, [from])

  function handleEntityChange(id: string) {
    setEntityId(id)
    // 사업자를 바꾸면 그 사업자 소속이 아닌 프로젝트 체크는 정리한다.
    if (id) {
      setProjectIds(prev => new Set([...prev].filter(pid => projects.find(p => p.id === pid)?.entity_id === id)))
    }
  }

  function toggleProject(id: string, checked: boolean) {
    setProjectIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function buildParams(f: string, t: string, c: boolean) {
    const params = new URLSearchParams()
    params.set('account_id', accountId)
    if (entityId) params.set('entity_id', entityId)
    if (projectIds.size) params.set('project_ids', [...projectIds].join(','))
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
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
          <div className="text-xs font-semibold text-gray-600 mb-1">사업자</div>
          <SearchSelect
            options={entities.map(e => ({ id: e.id, label: e.name }))}
            value={entityId}
            onChange={handleEntityChange}
            placeholder="전체"
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">프로젝트</div>
          <ProjectCheckSelect
            projects={projects}
            entities={entities}
            entityId={entityId}
            selected={projectIds}
            onToggle={toggleProject}
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
