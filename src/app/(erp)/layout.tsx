import LogoutButton from './LogoutButton'

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center gap-4">
        <h1 className="font-bold text-lg">ERP</h1>
        <nav className="flex gap-4 text-sm text-gray-600">
          <a href="/" className="hover:text-black">대시보드</a>
          <a href="/journals" className="hover:text-black">현금출납</a>
          <a href="/journals/batch" className="hover:text-black">일괄전표</a>
          <a href="/ledger" className="hover:text-black">계정원장</a>
          <a href="/clearings" className="hover:text-black">미결잔액</a>
          <a href="/accounts" className="hover:text-black">계정과목</a>
          <a href="/counterparties" className="hover:text-black">거래처</a>
          <a href="/projects" className="hover:text-black">프로젝트</a>
          <a href="/loans" className="hover:text-black">대출</a>
          <a href="/spending" className="hover:text-black">지출예정</a>
          <a href="/monthly" className="hover:text-black">월말마감</a>
          <a href="/assistant" className="hover:text-black font-medium text-blue-600">AI 전표</a>
        </nav>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
