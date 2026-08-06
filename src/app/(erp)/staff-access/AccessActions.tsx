'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AccessActions({ id, revoked }: { id: string; revoked: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function call(action: 'revoke' | 'reactivate') {
    if (action === 'revoke' && !confirm('이 키/계정을 즉시 차단할까요? DB 접속과 웹 로그인이 모두 막힙니다.')) return
    setBusy(true)
    const res = await fetch(`/api/staff-access/${id}/${action}`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? '처리 실패')
      return
    }
    router.refresh()
  }

  return revoked ? (
    <button
      onClick={() => call('reactivate')}
      disabled={busy}
      className="text-xs text-green-600 hover:underline"
    >
      재활성화
    </button>
  ) : (
    <button
      onClick={() => call('revoke')}
      disabled={busy}
      className="text-xs text-red-500 hover:underline"
    >
      차단
    </button>
  )
}
