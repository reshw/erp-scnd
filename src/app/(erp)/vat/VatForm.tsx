'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

type Entity = { id: string; name: string }

// 부가세 과세기간 프리셋 (일반과세자: 1기 1/1~6/30, 2기 7/1~12/31)
function periods() {
  const y = new Date().getFullYear()
  return [
    { label: `${y}년 1기 (1/1 ~ 6/30)`,     start: `${y}-01-01`,     end: `${y}-06-30` },
    { label: `${y - 1}년 2기 (7/1 ~ 12/31)`, start: `${y - 1}-07-01`, end: `${y - 1}-12-31` },
    { label: `${y - 1}년 1기 (1/1 ~ 6/30)`,  start: `${y - 1}-01-01`, end: `${y - 1}-06-30` },
  ]
}

export default function VatForm({ entities }: { entities: Entity[] }) {
  const [entityId, setEntityId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  function download(s: string, e: string) {
    const qs = new URLSearchParams({ start: s, end: e })
    if (entityId) qs.set('entity_id', entityId)
    window.location.href = `/api/vat/export?${qs.toString()}`
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-lg p-5 space-y-2">
        <h3 className="font-medium text-sm text-gray-700">사업자</h3>
        <select
          className="w-full border rounded-md px-3 py-1.5 text-sm bg-white"
          value={entityId}
          onChange={e => setEntityId(e.target.value)}
        >
          <option value="">전체 사업자 통합</option>
          {entities.map(en => (
            <option key={en.id} value={en.id}>{en.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border rounded-lg p-5 space-y-3">
        <h3 className="font-medium text-sm text-gray-700">과세기간 선택</h3>
        <div className="flex flex-col gap-2">
          {periods().map(p => (
            <button
              key={p.start}
              type="button"
              onClick={() => download(p.start, p.end)}
              className="flex items-center justify-between border rounded-md px-4 py-3 hover:bg-gray-50 text-sm text-left"
            >
              <span>{p.label}</span>
              <span className="text-blue-600 font-medium">엑셀 다운로드</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-5 space-y-3">
        <h3 className="font-medium text-sm text-gray-700">직접 기간 지정</h3>
        <div className="flex items-end gap-3">
          <label className="text-sm">
            <span className="block text-gray-500 mb-1">시작일</span>
            <input
              type="date" required
              className="border rounded-md px-2 py-1.5"
              value={start}
              onChange={e => setStart(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 mb-1">종료일</span>
            <input
              type="date" required
              className="border rounded-md px-2 py-1.5"
              value={end}
              onChange={e => setEnd(e.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={!start || !end}
            onClick={() => download(start, end)}
          >
            엑셀 다운로드
          </Button>
        </div>
      </div>
    </div>
  )
}
