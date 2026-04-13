'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { Account } from './page'

const ACTIVITY_TYPES = ['현금', '영업', '재무', '투자', '개인', '세무']
const ACTIVITY_ORDER = ['현금', '영업', '재무', '투자', '개인', '세무']

const ACTIVITY_COLOR: Record<string, string> = {
  현금: 'bg-blue-100 text-blue-700',
  영업: 'bg-green-100 text-green-700',
  재무: 'bg-purple-100 text-purple-700',
  투자: 'bg-orange-100 text-orange-700',
  개인: 'bg-gray-100 text-gray-700',
  세무: 'bg-red-100 text-red-700',
}

const EMPTY_FORM = {
  name: '',
  activity_type: '영업',
  normal_side: 'debit',
  increase_type: '',
  increase_label: '',
  decrease_type: '',
  decrease_label: '',
  note: '',
}

type FormState = typeof EMPTY_FORM

function sortAccounts(list: Account[]) {
  return [...list].sort((a, b) => {
    const ai = ACTIVITY_ORDER.indexOf(a.activity_type)
    const bi = ACTIVITY_ORDER.indexOf(b.activity_type)
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })
}

export default function AccountsClient({ accounts: initial }: { accounts: Account[] }) {
  const router = useRouter()
  const [accounts, setAccounts] = useState(initial)
  const [toggling, setToggling] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setOpen(true)
  }

  function openEdit(a: Account) {
    setEditing(a)
    setForm({
      name: a.name,
      activity_type: a.activity_type,
      normal_side: a.normal_side,
      increase_type: a.increase_type,
      increase_label: a.increase_label,
      decrease_type: a.decrease_type,
      decrease_label: a.decrease_label,
      note: a.note ?? '',
    })
    setError('')
    setOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('계정과목명은 필수입니다.'); return }
    if (!form.increase_type.trim()) { setError('증가유형 코드는 필수입니다.'); return }
    if (!form.increase_label.trim()) { setError('증가유형 라벨은 필수입니다.'); return }
    if (!form.decrease_type.trim()) { setError('감소유형 코드는 필수입니다.'); return }
    if (!form.decrease_label.trim()) { setError('감소유형 라벨은 필수입니다.'); return }
    setSaving(true)
    setError('')
    try {
      const method = editing ? 'PUT' : 'POST'
      const body = editing ? { ...form, id: editing.id } : form
      const res = await fetch('/api/accounts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? '저장 실패'); return }
      if (editing) {
        setAccounts(prev => sortAccounts(prev.map(a => a.id === editing.id ? { ...a, ...form } : a)))
      } else {
        const newAccount: Account = { id: json.id, ...form, note: form.note || null, is_active: true }
        setAccounts(prev => sortAccounts([...prev, newAccount]))
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    setToggling(id)
    const res = await fetch('/api/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    })
    if (res.ok) {
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: !current } : a))
      router.refresh()
    }
    setToggling(null)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 계정과목을 삭제하시겠습니까?\n연결된 전표가 있으면 삭제되지 않습니다.`)) return
    const res = await fetch('/api/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const json = await res.json()
    if (res.ok) {
      setAccounts(prev => prev.filter(a => a.id !== id))
      router.refresh()
    } else {
      alert(json.message ?? '삭제 실패')
    }
  }

  const grouped = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.activity_type]) acc[a.activity_type] = []
    acc[a.activity_type].push(a)
    return acc
  }, {})

  const activeCount = accounts.filter(a => a.is_active).length

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{activeCount}개 활성 / 전체 {accounts.length}개</div>
        <Button size="sm" onClick={openNew}>+ 계정과목 추가</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-24">활동구분</TableHead>
              <TableHead>계정과목</TableHead>
              <TableHead className="w-20">방향</TableHead>
              <TableHead className="w-24">증가 라벨</TableHead>
              <TableHead className="w-24">감소 라벨</TableHead>
              <TableHead className="w-24 text-center">상태</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(grouped).map(([type, items]) =>
              items.map((a, i) => (
                <TableRow key={a.id} className={`${!a.is_active ? 'opacity-40' : ''} hover:bg-gray-50`}>
                  {i === 0 && (
                    <TableCell rowSpan={items.length} className="border-r align-middle">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${ACTIVITY_COLOR[type] ?? 'bg-gray-100'}`}>
                        {type}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="font-medium text-sm">{a.name}</TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {a.normal_side === 'debit' ? '차변' : '대변'}
                  </TableCell>
                  <TableCell className="text-sm">{a.increase_label}</TableCell>
                  <TableCell className="text-sm">{a.decrease_label}</TableCell>
                  <TableCell className="text-center">
                    <Button
                      size="sm"
                      variant={a.is_active ? 'outline' : 'ghost'}
                      className={`text-xs h-7 ${a.is_active ? '' : 'text-gray-400'}`}
                      disabled={toggling === a.id}
                      onClick={() => toggleActive(a.id, a.is_active)}
                    >
                      {toggling === a.id ? '...' : a.is_active ? '활성' : '비활성'}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(a)}>수정</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700" onClick={() => handleDelete(a.id, a.name)}>삭제</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 추가/수정 모달 */}
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg">{editing ? '계정과목 수정' : '계정과목 추가'}</h3>
            <div className="space-y-3">

              <div>
                <label className="text-sm font-medium">계정과목명 *</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  placeholder="보통예금"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium">활동구분 *</label>
                  <select
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm bg-white"
                    value={form.activity_type}
                    onChange={e => setField('activity_type', e.target.value)}
                  >
                    {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">증가방향 *</label>
                  <select
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm bg-white"
                    value={form.normal_side}
                    onChange={e => setField('normal_side', e.target.value)}
                  >
                    <option value="debit">차변 (Debit)</option>
                    <option value="credit">대변 (Credit)</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium">증가유형 코드 *</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.increase_type}
                    onChange={e => setField('increase_type', e.target.value)}
                    placeholder="입금"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">증가 라벨 *</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.increase_label}
                    onChange={e => setField('increase_label', e.target.value)}
                    placeholder="입금"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium">감소유형 코드 *</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.decrease_type}
                    onChange={e => setField('decrease_type', e.target.value)}
                    placeholder="출금"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">감소 라벨 *</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.decrease_label}
                    onChange={e => setField('decrease_label', e.target.value)}
                    placeholder="출금"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">비고</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.note}
                  onChange={e => setField('note', e.target.value)}
                  placeholder="메모"
                />
              </div>

              <div className="text-xs text-gray-400 bg-gray-50 rounded p-2 space-y-1">
                <p>• 증가유형 코드: 전표 분류 자동계산에 사용 (예: 입금, 매입, 취득, 차입)</p>
                <p>• 감소유형 코드: 전표 분류 자동계산에 사용 (예: 출금, 매출, 상환)</p>
                <p>• 라벨: 화면 표시용 (코드와 동일하게 입력해도 됨)</p>
              </div>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : '저장'}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
