export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center gap-4">
        <h1 className="font-bold text-lg">ERP</h1>
        <nav className="flex gap-4 text-sm text-gray-600">
          <a href="/" className="hover:text-black">대시보드</a>
          <a href="/journals" className="hover:text-black">현금출납</a>
          <a href="/accounts" className="hover:text-black">계정과목</a>
          <a href="/counterparties" className="hover:text-black">거래처</a>
          <a href="/loans" className="hover:text-black">대출</a>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
