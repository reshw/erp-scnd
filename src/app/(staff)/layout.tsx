import { redirect } from 'next/navigation'
import { getScope } from '@/lib/auth/scope'
import LogoutButton from '../(erp)/LogoutButton'

const LINKS = [
  { href: '/staff', label: '잔액/손익' },
  { href: '/staff/journals', label: '전표 조회' },
  { href: '/staff/drafts', label: '내 상신함' },
]

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // 미들웨어가 이미 걸러주지만, 우회 대비 서버 컴포넌트에서도 재확인한다.
  const scope = await getScope()
  if (scope.role !== 'employee') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="px-6 py-3 flex items-center gap-4">
          <span className="font-bold text-lg">ERP (직원)</span>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </div>
        <nav className="px-6 py-2 border-t flex items-center gap-4 text-sm text-gray-600 bg-gray-50/60">
          {LINKS.map(l => (
            <a key={l.href} href={l.href} className="hover:text-black">{l.label}</a>
          ))}
        </nav>
      </header>
      <main className="p-6 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
