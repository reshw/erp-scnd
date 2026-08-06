'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function DraftActions({ draftId }: { draftId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  async function approve() {
    setBusy(true); setError('')
    const res = await fetch(`/api/journal-drafts/${draftId}/approve`, { method: 'POST' })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setError(data.error ?? '승인 실패'); return }
    router.refresh()
  }

  async function reject() {
    setBusy(true); setError('')
    const res = await fetch(`/api/journal-drafts/${draftId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setError(data.error ?? '반려 실패'); return }
    router.refresh()
  }

  if (rejecting) {
    return (
      <div className="flex items-center gap-1 justify-end whitespace-nowrap">
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="반려 사유"
          className="border rounded px-1.5 py-0.5 text-xs w-32"
        />
        <Button size="sm" variant="outline" className="text-xs px-2 h-6" disabled={busy} onClick={reject}>
          {busy ? '...' : '반려 확정'}
        </Button>
        <button onClick={() => setRejecting(false)} className="text-xs text-gray-400 hover:underline">취소</button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Button size="sm" className="text-xs px-2 h-6" disabled={busy} onClick={approve}>
        {busy ? '...' : '승인'}
      </Button>
      <button onClick={() => setRejecting(true)} className="text-xs text-red-500 hover:underline">반려</button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
