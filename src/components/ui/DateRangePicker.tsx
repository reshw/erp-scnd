'use client'

import { useState } from 'react'

interface Props {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  onMonthChange?: (from: string, to: string) => void
}

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function currentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function isFullMonth(from: string, to: string) {
  if (!from || !to) return false
  const r = monthRange(from.slice(0, 7))
  return from === r.from && to === r.to
}

// ── 월/연 선택 팝업 ───────────────────────────────────────────────────────────

function MonthPopup({
  selected,
  onSelect,
  onClose,
}: {
  selected: string   // YYYY-MM
  onSelect: (ym: string) => void
  onClose: () => void
}) {
  const selY = parseInt(selected.slice(0, 4))
  const selM = parseInt(selected.slice(5, 7))

  const [view, setView] = useState<'month' | 'year'>('month')
  const [viewYear, setViewYear] = useState(selY)
  // decade: 연도 선택 뷰의 시작 연도
  const [decadeStart, setDecadeStart] = useState(Math.floor(selY / 10) * 10)

  function pickMonth(m: number) {
    onSelect(`${viewYear}-${String(m).padStart(2, '0')}`)
    onClose()
  }

  function pickYear(y: number) {
    setViewYear(y)
    setView('month')
  }

  const decades = Array.from({ length: 12 }, (_, i) => decadeStart + i)

  return (
    <>
      {/* 투명 백드롭 — 외부 클릭 시 닫힘 */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="absolute left-0 top-full mt-1 z-50 bg-white border rounded-xl shadow-lg p-3 w-52 select-none">
        {view === 'month' ? (
          <>
            {/* 헤더: 연도 */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewYear(y => y - 1)}
                className="px-2 py-1 rounded hover:bg-gray-100 text-gray-500 text-sm"
              >‹</button>
              <button
                type="button"
                onClick={() => setView('year')}
                className="font-semibold text-sm hover:text-blue-600"
              >
                {viewYear}년
              </button>
              <button
                type="button"
                onClick={() => setViewYear(y => y + 1)}
                className="px-2 py-1 rounded hover:bg-gray-100 text-gray-500 text-sm"
              >›</button>
            </div>

            {/* 월 그리드 */}
            <div className="grid grid-cols-3 gap-1">
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
                const isSelected = viewYear === selY && m === selM
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pickMonth(m)}
                    className={`py-1.5 text-sm rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-gray-800 text-white font-semibold'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {m}월
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            {/* 헤더: 연도 범위 */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setDecadeStart(d => d - 12)}
                className="px-2 py-1 rounded hover:bg-gray-100 text-gray-500 text-sm"
              >‹</button>
              <span className="text-sm font-semibold text-gray-600">
                {decadeStart} – {decadeStart + 11}
              </span>
              <button
                type="button"
                onClick={() => setDecadeStart(d => d + 12)}
                className="px-2 py-1 rounded hover:bg-gray-100 text-gray-500 text-sm"
              >›</button>
            </div>

            {/* 연도 그리드 */}
            <div className="grid grid-cols-3 gap-1">
              {decades.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => pickYear(y)}
                  className={`py-1.5 text-sm rounded-lg transition-colors ${
                    y === viewYear
                      ? 'bg-gray-800 text-white font-semibold'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function DateRangePicker({ from, to, onChange, onMonthChange }: Props) {
  const initYM = (from && isFullMonth(from, to)) ? from.slice(0, 7) : currentYM()
  const [mode, setMode] = useState<'month' | 'range'>(
    isFullMonth(from, to) || (!from && !to) ? 'month' : 'range'
  )
  const [ym, setYm] = useState(initYM)
  const [popupOpen, setPopupOpen] = useState(false)

  function goMonth(newYm: string) {
    setYm(newYm)
    const r = monthRange(newYm)
    onChange(r.from, r.to)
    onMonthChange?.(r.from, r.to)
  }

  function switchToMonth() {
    const newYm = from ? from.slice(0, 7) : currentYM()
    setYm(newYm)
    setMode('month')
    const r = monthRange(newYm)
    onChange(r.from, r.to)
    onMonthChange?.(r.from, r.to)
  }

  const [y, m] = ym.split('-').map(Number)

  return (
    <div className="flex items-center gap-2">
      {/* 모드 토글 */}
      <div className="flex border rounded overflow-hidden text-xs shrink-0">
        <button
          type="button"
          onClick={() => mode !== 'month' && switchToMonth()}
          className={`px-2.5 py-1.5 transition-colors ${
            mode === 'month' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >월</button>
        <button
          type="button"
          onClick={() => setMode('range')}
          className={`px-2.5 py-1.5 transition-colors ${
            mode === 'range' ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >기간</button>
      </div>

      {mode === 'month' ? (
        <div className="flex items-center gap-0.5 relative">
          <button
            type="button"
            onClick={() => goMonth(shiftMonth(ym, -1))}
            className="px-2 py-1.5 text-sm border rounded hover:bg-gray-50 leading-none text-gray-500"
          >‹</button>

          <button
            type="button"
            onClick={() => setPopupOpen(v => !v)}
            className="text-sm font-medium px-3 py-1.5 border rounded hover:bg-gray-50 tabular-nums min-w-[96px] text-center"
          >
            {y}년 {m}월
          </button>

          <button
            type="button"
            onClick={() => goMonth(shiftMonth(ym, 1))}
            className="px-2 py-1.5 text-sm border rounded hover:bg-gray-50 leading-none text-gray-500"
          >›</button>

          {popupOpen && (
            <MonthPopup
              selected={ym}
              onSelect={newYm => goMonth(newYm)}
              onClose={() => setPopupOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={from}
            onChange={e => onChange(e.target.value, to)}
            placeholder="YYYY-MM-DD"
            className="border rounded px-2 py-1.5 text-sm w-28 bg-white tabular-nums"
          />
          <span className="text-gray-400 text-xs shrink-0">~</span>
          <input
            type="text"
            value={to}
            onChange={e => onChange(from, e.target.value)}
            placeholder="YYYY-MM-DD"
            className="border rounded px-2 py-1.5 text-sm w-28 bg-white tabular-nums"
          />
        </div>
      )}
    </div>
  )
}
