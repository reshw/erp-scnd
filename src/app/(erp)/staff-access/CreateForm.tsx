'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function CreateForm({ projects }: { projects: { id: string; code: string }[] }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [projectId, setProjectId] = useState('')
  const [email, setEmail] = useState('')
  const [issueDbKey, setIssueDbKey] = useState(true)
  const [issueWebLogin, setIssueWebLogin] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Record<string, string> | null>(null)

  function download(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadEnv() {
    if (!result?.db_role) return
    const content =
      `PGHOST=${result.pg_host}\n` +
      `PGPORT=5432\n` +
      `PGUSER=${result.pg_user}\n` +
      `PGPASSWORD=${result.db_password}\n` +
      `PGDATABASE=postgres\n`
    download('.env', content)
  }

  function downloadWebLogin() {
    if (!result?.email) return
    download(
      `${result.email}-login.txt`,
      `ERP 웹 로그인\n이메일: ${result.email}\n비밀번호: ${result.web_password}\n`
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setResult(null)
    const res = await fetch('/api/staff-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label, project_id: projectId, email: email || undefined,
        issue_db_key: issueDbKey, issue_web_login: issueWebLogin,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? '발급 실패'); return }
    setResult(data)
    setLabel(''); setProjectId(''); setEmail('')
    router.refresh()
  }

  return (
    <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">신규 발급</h3>
      <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs text-gray-500 block mb-1">이름표</label>
          <input value={label} onChange={e => setLabel(e.target.value)}
            placeholder="예: NADIA 직원" className="border rounded px-2 py-1.5 text-sm w-40" required />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">프로젝트</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm w-32" required>
            <option value="">선택</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={issueDbKey} onChange={e => setIssueDbKey(e.target.checked)} className="rounded" />
          AI용 DB 키
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={issueWebLogin} onChange={e => setIssueWebLogin(e.target.checked)} className="rounded" />
          웹 로그인
        </label>
        {issueWebLogin && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">이메일</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="employee@company.com" className="border rounded px-2 py-1.5 text-sm w-52" required={issueWebLogin} />
          </div>
        )}
        <Button size="sm" type="submit" disabled={saving}>{saving ? '발급 중...' : '발급'}</Button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && (
        <div className="border border-green-300 bg-green-50 rounded-lg p-3 text-sm space-y-1">
          <p className="font-medium text-green-800">발급 완료 — 아래 값은 다시 볼 수 없으니 지금 파일로 저장하거나 복사해서 전달하세요</p>
          {result.db_role && (
            <div className="space-y-1">
              <div className="font-mono text-xs bg-white border rounded p-2 space-y-0.5">
                <div>PGHOST={result.pg_host}</div>
                <div>PGPORT=5432</div>
                <div>PGUSER={result.pg_user}</div>
                <div>PGPASSWORD={result.db_password}</div>
                <div>PGDATABASE=postgres</div>
              </div>
              <button type="button" onClick={downloadEnv} className="text-xs text-blue-600 hover:underline">
                .env로 다운로드 (erp-ai-agent 폴더에 바로 넣으면 됨)
              </button>
            </div>
          )}
          {result.email && (
            <div className="space-y-1">
              <div className="font-mono text-xs bg-white border rounded p-2 space-y-0.5">
                <div>이메일: {result.email}</div>
                <div>비밀번호: {result.web_password}</div>
              </div>
              <button type="button" onClick={downloadWebLogin} className="text-xs text-blue-600 hover:underline">
                텍스트 파일로 다운로드
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
