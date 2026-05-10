'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Account {
  id: string; name: string; activity_type: string; normal_side: string
  increase_label: string; decrease_label: string
}
interface Project    { id: string; code: string }
interface Counterparty { id: string; name: string }

interface Line {
  account_id: string
  account_name: string
  classification: string
  debit: string       // 콤마 포함 표시용 문자열
  credit: string
  counterparty_id: string
  counterparty_name: string
  note: string
}

const emptyLine = (): Line => ({
  account_id: '', account_name: '', classification: '',
  debit: '', credit: '', counterparty_id: '', counterparty_name: '', note: '',
})

/** 숫자 → 콤마 문자열 */
function addCommas(val: string): string {
  const digits = val.replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('ko-KR')
}

/** 콤마 문자열 → 숫자 */
function parseAmt(val: string): number {
  return parseFloat(val.replace(/,/g, '')) || 0
}

function fmtN(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

// ── 계정과목 검색 콤보박스 ──────────────────────────────
function AccountCombobox({
  accounts, value, name, onChange,
}: {
  accounts: Account[]
  value: string
  name: string
  onChange: (id: string, name: string) => void
}) {
  const [query, setQuery]     = useState(name)
  const [open, setOpen]       = useState(false)
  const [rect, setRect]       = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLUListElement>(null)

  useEffect(() => { setQuery(name) }, [name])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        listRef.current  && !listRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleFocus() {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    setOpen(true)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    setOpen(true)
  }

  const filtered = query ? accounts.filter(a => a.name.includes(query)) : accounts

  function select(a: Account) {
    setQuery(a.name)
    setOpen(false)
    onChange(a.id, a.name)
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder="계정 검색"
        className="border rounded px-2 py-1 text-sm w-full"
        autoComplete="off"
      />
      {open && filtered.length > 0 && rect && (
        <ul
          ref={listRef}
          style={{
            position: 'fixed',
            top:  rect.bottom + 2,
            left: rect.left,
            width: Math.max(rect.width, 180),
            zIndex: 9999,
          }}
          className="bg-white border rounded shadow-lg max-h-52 overflow-y-auto text-sm"
        >
          {filtered.map(a => (
            <li
              key={a.id}
              onMouseDown={() => select(a)}
              className={`px-3 py-1.5 cursor-pointer hover:bg-blue-50 ${a.id === value ? 'bg-blue-100 font-medium' : ''}`}
            >
              {a.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 메인 폼 ────────────────────────────────────────────
export default function JournalForm({
  nextNo, accounts, projects, counterparties, defaultValues, copyValues,
}: {
  nextNo: number
  accounts: Account[]
  projects: Project[]
  counterparties: Counterparty[]
  defaultValues?: { journalId: string; journal_no: number; date: string; project_id: string; description: string; lines: Line[] }
  copyValues?: { date: string; project_id: string; description: string; lines: Line[] }
}) {
  const router = useRouter()
  const isEdit = !!defaultValues?.journalId

  const [journalNo]             = useState(defaultValues?.journal_no ?? nextNo)
  const [date, setDate]         = useState(defaultValues?.date ?? copyValues?.date ?? new Date().toISOString().slice(0, 10))
  const [projectId, setProject] = useState(defaultValues?.project_id ?? copyValues?.project_id ?? '')
  const [description, setDesc]  = useState(defaultValues?.description ?? copyValues?.description ?? '')
  const [lines, setLines]       = useState<Line[]>(() => {
    const src = defaultValues?.lines ?? copyValues?.lines
    if (!src) return [emptyLine(), emptyLine()]
    // debit/credit을 콤마 형식으로 변환
    return src.map(l => ({
      ...l,
      debit:  l.debit  ? addCommas(l.debit)  : '',
      credit: l.credit ? addCommas(l.credit) : '',
    }))
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]))

  function setAccount(i: number, id: string, name: string) {
    setLines(prev => {
      const next = [...prev]
      const acc = accountMap[id]
      next[i] = {
        ...next[i],
        account_id:     id,
        account_name:   name,
        classification: acc ? acc.increase_label : '',
      }
      // 기존 금액 있으면 분류 재계산
      if (acc) {
        const debitAmt  = parseAmt(next[i].debit)
        const creditAmt = parseAmt(next[i].credit)
        const normalDebit = acc.normal_side === 'debit'
        if (debitAmt > 0)  next[i].classification = normalDebit ? acc.increase_label : acc.decrease_label
        if (creditAmt > 0) next[i].classification = normalDebit ? acc.decrease_label : acc.increase_label
      }
      return next
    })
  }

  function updateAmt(i: number, field: 'debit' | 'credit', raw: string) {
    const formatted = addCommas(raw)
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: formatted }
      const acc = accountMap[next[i].account_id]
      if (acc) {
        const amt = parseAmt(formatted)
        const normalDebit = acc.normal_side === 'debit'
        if (field === 'debit'  && amt > 0) next[i].classification = normalDebit ? acc.increase_label : acc.decrease_label
        if (field === 'credit' && amt > 0) next[i].classification = normalDebit ? acc.decrease_label : acc.increase_label
      }
      return next
    })
  }

  function updateField(i: number, field: keyof Line, val: string) {
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      return next
    })
  }

  function addLine()          { setLines(prev => [...prev, emptyLine()]) }
  function removeLine(i: number) { setLines(prev => prev.filter((_, idx) => idx !== i)) }

  const totalDebit  = lines.reduce((s, l) => s + parseAmt(l.debit),  0)
  const totalCredit = lines.reduce((s, l) => s + parseAmt(l.credit), 0)
  const balanced    = Math.abs(totalDebit - totalCredit) < 1

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!balanced) { setError('차변 합계 ≠ 대변 합계'); return }
    setSaving(true); setError('')

    const body = {
      journalId:   defaultValues?.journalId,
      journal_no:  journalNo,
      date,
      project_id:  projectId || null,
      description: description || null,
      lines: lines
        .filter(l => l.account_id && (parseAmt(l.debit) > 0 || parseAmt(l.credit) > 0))
        .map(l => ({
          account_id:        l.account_id,
          classification:    l.classification,
          activity_type:     accountMap[l.account_id]?.activity_type ?? l.classification.split(' - ')[0],
          activity_subtype:  l.classification.split(' - ')[1] ?? '',
          debit:             Math.round(parseAmt(l.debit)),
          credit:            Math.round(parseAmt(l.credit)),
          counterparty_id:   l.counterparty_id || null,
          counterparty_name: l.counterparty_name || null,
          note:              l.note || null,
          date,
        })),
    }

    const res = await fetch('/api/journals', {
      method:  isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json()
      setError(err.message ?? '저장 실패')
      setSaving(false)
      return
    }

    router.push('/journals')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 헤더 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-lg">
        <div>
          <label className="text-xs text-gray-500">전표번호</label>
          <div className="font-bold text-lg">{journalNo}</div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block">날짜</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-full" required />
        </div>
        <div>
          <label className="text-xs text-gray-500 block">프로젝트</label>
          <select value={projectId} onChange={e => setProject(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-full">
            <option value="">-</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block">적요</label>
          <input value={description} onChange={e => setDesc(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-full" placeholder="전표 적요" />
        </div>
      </div>

      {/* 명세 행 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-xs text-gray-600">
              <th className="text-left px-2 py-2 w-40">계정과목</th>
              <th className="text-left px-2 py-2 w-36">분류</th>
              <th className="text-right px-2 py-2 w-32">차변</th>
              <th className="text-right px-2 py-2 w-32">대변</th>
              <th className="text-left px-2 py-2 w-36">거래처</th>
              <th className="text-left px-2 py-2">적요</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="border-b">
                <td className="px-1 py-1">
                  <AccountCombobox
                    accounts={accounts}
                    value={line.account_id}
                    name={line.account_name}
                    onChange={(id, name) => setAccount(i, id, name)}
                  />
                </td>
                <td className="px-1 py-1">
                  <input value={line.classification} readOnly
                    className="border rounded px-2 py-1 text-sm w-full bg-gray-50 text-gray-500 text-xs" />
                </td>
                <td className="px-1 py-1">
                  <input
                    value={line.debit}
                    onChange={e => updateAmt(i, 'debit', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full text-right tabular-nums"
                    placeholder="0"
                    inputMode="numeric"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    value={line.credit}
                    onChange={e => updateAmt(i, 'credit', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full text-right tabular-nums"
                    placeholder="0"
                    inputMode="numeric"
                  />
                </td>
                <td className="px-1 py-1">
                  <input value={line.counterparty_name}
                    onChange={e => {
                      const name = e.target.value
                      const found = counterparties.find(c => c.name === name)
                      setLines(prev => {
                        const next = [...prev]
                        next[i] = { ...next[i], counterparty_name: name, counterparty_id: found?.id ?? '' }
                        return next
                      })
                    }}
                    list="cp-list"
                    className="border rounded px-2 py-1 text-sm w-full" placeholder="거래처" />
                </td>
                <td className="px-1 py-1">
                  <input value={line.note}
                    onChange={e => updateField(i, 'note', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full" placeholder="적요" />
                </td>
                <td className="px-1 py-1 text-center">
                  {lines.length > 2 && (
                    <button type="button" onClick={() => removeLine(i)}
                      className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-bold text-sm">
              <td colSpan={2} className="px-2 py-2 text-right text-gray-500">합계</td>
              <td className={`px-2 py-2 text-right tabular-nums ${!balanced && totalDebit > 0 ? 'text-red-600' : ''}`}>
                {fmtN(totalDebit)}
              </td>
              <td className={`px-2 py-2 text-right tabular-nums ${!balanced && totalCredit > 0 ? 'text-red-600' : ''}`}>
                {fmtN(totalCredit)}
              </td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="cp-list">
        {counterparties.map(c => <option key={c.id} value={c.name} />)}
      </datalist>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addLine}>+ 행 추가</Button>
        <div className="flex-1" />
        {error && <span className="text-red-500 text-sm">{error}</span>}
        {!balanced && totalDebit > 0 && (
          <span className="text-red-500 text-sm">차액: {fmtN(Math.abs(totalDebit - totalCredit))}</span>
        )}
        <Button type="button" variant="outline" onClick={() => router.back()}>취소</Button>
        <Button type="submit" disabled={saving || !balanced}>
          {saving ? '저장 중...' : isEdit ? '수정' : '저장'}
        </Button>
      </div>
    </form>
  )
}
