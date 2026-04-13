'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'

type Project = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
}

const EMPTY = { code: '', name: '', description: '' }

export default function ProjectsClient({ projects: initial }: { projects: Project[] }) {
  const router = useRouter()
  const [list, setList] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState('')

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setError('')
    setOpen(true)
  }

  function openEdit(p: Project) {
    setEditing(p)
    setForm({ code: p.code, name: p.name, description: p.description ?? '' })
    setError('')
    setOpen(true)
  }

  async function handleSave() {
    if (!form.code.trim()) { setError('프로젝트 코드는 필수입니다.'); return }
    if (!form.name.trim()) { setError('프로젝트명은 필수입니다.'); return }
    setSaving(true)
    setError('')
    try {
      const method = editing ? 'PUT' : 'POST'
      const body = editing ? { ...form, id: editing.id } : form
      const res = await fetch('/api/projects', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message ?? '저장 실패'); return }

      if (editing) {
        setList(prev => prev.map(p => p.id === editing.id ? { ...p, ...form } : p))
      } else {
        setList(prev => [...prev, { id: json.id, ...form, is_active: true }].sort((a, b) => a.code.localeCompare(b.code)))
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    setToggling(id)
    const res = await fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    })
    if (res.ok) {
      setList(prev => prev.map(p => p.id === id ? { ...p, is_active: !current } : p))
      router.refresh()
    }
    setToggling(null)
  }

  async function handleDelete(id: string, code: string) {
    if (!confirm(`"${code}" 프로젝트를 삭제하시겠습니까?\n연결된 전표가 있으면 삭제되지 않습니다.`)) return
    const res = await fetch('/api/projects', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const json = await res.json()
    if (res.ok) {
      setList(prev => prev.filter(p => p.id !== id))
      router.refresh()
    } else {
      alert(json.message ?? '삭제 실패')
    }
  }

  const activeCount = list.filter(p => p.is_active).length

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{activeCount}개 활성 / 전체 {list.length}개</div>
        <Button size="sm" onClick={openNew}>+ 프로젝트 추가</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-32">코드</TableHead>
              <TableHead>프로젝트명</TableHead>
              <TableHead>설명</TableHead>
              <TableHead className="w-24 text-center">상태</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map(p => (
              <TableRow key={p.id} className={`hover:bg-gray-50 ${!p.is_active ? 'opacity-50' : ''}`}>
                <TableCell className="font-mono font-medium text-sm">{p.code}</TableCell>
                <TableCell className="text-sm">{p.name}</TableCell>
                <TableCell className="text-sm text-gray-500">{p.description ?? '-'}</TableCell>
                <TableCell className="text-center">
                  <Button
                    size="sm"
                    variant={p.is_active ? 'outline' : 'ghost'}
                    className={`text-xs h-7 ${p.is_active ? '' : 'text-gray-400'}`}
                    disabled={toggling === p.id}
                    onClick={() => toggleActive(p.id, p.is_active)}
                  >
                    {toggling === p.id ? '...' : p.is_active ? '활성' : '비활성'}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(p)}>수정</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700" onClick={() => handleDelete(p.id, p.code)}>삭제</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-400 py-8">프로젝트 없음</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 추가/수정 모달 */}
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 className="font-bold text-lg">{editing ? '프로젝트 수정' : '프로젝트 추가'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">코드 *</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm font-mono"
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="JH308"
                  disabled={!!editing}
                />
                {editing && <p className="text-xs text-gray-400 mt-1">코드는 변경할 수 없습니다.</p>}
              </div>
              <div>
                <label className="text-sm font-medium">프로젝트명 *</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="프로젝트명"
                />
              </div>
              <div>
                <label className="text-sm font-medium">설명</label>
                <input
                  className="mt-1 w-full border rounded px-3 py-1.5 text-sm"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="간단한 설명"
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
