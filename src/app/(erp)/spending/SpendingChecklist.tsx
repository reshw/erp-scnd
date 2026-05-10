'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

interface Execution {
  id: string
  source_type: 'loan' | 'plan'
  source_id: string
  planned_date: string
  amount: number
  interest: number | null
  repayment: number | null
  description: string | null
  status: 'pending' | 'executed' | 'postponed' | 'cancelled'
  note: string | null
  journal_id: string | null
}

export default function SpendingChecklist({ executions }: { executions: Execution[] }) {
  const router = useRouter()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, { amount: string; saving: boolean }>>({})

  const pending   = executions.filter(e => e.status === 'pending')
  const executed  = executions.filter(e => e.status === 'executed')
  const postponed = executions.filter(e => e.status === 'postponed' || e.status === 'cancelled')

  function toggleAll(list: Execution[]) {
    const ids = list.map(e => e.id)
    const allChecked = ids.every(id => checked.has(id))
    setChecked(prev => {
      const next = new Set(prev)
      allChecked ? ids.forEach(id => next.delete(id)) : ids.forEach(id => next.add(id))
      return next
    })
  }

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function startEdit(e: Execution) {
    setEdits(prev => ({ ...prev, [e.id]: { amount: String(e.amount), saving: false } }))
  }

  function cancelEdit(id: string) {
    setEdits(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  async function saveEdit(id: string) {
    const edit = edits[id]
    if (!edit) return
    const amount = Number(edit.amount)
    if (isNaN(amount) || amount <= 0) return
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], saving: true } }))
    await fetch(`/api/spending/executions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    cancelEdit(id)
    router.refresh()
  }

  async function handleUndo(e: Execution) {
    let cancel_journal = false
    if (e.journal_id) {
      cancel_journal = confirm('연결된 전표도 함께 취소하시겠습니까?\n\n확인 → 전표 취소 + 집행 취소\n취소 → 집행만 되돌림 (전표 유지)')
    }
    setUndoing(e.id)
    await fetch(`/api/spending/executions/${e.id}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel_journal }),
    })
    setUndoing(null)
    router.refresh()
  }

  async function handleExecute() {
    if (checked.size === 0) return
    setSaving(true)
    const res = await fetch('/api/spending/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...checked] }),
    })
    if (res.ok) {
      setChecked(new Set())
      router.refresh()
    }
    setSaving(false)
  }

  if (executions.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-gray-400 text-sm">
        해당 기간에 지출예정 항목이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 미집행 (pending) */}
      {pending.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input type="checkbox"
                checked={pending.every(e => checked.has(e.id))}
                onChange={() => toggleAll(pending)}
                className="accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">
                미집행 <span className="text-gray-400 font-normal">({pending.length}건)</span>
              </span>
            </div>
            {checked.size > 0 && (
              <Button size="sm" disabled={saving} onClick={handleExecute}>
                {saving ? '처리 중...' : `선택 ${checked.size}건 집행`}
              </Button>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {pending.map(e => {
                const edit = edits[e.id]
                return (
                  <tr key={e.id} className={`hover:bg-gray-50 ${checked.has(e.id) ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-4 py-3 w-8">
                      <input type="checkbox" checked={checked.has(e.id)} onChange={() => toggle(e.id)}
                        className="accent-blue-600" />
                    </td>
                    <td className="px-2 py-3 text-gray-500 text-xs w-24 whitespace-nowrap">{e.planned_date}</td>
                    <td className="px-2 py-3">
                      <div className="font-medium">{e.description ?? '-'}</div>
                      <div className="text-xs text-gray-400">
                        {e.source_type === 'loan' ? '대출' : '지출계획'}
                        {e.interest != null && ` · 이자 ${fmt(e.interest)}원`}
                        {e.repayment != null && e.repayment > 0 && ` · 원금 ${fmt(e.repayment)}원`}
                      </div>
                    </td>
                    {/* 금액 (인라인 편집) */}
                    <td className="px-4 py-3 text-right w-44">
                      {edit ? (
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="number"
                            value={edit.amount}
                            onChange={ev => setEdits(prev => ({ ...prev, [e.id]: { ...prev[e.id], amount: ev.target.value } }))}
                            className="border rounded px-2 py-0.5 text-sm w-28 text-right tabular-nums"
                            autoFocus
                            onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(e.id); if (ev.key === 'Escape') cancelEdit(e.id) }}
                          />
                          <button onClick={() => saveEdit(e.id)} disabled={edit.saving}
                            className="text-xs text-blue-600 hover:underline whitespace-nowrap">확인</button>
                          <button onClick={() => cancelEdit(e.id)}
                            className="text-xs text-gray-400 hover:underline">취소</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="tabular-nums font-medium">{fmt(e.amount)}원</span>
                          <button onClick={() => startEdit(e)} title="금액 수정"
                            className="text-gray-300 hover:text-gray-500 text-xs leading-none">✎</button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 w-16">
                      {e.source_type === 'loan' && (
                        <Link href={`/loans/${e.source_id}`}>
                          <Button size="sm" variant="outline" className="text-xs px-2">상세</Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="bg-gray-50 px-4 py-2 text-right text-sm font-medium text-gray-600 border-t">
            합계 {fmt(pending.filter(e => checked.has(e.id)).reduce((s, e) => s + e.amount, 0))}원 선택
            &nbsp;/&nbsp;
            전체 {fmt(pending.reduce((s, e) => s + e.amount, 0))}원
          </div>
        </div>
      )}

      {/* 집행완료 */}
      {executed.length > 0 && (
        <div className="border rounded-lg overflow-hidden opacity-70">
          <div className="bg-green-50 px-4 py-2.5">
            <span className="text-sm font-medium text-green-700">
              집행완료 <span className="font-normal text-green-500">({executed.length}건)</span>
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {executed.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 w-8 text-green-500">✓</td>
                  <td className="px-2 py-2.5 text-gray-500 text-xs w-24">{e.planned_date}</td>
                  <td className="px-2 py-2.5 text-gray-600">{e.description ?? '-'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmt(e.amount)}원</td>
                  <td className="px-4 py-2.5 w-32 text-right">
                    <div className="flex gap-1 justify-end">
                      {e.journal_id && (
                        <Link href={`/journals/${e.journal_id}`}>
                          <Button size="sm" variant="outline" className="text-xs px-2">전표</Button>
                        </Link>
                      )}
                      <button
                        onClick={() => handleUndo(e)}
                        disabled={undoing === e.id}
                        className="text-xs text-gray-400 hover:text-red-500 px-1"
                      >
                        {undoing === e.id ? '...' : '집행취소'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
