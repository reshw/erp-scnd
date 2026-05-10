'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import PlanForm from './PlanForm'

interface Plan {
  id: string
  name: string
  type: 'one_time' | 'recurring'
  amount: number
  recurrence_day: number | null
  planned_date: string | null
  status: string
  note: string | null
  account_id: string | null
  counterparty_id: string | null
  project_id: string | null
  bank_account_id: string | null
  accounts: { name: string } | null
  counterparties: { name: string } | null
  projects: { code: string } | null
  bank_accounts: { name: string } | null
}
interface Option { id: string; name?: string; code?: string }

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

export default function PlansClient({
  plans,
  accounts,
  counterparties,
  projects,
  bankAccounts,
}: {
  plans: Plan[]
  accounts: Option[]
  counterparties: Option[]
  projects: Option[]
  bankAccounts: Option[]
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(id: string) {
    if (!confirm('이 지출계획과 미집행 예정을 삭제하시겠습니까?')) return
    setDeleting(id)
    await fetch('/api/spending/plans', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleting(null)
    router.refresh()
  }

  const recurring = plans.filter(p => p.type === 'recurring')
  const oneTime   = plans.filter(p => p.type === 'one_time')

  function PlanList({ items }: { items: Plan[] }) {
    if (items.length === 0) return <p className="text-sm text-gray-400 py-4 text-center">없음</p>
    return (
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {items.map(p => (
            <tr key={p.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {p.accounts?.name ?? '계정 미지정'}
                  {p.projects && ` · ${p.projects.code}`}
                  {p.counterparties && ` · ${p.counterparties.name}`}
                  {p.note && ` · ${p.note}`}
                </div>
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                {p.type === 'recurring'
                  ? `매월 ${p.recurrence_day}일`
                  : p.planned_date}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                {fmt(p.amount)}원
              </td>
              <td className="px-4 py-3 w-24 text-right">
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setEditingPlan(p); setShowForm(false) }}
                    className="text-xs text-gray-400 hover:text-blue-500"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deleting === p.id}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    삭제
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">지출계획 관리</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? '닫기' : '+ 지출계획 추가'}
        </Button>
      </div>

      {showForm && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h3 className="text-sm font-semibold mb-3">새 지출계획 등록</h3>
          <PlanForm
            accounts={accounts}
            counterparties={counterparties}
            projects={projects}
            bankAccounts={bankAccounts}
            onClose={() => setShowForm(false)}
          />
        </div>
      )}

      {editingPlan && (
        <div className="border rounded-lg p-4 bg-blue-50">
          <h3 className="text-sm font-semibold mb-3">지출계획 수정 — {editingPlan.name}</h3>
          <PlanForm
            accounts={accounts}
            counterparties={counterparties}
            projects={projects}
            bankAccounts={bankAccounts}
            onClose={() => setEditingPlan(null)}
            editPlan={{
              id:                editingPlan.id,
              name:              editingPlan.name,
              type:              editingPlan.type,
              amount:            editingPlan.amount,
              recurrence_day:    editingPlan.recurrence_day,
              planned_date:      editingPlan.planned_date,
              account_id:        editingPlan.account_id,
              account_name:      editingPlan.accounts?.name ?? null,
              counterparty_id:   editingPlan.counterparty_id,
              counterparty_name: editingPlan.counterparties?.name ?? null,
              project_id:        editingPlan.project_id,
              project_code:      editingPlan.projects?.code ?? null,
              note:              editingPlan.note,
              bank_account_id:   editingPlan.bank_account_id,
              bank_account_name: editingPlan.bank_accounts?.name ?? null,
            }}
          />
        </div>
      )}

      {/* 반복 지출 */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-2.5 border-b">
          <span className="text-sm font-medium">반복 지출 <span className="text-gray-400 font-normal">({recurring.length}건)</span></span>
        </div>
        <PlanList items={recurring} />
      </div>

      {/* 일회성 지출 */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-2.5 border-b">
          <span className="text-sm font-medium">일회성 지출 <span className="text-gray-400 font-normal">({oneTime.length}건)</span></span>
        </div>
        <PlanList items={oneTime} />
      </div>
    </div>
  )
}
