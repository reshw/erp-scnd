'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CancelButton({ draftId }: { draftId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function cancel() {
    if (!confirm('이 상신 건을 취소할까요?')) return
    setBusy(true); setError('')
    const res = await fetch(`/api/journal-drafts/${draftId}/cancel`, { method: 'POST' })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setError(data.error ?? '취소 실패'); return }
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={cancel} disabled={busy} className="text-xs text-red-500 hover:underline disabled:opacity-50">
        {busy ? '...' : '취소'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
