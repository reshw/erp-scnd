'use client'

import { useRef, useEffect, useState } from 'react'
import JournalPreviewCard, { PreviewData } from './JournalPreviewCard'

type DisplayMessage = {
  role: 'user' | 'model'
  text: string
  preview?: PreviewData
  journalId?: string | null
  journalNo?: number | null
}

type GeminiContent = {
  role: 'user' | 'model'
  parts: any[]
}

const STORAGE_KEY = 'ai-journal-session'
const INITIAL_TEXT = '안녕하세요! 전표 발행을 도와드리겠습니다. 거래 내용을 말씀해 주세요.'
const INITIAL_MESSAGES: DisplayMessage[] = [{ role: 'model', text: INITIAL_TEXT }]
const INITIAL_HISTORY: GeminiContent[] = [{ role: 'model', parts: [{ text: INITIAL_TEXT }] }]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function AssistantClient() {
  const [messages, setMessages] = useState<DisplayMessage[]>(INITIAL_MESSAGES)
  const [history, setHistory] = useState<GeminiContent[]>(INITIAL_HISTORY)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 마운트 시 오늘 세션 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.date === todayStr()) {
        setHistory(saved.history)
        setMessages(saved.messages)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // history가 바뀔 때마다 저장 (초기값은 제외)
  useEffect(() => {
    if (history === INITIAL_HISTORY) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayStr(), history, messages }))
    } catch {
      // 저장 공간 부족 등 무시
    }
  }, [history, messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)
    setError(null)

    const newHistory: GeminiContent[] = [...history, { role: 'user', parts: [{ text }] }]
    setMessages(prev => [...prev, { role: 'user', text }])

    try {
      const res = await fetch('/api/ai-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: newHistory }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? `서버 오류 (${res.status})`)
      }

      const data = await res.json()
      setHistory(data.history)
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          text: data.text,
          preview: data.preview ?? undefined,
          journalId: data.journalId ?? undefined,
          journalNo: data.journalNo ?? undefined,
        },
      ])
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY)
    setMessages(INITIAL_MESSAGES)
    setHistory(INITIAL_HISTORY)
    setInput('')
    setError(null)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%]">
              <div
                className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-sm'
                    : 'bg-white border text-gray-800 rounded-bl-sm'
                }`}
              >
                {msg.text}
              </div>
              {msg.preview && (
                <JournalPreviewCard preview={msg.preview} journalNo={msg.journalNo} />
              )}
              {msg.journalId && (
                <div className="mt-1 text-xs text-gray-500">
                  <a href={`/journals/${msg.journalId}`} className="underline hover:text-gray-700">
                    전표 상세 보기 →
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-gray-400 animate-pulse">
              입력 중...
            </div>
          </div>
        )}
        {error && (
          <div className="text-sm text-red-500 text-center bg-red-50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t pt-3 flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="거래 내용을 입력하세요... (Enter 전송 / Shift+Enter 줄바꿈)"
          rows={2}
          className="flex-1 resize-none border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
          disabled={loading}
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-blue-600 transition-colors"
          >
            전송
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 text-gray-500 text-sm rounded-lg border hover:bg-gray-50 transition-colors"
          >
            초기화
          </button>
        </div>
      </div>
    </div>
  )
}
