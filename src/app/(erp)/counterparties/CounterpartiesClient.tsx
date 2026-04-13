'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

type Counterparty = {
  id: string
  name: string
  representative: string | null
  business_no: string | null
  bank_name: string | null
  bank_account_no: string | null
  note: string | null
}

const EMPTY: Omit<Counterparty, 'id'> = {
  name: '', representative: '', business_no: '', bank_name: '', bank_account_no: '', note: '',
}

export default function CounterpartiesClient({ counterparties: initial }: { counterparties: Counterparty[] }) {
  const router = useRouter()
  const [list, setList] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Counterparty | null>(null)
  const [form, setForm] = useState<Omit<Counterparty, 'id'>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setError('')
    setOpen(true)
  }

  function openEdit(c: Counterparty) {
    setEditing(c)
    setForm({ name: c.name, representative: c.representative ?? '', business_no: c.business_no ?? '', bank_name: c.bank_name ?? '', bank_account_no: c.bank_account_no ?? '', note: c.note ?? '' })
    setError('')
    setOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('거래처명은 필수입니다.'); return }
    setSaving(true)
    setError('')
    try {
      const method = editing ? 'PUT' : 'POST'
      const body = editing ? { ...form, id: editing.id } : form
      const res = await fetch('/api/counterparties', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? '저장 실패'); return }

      if (editing) {
        setList(prev => prev.map(c => c.id === editing.id ? { ...c, ...form } : c))
      } else {
        setList(prev => [...prev, { id: json.id, ...form }].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 거래처를 삭제하시겠습니까?`)) return
    const res = await fetch('/api/counterparties', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setList(prev => prev.filter(c => c.id !== id))
      router.refresh()
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{list.length}건</div>
        <Button size="sm" onClick={openNew}>+ 거래처 추가</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>거래처명</TableHead>
              <TableHead className="w-28">대표자</TableHead>
              <TableHead className="w-36">사업자번호</TableHead>
              <TableHead className="w-24">은행</TableHead>
              <TableHead className="w-40">계좌번호</TableHead>
              <TableHead>비고</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map(c => (
              <TableRow key={c.id} className="hover:bg-gray-50">
                <TableCell className="font-medium text-sm">{c.name}</TableCell>
                <TableCell className="text-sm text-gray-600">{c.representative ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-600">{c.business_no ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-600">{c.bank_name ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-600">{c.bank_account_no ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-500 max-w-[200px] truncate">{c.note ?? ''}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(c)}>수정</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700" onClick={() => handleDelete(c.id, c.name)}>삭제</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-400 py-8">거래처 없음</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 추가/수정 모달 */}
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="font-bold text-lg">{editing ? '거래처 수정' : '거래처 추가'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">거래처명 *</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="거래처명"
                />
              </div>
              <div>
                <label className="text-sm font-medium">대표자</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.representative ?? ''}
                  onChange={e => setForm(f => ({ ...f, representative: e.target.value }))}
                  placeholder="대표자명"
                />
              </div>
              <div>
                <label className="text-sm font-medium">사업자번호</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.business_no ?? ''}
                  onChange={e => setForm(f => ({ ...f, business_no: e.target.value }))}
                  placeholder="000-00-00000"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-sm font-medium">은행</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.bank_name ?? ''}
                    onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
                    placeholder="기업은행"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">계좌번호</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.bank_account_no ?? ''}
                    onChange={e => setForm(f => ({ ...f, bank_account_no: e.target.value }))}
                    placeholder="000-000000-00-000"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">비고</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.note ?? ''}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="메모"
                />
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
