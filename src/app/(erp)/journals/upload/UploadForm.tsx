'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Result { ok: number; fail: number; total: number; errors: string[] }

export default function UploadForm() {
  const router  = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile]       = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<Result | null>(null)
  const [dragOver, setDragOver] = useState(false)

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  async function handleUpload() {
    if (!file) return
    setLoading(true); setResult(null)

    const fd = new FormData()
    fd.append('file', file)

    const res = await fetch('/api/journals/upload', { method: 'POST', body: fd })
    const data = await res.json()

    if (!res.ok) {
      setResult({ ok: 0, fail: 0, total: 0, errors: [data.message ?? '업로드 실패'] })
      setLoading(false)
      return
    }

    setResult(data)
    setLoading(false)
    if (data.ok > 0) router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* 드래그 앤 드롭 영역 */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
      >
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="space-y-1">
            <p className="font-medium text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div className="space-y-2 text-gray-500">
            <p className="text-3xl">📂</p>
            <p className="text-sm">파일을 드래그하거나 클릭하여 선택</p>
            <p className="text-xs text-gray-400">.xlsx / .xls / .csv</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {file && (
          <Button variant="outline" onClick={() => { setFile(null); setResult(null) }}>
            취소
          </Button>
        )}
        <Button onClick={handleUpload} disabled={!file || loading} className="flex-1">
          {loading ? '처리 중...' : '업로드'}
        </Button>
      </div>

      {/* 결과 */}
      {result && (
        <div className={`rounded-lg p-4 space-y-2 ${result.fail === 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <p className="font-medium">
            {result.total > 0 && `총 ${result.total}건 중 `}✅ {result.ok}건 성공
            {result.fail > 0 && <span className="text-red-600"> / ❌ {result.fail}건 실패</span>}
          </p>
          {(result.errors ?? []).length > 0 && (
            <ul className="text-sm text-red-600 space-y-0.5 list-disc list-inside">
              {(result.errors ?? []).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {result.ok > 0 && (
            <Button size="sm" variant="outline" onClick={() => router.push('/journals')}>
              현금출납장 보기
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
