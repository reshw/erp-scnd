import AssistantClient from '@/components/assistant/AssistantClient'

export default function AssistantPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4">AI 전표</h2>
      <AssistantClient />
    </div>
  )
}
