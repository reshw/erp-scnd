'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Combobox from '@/components/ui/Combobox'

interface Option { id: string; name?: string; code?: string }

interface EditPlan {
  id: string
  name: string
  type: 'one_time' | 'recurring'
  amount: number
  recurrence_day: number | null
  planned_date: string | null
  account_id: string | null
  account_name: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  project_id: string | null
  project_code: string | null
  note: string | null
  bank_account_id: string | null
  bank_account_name: string | null
}

export default function PlanForm({
  accounts,
  counterparties,
  projects,
  bankAccounts,
  onClose,
  editPlan,
}: {
  accounts: Option[]
  counterparties: Option[]
  projects: Option[]
  bankAccounts: Option[]
  onClose: () => void
  editPlan?: EditPlan
}) {
  const router = useRouter()
  const isEdit = !!editPlan
  const [type, setType] = useState<'one_time' | 'recurring'>(editPlan?.type ?? 'recurring')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    const fd = new FormData(e.currentTarget)
    const body: any = {
      name:            fd.get('name'),
      type,
      amount:          Number(fd.get('amount')),
      recurrence_day:  type === 'recurring' ? Number(fd.get('recurrence_day')) : null,
      planned_date:    type === 'one_time'  ? fd.get('planned_date')           : null,
      account_id:       fd.get('account_id')       || null,
      counterparty_id:  fd.get('counterparty_id')  || null,
      project_id:       fd.get('project_id')       || null,
      note:             fd.get('note')             || null,
      bank_account_id:  fd.get('bank_account_id')  || null,
    }
    if (isEdit) body.id = editPlan.id

    const res = await fetch('/api/spending/plans', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      router.refresh()
      onClose()
    } else {
      const j = await res.json()
      setErr(j.error ?? '오류 발생')
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 유형 토글 (수정 시 변경 불가) */}
      <div className="flex gap-2">
        {(['recurring', 'one_time'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => !isEdit && setType(t)}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              type === t
                ? 'bg-blue-600 text-white border-blue-600'
                : isEdit ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t === 'recurring' ? '반복' : '일회성'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">지출 명칭 *</label>
          <input name="name" required placeholder="예: 서버 구독료, 바닥공사 잔금"
            defaultValue={editPlan?.name ?? ''}
            className="w-full border rounded px-3 py-1.5 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">금액 *</label>
          <input name="amount" type="number" required min="1"
            defaultValue={editPlan?.amount ?? ''}
            className="w-full border rounded px-3 py-1.5 text-sm" />
        </div>

        {type === 'recurring' ? (
          <div>
            <label className="block text-xs text-gray-500 mb-1">매월 납부일 *</label>
            <input name="recurrence_day" type="number" required min="1" max="31" placeholder="25"
              defaultValue={editPlan?.recurrence_day ?? ''}
              className="w-full border rounded px-3 py-1.5 text-sm" />
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">지급 예정일 *</label>
            <input name="planned_date" type="date" required
              defaultValue={editPlan?.planned_date ?? ''}
              className="w-full border rounded px-3 py-1.5 text-sm" />
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">계정과목</label>
          <Combobox
            name="account_id"
            placeholder="계정과목 검색"
            options={accounts.map(a => ({ id: a.id, label: a.name! }))}
            defaultId={editPlan?.account_id ?? ''}
            defaultLabel={editPlan?.account_name ?? ''}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">프로젝트</label>
          <Combobox
            name="project_id"
            placeholder="프로젝트 검색"
            options={projects.map(p => ({ id: p.id, label: p.code! }))}
            defaultId={editPlan?.project_id ?? ''}
            defaultLabel={editPlan?.project_code ?? ''}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">거래처</label>
          <Combobox
            name="counterparty_id"
            placeholder="거래처 검색"
            options={counterparties.map(c => ({ id: c.id, label: c.name! }))}
            defaultId={editPlan?.counterparty_id ?? ''}
            defaultLabel={editPlan?.counterparty_name ?? ''}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">출금 통장</label>
          <Combobox
            name="bank_account_id"
            placeholder="통장 선택"
            options={bankAccounts.map(b => ({ id: b.id, label: b.name! }))}
            defaultId={editPlan?.bank_account_id ?? ''}
            defaultLabel={editPlan?.bank_account_name ?? ''}
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">메모</label>
          <input name="note" placeholder="선택사항"
            defaultValue={editPlan?.note ?? ''}
            className="w-full border rounded px-3 py-1.5 text-sm" />
        </div>
      </div>

      {err && <p className="text-red-500 text-xs">{err}</p>}

      {type === 'recurring' && !isEdit && (
        <p className="text-xs text-gray-400">등록 시 이번달 포함 12개월치 지출예정이 자동 생성됩니다.</p>
      )}
      {type === 'recurring' && isEdit && (
        <p className="text-xs text-gray-400">저장 시 미집행 예정이 새 금액/납부일로 재생성됩니다.</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>취소</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? (isEdit ? '저장 중...' : '등록 중...') : (isEdit ? '저장' : '등록')}
        </Button>
      </div>
    </form>
  )
}
