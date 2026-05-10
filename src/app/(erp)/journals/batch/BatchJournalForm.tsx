'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Account { id: string; name: string }
interface Project { id: string; code: string }
interface Counterparty { id: string; name: string }

interface Row {
  id: number
  project_id: string
  debit_account_id: string
  debit_amount: string
  debit_counterparty_id: string
  credit_account_id: string
  credit_amount: string
  credit_counterparty_id: string
  note: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(n)
}

// ── 인라인 검색형 셀렉트 ──────────────────────────────────────────────
function SearchSelect({
  options,
  value,
  onChange,
  placeholder = '검색...',
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find(o => o.id === value)?.label ?? ''

  const filtered = query.trim() === ''
    ? options.slice(0, 30)
    : options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())).slice(0, 30)

  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  function select(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center border rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400 bg-white">
        <input
          type="text"
          value={open ? query : selectedLabel}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setQuery(''); setOpen(true) }}
          placeholder={placeholder}
          className="flex-1 px-2 py-1.5 text-xs outline-none min-w-0"
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); setQuery('') }}
            className="px-1.5 text-gray-300 hover:text-gray-500 text-xs shrink-0">✕</button>
        )}
      </div>
      {open && (
        <ul className="absolute z-50 mt-1 w-48 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto text-xs">
          <li onMouseDown={() => select('')}
            className="px-3 py-2 cursor-pointer hover:bg-gray-50 text-gray-400">없음</li>
          {filtered.map(o => (
            <li key={o.id} onMouseDown={() => select(o.id)}
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

let rowId = 0
function newRow(): Row {
  return {
    id: ++rowId,
    project_id: '',
    debit_account_id: '',
    debit_amount: '',
    debit_counterparty_id: '',
    credit_account_id: '',
    credit_amount: '',
    credit_counterparty_id: '',
    note: '',
  }
}

export default function BatchJournalForm({
  accounts,
  projects,
  counterparties,
  nextNo,
}: {
  accounts: Account[]
  projects: Project[]
  counterparties: Counterparty[]
  nextNo: number
}) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)

  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [commonNote, setCommonNote] = useState('')
  const [rows, setRows] = useState<Row[]>([newRow(), newRow(), newRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<{ journalNo: number; project: string }[]>([])

  function updateRow(id: number, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function applyCommonNote(value: string) {
    setCommonNote(value)
    setRows(prev => prev.map(r => ({ ...r, note: value })))
  }

  function addRow() {
    setRows(prev => [...prev, { ...newRow(), note: commonNote }])
  }

  function removeRow(id: number) {
    if (rows.length <= 1) return
    setRows(prev => prev.filter(r => r.id !== id))
  }

  const accountOptions  = accounts.map(a => ({ id: a.id, label: a.name }))
  const projectOptions  = projects.map(p => ({ id: p.id, label: p.code }))
  const cpOptions       = counterparties.map(c => ({ id: c.id, label: c.name }))

  const validRows = rows.filter(r =>
    r.project_id && r.debit_account_id && r.credit_account_id &&
    Number(r.debit_amount) > 0 && Number(r.credit_amount) > 0
  )

  const totalDebit  = validRows.reduce((s, r) => s + Number(r.debit_amount), 0)
  const totalCredit = validRows.reduce((s, r) => s + Number(r.credit_amount), 0)

  async function handleSubmit() {
    if (validRows.length === 0) { setError('유효한 행이 없습니다'); return }
    if (!date) { setError('날짜를 입력하세요'); return }
    setSaving(true); setError(''); setResults([])

    const res = await fetch('/api/journals/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, description, rows: validRows }),
    })

    const data = await res.json()
    if (!res.ok) { setError(data.error ?? '발행 실패'); setSaving(false); return }
    setResults(data.results)
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {/* 공통 헤더 */}
      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex gap-4 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">날짜 *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">전표 설명 (공통)</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="예: 마통 이자발생 2026-04"
              className="border rounded px-3 py-2 text-sm w-full" />
          </div>
        </div>
        <div className="border-t pt-3">
          <label className="text-xs text-gray-500 block mb-1">공통 적요 <span className="text-gray-400">(입력 시 전체 행 적용)</span></label>
          <input type="text" value={commonNote} onChange={e => applyCommonNote(e.target.value)}
            placeholder="예: 마통 이자 2026-04"
            className="border rounded px-3 py-2 text-sm w-full" />
        </div>
      </div>

      {/* 행 테이블 */}
      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: '900px' }}>
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="text-left px-3 py-3 w-28">프로젝트</th>
              <th className="text-left px-3 py-3 w-28">차변 계정</th>
              <th className="text-right px-3 py-3 w-24">차변 금액</th>
              <th className="text-left px-3 py-3 w-28">차변 거래처</th>
              <th className="text-left px-3 py-3 w-28">대변 계정</th>
              <th className="text-right px-3 py-3 w-24">대변 금액</th>
              <th className="text-left px-3 py-3 w-28">대변 거래처</th>
              <th className="text-left px-3 py-3">적요</th>
              <th className="w-6 px-2 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(row => {
              const debitAmt  = Number(row.debit_amount)
              const creditAmt = Number(row.credit_amount)
              const isValid = row.project_id && row.debit_account_id && row.credit_account_id
                && debitAmt > 0 && creditAmt > 0

              return (
                <tr key={row.id} className={isValid ? 'bg-green-50/40' : ''}>
                  {/* 프로젝트 */}
                  <td className="px-2 py-2">
                    <SearchSelect options={projectOptions} value={row.project_id}
                      onChange={v => updateRow(row.id, { project_id: v })} placeholder="프로젝트" />
                  </td>
                  {/* 차변 계정 */}
                  <td className="px-2 py-2">
                    <SearchSelect options={accountOptions} value={row.debit_account_id}
                      onChange={v => updateRow(row.id, { debit_account_id: v })} placeholder="차변 계정" />
                  </td>
                  {/* 차변 금액 */}
                  <td className="px-2 py-2">
                    <input type="number" value={row.debit_amount}
                      onChange={e => {
                        const v = e.target.value
                        const patch: Partial<Row> = { debit_amount: v }
                        if (!row.credit_amount || row.credit_amount === row.debit_amount) patch.credit_amount = v
                        updateRow(row.id, patch)
                      }}
                      placeholder="0"
                      className="border rounded px-2 py-1.5 text-xs w-full text-right tabular-nums" />
                  </td>
                  {/* 차변 거래처 */}
                  <td className="px-2 py-2">
                    <SearchSelect options={cpOptions} value={row.debit_counterparty_id}
                      onChange={v => updateRow(row.id, { debit_counterparty_id: v })} placeholder="거래처" />
                  </td>
                  {/* 대변 계정 */}
                  <td className="px-2 py-2">
                    <SearchSelect options={accountOptions} value={row.credit_account_id}
                      onChange={v => updateRow(row.id, { credit_account_id: v })} placeholder="대변 계정" />
                  </td>
                  {/* 대변 금액 */}
                  <td className="px-2 py-2">
                    <input type="number" value={row.credit_amount}
                      onChange={e => updateRow(row.id, { credit_amount: e.target.value })}
                      placeholder="0"
                      className="border rounded px-2 py-1.5 text-xs w-full text-right tabular-nums" />
                  </td>
                  {/* 대변 거래처 */}
                  <td className="px-2 py-2">
                    <SearchSelect options={cpOptions} value={row.credit_counterparty_id}
                      onChange={v => updateRow(row.id, { credit_counterparty_id: v })} placeholder="거래처" />
                  </td>
                  {/* 적요 */}
                  <td className="px-2 py-2">
                    <input type="text" value={row.note}
                      onChange={e => updateRow(row.id, { note: e.target.value })}
                      placeholder="적요"
                      className="border rounded px-2 py-1.5 text-xs w-full" />
                  </td>
                  {/* 삭제 */}
                  <td className="px-2 py-2">
                    <button onClick={() => removeRow(row.id)}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 text-xs font-semibold">
            <tr>
              <td colSpan={2} className="px-3 py-2 text-gray-500">
                {validRows.length}행 유효 · 전표 {validRows.length}개 발행 예정
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(totalDebit)}</td>
              <td colSpan={2}></td>
              <td className={`px-3 py-2 text-right tabular-nums ${totalDebit !== totalCredit ? 'text-red-500' : 'text-green-700'}`}>
                {fmt(totalCredit)}
              </td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>

        <div className="px-4 py-3 border-t">
          <Button size="sm" variant="outline" onClick={addRow}>+ 행 추가</Button>
        </div>
      </div>

      {/* 발행 버튼 */}
      <div className="flex items-center gap-4 justify-end">
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {totalDebit > 0 && totalDebit !== totalCredit && (
          <p className="text-amber-600 text-sm">차변·대변 합계 불일치 (행별 독립 처리)</p>
        )}
        <Button disabled={saving || validRows.length === 0} onClick={handleSubmit}>
          {saving ? '발행 중...' : `전표 ${validRows.length}개 발행`}
        </Button>
      </div>

      {/* 결과 */}
      {results.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-1">
          <p className="text-sm font-semibold text-green-800">발행 완료 — 전표 {results.length}개</p>
          {results.map(r => (
            <p key={r.journalNo} className="text-xs text-green-700">#{r.journalNo} {r.project}</p>
          ))}
        </div>
      )}
    </div>
  )
}
