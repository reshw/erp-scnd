'use client'

import { useState, useRef, useEffect } from 'react'

interface Option {
  id: string
  label: string
}

export default function Combobox({
  name,
  options,
  placeholder = '검색...',
  defaultId = '',
  defaultLabel = '',
}: {
  name: string
  options: Option[]
  placeholder?: string
  defaultId?: string
  defaultLabel?: string
}) {
  const [query, setQuery] = useState(defaultLabel)
  const [selectedId, setSelectedId] = useState(defaultId)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim() === ''
    ? options.slice(0, 30)
    : options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())).slice(0, 30)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function select(opt: Option) {
    setSelectedId(opt.id)
    setQuery(opt.label)
    setOpen(false)
  }

  function clear() {
    setSelectedId('')
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      {/* 실제 폼 제출용 hidden input */}
      <input type="hidden" name={name} value={selectedId} />

      <div className="flex items-center border rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedId(''); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 text-sm outline-none"
        />
        {(query || selectedId) && (
          <button type="button" onClick={clear} className="px-2 text-gray-300 hover:text-gray-500 text-xs">✕</button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto text-sm">
          {filtered.map(opt => (
            <li
              key={opt.id}
              onMouseDown={() => select(opt)}
              className={`px-3 py-2 cursor-pointer hover:bg-blue-50 ${opt.id === selectedId ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}

      {open && query.trim() !== '' && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
          결과 없음
        </div>
      )}
    </div>
  )
}
