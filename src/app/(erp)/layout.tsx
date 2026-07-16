import LogoutButton from './LogoutButton'

const NAV_GROUPS: { label: string; links: { href: string; label: string; highlight?: boolean }[] }[] = [
  {
    label: '전표',
    links: [
      { href: '/journals', label: '현금출납' },
      { href: '/journals/batch', label: '일괄전표' },
      { href: '/assistant', label: 'AI 전표', highlight: true },
    ],
  },
  {
    label: '조회',
    links: [
      { href: '/ledger', label: '계정원장' },
      { href: '/clearings', label: '미결잔액' },
      { href: '/monthly', label: '월말마감' },
      { href: '/vat', label: '부가세' },
    ],
  },
  {
    label: '기준정보',
    links: [
      { href: '/accounts', label: '계정과목' },
      { href: '/counterparties', label: '거래처' },
      { href: '/projects', label: '프로젝트' },
      { href: '/entities', label: '사업자' },
    ],
  },
  {
    label: '관리',
    links: [
      { href: '/loans', label: '대출' },
      { href: '/spending', label: '지출예정' },
    ],
  },
]

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="px-6 py-3 flex items-center gap-4">
          <a href="/" className="font-bold text-lg hover:text-gray-700">ERP</a>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </div>
        <nav className="px-6 py-2 border-t flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600 bg-gray-50/60">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className="flex items-center gap-3 pr-6 border-r last:border-r-0 last:pr-0">
              <span className="text-xs font-semibold text-gray-400 shrink-0">{group.label}</span>
              <div className="flex items-center gap-3">
                {group.links.map(link => (
                  <a
                    key={link.href}
                    href={link.href}
                    className={`hover:text-black ${link.highlight ? 'font-medium text-blue-600' : ''}`}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
