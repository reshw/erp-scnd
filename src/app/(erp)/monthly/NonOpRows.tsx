'use client'

import { useState } from 'react'
import Link from 'next/link'

function fmtPL(n: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

type MonthBucket = { debit: number; credit: number }
// activity_type → subtype → month → {debit, credit}
type TypeSubAgg = Record<string, Record<string, Record<string, MonthBucket>>>
// month → activity_type → {debit, credit}
type Agg = Record<string, Record<string, MonthBucket>>

interface Props {
  months: string[]
  currentMonth: string
  year: string
  agg: Agg
  typeSubAgg: TypeSubAgg
}

function journalLink(year: string, mk: string | null, type: string, subtype?: string) {
  const p = new URLSearchParams({ year })
  if (mk) p.set('month', String(parseInt(mk.slice(5))))
  p.set('type', type)
  if (subtype) p.set('subtype', subtype)
  return `/journals?${p.toString()}`
}

function cashImpact(agg: Agg, type: string, mk: string): number {
  const d = agg[mk]?.[type]
  return d ? d.credit - d.debit : 0
}

function cashImpactSub(subData: Record<string, MonthBucket>, mk: string): number {
  const d = subData[mk]
  return d ? d.credit - d.debit : 0
}

// 행 순서 및 설명
const ROW_CONFIG: { type: string; label: string; expandable: boolean }[] = [
  { type: '재무', label: '재무 (차입 – 상환)', expandable: true },
  { type: '세무', label: '세금 정산',           expandable: false },
  { type: '개인', label: '개인 (출자 – 인출)', expandable: true },
  { type: '투자', label: '투자 (회수 – 집행)', expandable: false },
]

export default function NonOpRows({ months, currentMonth, year, agg, typeSubAgg }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (type: string) =>
    setExpanded(prev => ({ ...prev, [type]: !prev[type] }))

  return (
    <>
      {ROW_CONFIG.map(({ type, label, expandable }) => {
        const hasData = months.some(mk => cashImpact(agg, type, mk) !== 0)
        const annualV = months.reduce((s, mk) => s + cashImpact(agg, type, mk), 0)
        const isOpen  = expanded[type]
        const subAgg  = typeSubAgg[type] ?? {}
        const subtypes = Object.keys(subAgg)

        return (
          <>
            {/* 집계 행 */}
            <tr key={type} className={`border-b hover:bg-gray-50 ${!hasData ? 'opacity-30' : ''}`}>
              <td
                className={`px-3 py-2 text-sm text-gray-600 ${expandable && hasData ? 'cursor-pointer select-none' : ''}`}
                onClick={expandable && hasData ? () => toggle(type) : undefined}
              >
                {expandable && hasData && (
                  <span className="mr-1 text-gray-400 text-xs">{isOpen ? '▾' : '▸'}</span>
                )}
                {label}
              </td>
              {months.map(mk => {
                const v = cashImpact(agg, type, mk)
                return (
                  <td key={mk} className={`text-right px-3 py-2 tabular-nums ${mk === currentMonth ? 'bg-blue-50/50' : ''} ${v < 0 ? 'text-red-500' : v > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                    {v !== 0 ? (
                      <Link href={journalLink(year, mk, type)} className="hover:underline">
                        {fmtPL(v)}
                      </Link>
                    ) : '-'}
                  </td>
                )
              })}
              <td className={`text-right px-3 py-2 tabular-nums bg-gray-50 ${annualV < 0 ? 'text-red-500' : annualV > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                {annualV !== 0 ? (
                  <Link href={journalLink(year, null, type)} className="hover:underline">
                    {fmtPL(annualV)}
                  </Link>
                ) : '-'}
              </td>
            </tr>

            {/* 서브 행 (펼쳐진 경우) */}
            {expandable && isOpen && subtypes.map(subtype => {
              const subData = subAgg[subtype]
              const subAnnual = months.reduce((s, mk) => s + cashImpactSub(subData, mk), 0)
              const subHasData = months.some(mk => cashImpactSub(subData, mk) !== 0)
              if (!subHasData) return null
              return (
                <tr key={`${type}-${subtype}`} className="border-b bg-gray-50/40">
                  <td className="px-3 py-2 pl-8 text-sm text-gray-400">└ {subtype}</td>
                  {months.map(mk => {
                    const v = cashImpactSub(subData, mk)
                    return (
                      <td key={mk} className={`text-right px-3 py-2 tabular-nums text-sm ${mk === currentMonth ? 'bg-blue-50/30' : ''} ${v < 0 ? 'text-red-400' : v > 0 ? 'text-blue-500' : 'text-gray-200'}`}>
                        {v !== 0 ? (
                          <Link href={journalLink(year, mk, type, subtype)} className="hover:underline">
                            {fmtPL(v)}
                          </Link>
                        ) : '-'}
                      </td>
                    )
                  })}
                  <td className={`text-right px-3 py-2 tabular-nums text-sm bg-gray-50 ${subAnnual < 0 ? 'text-red-400' : subAnnual > 0 ? 'text-blue-500' : 'text-gray-300'}`}>
                    {subAnnual !== 0 ? (
                      <Link href={journalLink(year, null, type, subtype)} className="hover:underline">
                        {fmtPL(subAnnual)}
                      </Link>
                    ) : '-'}
                  </td>
                </tr>
              )
            })}
          </>
        )
      })}
    </>
  )
}
