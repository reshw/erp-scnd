import { createClient } from '@/lib/supabase/server'
import { getScope } from '@/lib/auth/scope'
import PasswordForm from './PasswordForm'

export default async function StaffAccountPage() {
  const scope = await getScope()
  if (scope.role !== 'employee') return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="space-y-6 max-w-sm">
      <h2 className="text-xl font-bold">내 정보</h2>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-xs text-gray-500 mb-1">이메일</div>
        <div className="text-sm">{user?.email}</div>
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <div className="text-sm font-medium mb-3">비밀번호 변경</div>
        <PasswordForm email={user?.email ?? ''} />
      </div>
    </div>
  )
}
