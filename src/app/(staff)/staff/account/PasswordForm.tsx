'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function PasswordForm({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (newPassword.length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (newPassword !== confirm) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)

    // updateUser는 현재 비밀번호를 검증하지 않으므로, signInWithPassword로 먼저
    // 본인 확인부터 한다 — 성공하면 세션은 그대로 유지된 채 재로그인된다.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (verifyErr) {
      setLoading(false)
      setError('현재 비밀번호가 올바르지 않습니다.')
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)

    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirm('')
    setSuccess(true)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="block text-sm text-gray-600 mb-1">현재 비밀번호</label>
        <input
          type="password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          required
        />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">새 비밀번호</label>
        <input
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          required
          minLength={8}
        />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">새 비밀번호 확인</label>
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          required
          minLength={8}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">비밀번호가 변경되었습니다.</p>}
      <button
        type="submit"
        disabled={loading}
        className="bg-black text-white rounded px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 self-start"
      >
        {loading ? '변경 중...' : '비밀번호 변경'}
      </button>
    </form>
  )
}
