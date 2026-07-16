'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

type Entity = {
  id: string
  name: string
  type: 'corporate' | 'personal'
  business_no: string | null
  opened_at: string | null
  biz_type: string | null
  biz_item: string | null
}

const EMPTY = {
  name: '', type: 'corporate' as 'corporate' | 'personal',
  business_no: '', opened_at: '', biz_type: '', biz_item: '',
}

export default function EntitiesClient({ entities: initial }: { entities: Entity[] }) {
  const router = useRouter()
  const [list, setList] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Entity | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setError('')
    setOpen(true)
  }

  function openEdit(e: Entity) {
    setEditing(e)
    setForm({
      name: e.name, type: e.type,
      business_no: e.business_no ?? '', opened_at: e.opened_at ?? '',
      biz_type: e.biz_type ?? '', biz_item: e.biz_item ?? '',
    })
    setError('')
    setOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('사업자명은 필수입니다.'); return }
    setSaving(true)
    setError('')
    try {
      const method = editing ? 'PUT' : 'POST'
      const body = editing ? { ...form, id: editing.id } : form
      const res = await fetch('/api/entities', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? '저장 실패'); return }

      if (editing) {
        setList(prev => prev.map(e => e.id === editing.id
          ? { ...e, ...form, business_no: form.business_no || null, opened_at: form.opened_at || null, biz_type: form.biz_type || null, biz_item: form.biz_item || null }
          : e))
      } else {
        setList(prev => [...prev, {
          id: json.id, ...form,
          business_no: form.business_no || null, opened_at: form.opened_at || null,
          biz_type: form.biz_type || null, biz_item: form.biz_item || null,
        }].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 사업자를 삭제하시겠습니까?\n매칭된 프로젝트가 있으면 매칭이 해제됩니다.`)) return
    const res = await fetch('/api/entities', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const json = await res.json()
    if (res.ok) {
      setList(prev => prev.filter(e => e.id !== id))
      router.refresh()
    } else {
      alert(json.message ?? '삭제 실패')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">전체 {list.length}개</div>
        <Button size="sm" onClick={openNew}>+ 사업자 추가</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>사업자명</TableHead>
              <TableHead className="w-36">사업자등록번호</TableHead>
              <TableHead className="w-28">개업일</TableHead>
              <TableHead className="w-28">업태</TableHead>
              <TableHead>종목</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map(e => (
              <TableRow key={e.id} className="hover:bg-gray-50">
                <TableCell className="font-medium text-sm">{e.name}</TableCell>
                <TableCell className="font-mono text-sm">{e.business_no ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-500">{e.opened_at ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-500">{e.biz_type ?? '-'}</TableCell>
                <TableCell className="text-sm text-gray-500">{e.biz_item ?? '-'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(e)}>수정</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700" onClick={() => handleDelete(e.id, e.name)}>삭제</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-8">사업자 없음</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 className="font-bold text-lg">{editing ? '사업자 수정' : '사업자 추가'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">사업자명 *</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.name}
                  onChange={ev => setForm(f => ({ ...f, name: ev.target.value }))}
                  placeholder="마음디자인랩"
                />
              </div>
              <div>
                <label className="text-sm font-medium">사업자등록번호</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm font-mono"
                  value={form.business_no}
                  onChange={ev => setForm(f => ({ ...f, business_no: ev.target.value }))}
                  placeholder="000-00-00000"
                />
              </div>
              <div>
                <label className="text-sm font-medium">개업일</label>
                <input
                  type="date"
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.opened_at}
                  onChange={ev => setForm(f => ({ ...f, opened_at: ev.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">업태</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.biz_type}
                    onChange={ev => setForm(f => ({ ...f, biz_type: ev.target.value }))}
                    placeholder="제조업"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">종목</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                    value={form.biz_item}
                    onChange={ev => setForm(f => ({ ...f, biz_item: ev.target.value }))}
                    placeholder="봉제의복 제조업"
                  />
                </div>
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
