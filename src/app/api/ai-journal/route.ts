import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { buildSystemPrompt } from '@/lib/ai/systemPrompt'
import { journalTools } from '@/lib/ai/tools'

const GEMINI_MODEL = 'gemini-flash-latest'

export async function POST(req: NextRequest) {
  const { history } = await req.json()

  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: accounts }, { data: projects }] = await Promise.all([
    supabase
      .from('accounts')
      .select('id,name,activity_type,normal_side,increase_label,decrease_label')
      .eq('is_active', true)
      .order('name'),
    (supabase as any)
      .from('projects')
      .select('id,code')
      .eq('is_active', true)
      .order('code'),
  ])

  const projectMap = Object.fromEntries((projects ?? []).map((p: any) => [p.id, p.code as string]))

  const { data: lastJournal } = await (supabase as any)
    .from('journals')
    .select('journal_no')
    .order('journal_no', { ascending: false })
    .limit(1)
    .single() as { data: { journal_no: number } | null }

  const nextNo = (lastJournal?.journal_no ?? 0) + 1
  const accountMap = Object.fromEntries((accounts ?? []).map((a: any) => [a.id, a]))
  const systemPrompt = buildSystemPrompt(accounts ?? [], projects ?? [], today)

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: journalTools }],
    generationConfig: { temperature: 0.1 },
  })

  let result
  try {
    result = await model.generateContent({ contents: history })
  } catch (e: any) {
    const msg: string = e.message ?? '알 수 없는 오류'
    const status = msg.includes('429') ? 429 : 500
    return NextResponse.json({ message: msg }, { status })
  }

  const response = result.response
  const functionCalls = response.functionCalls()

  if (functionCalls && functionCalls.length > 0) {
    const fc = functionCalls[0]
    const args = fc.args as any
    const { date, description, project_id, lines } = args

    let toolResponse: any
    let preview: any = null
    let journalId: string | null = null
    let journalNo: number | null = null

    if (fc.name === 'preview_journal') {
      preview = { date, description: description ?? null, project_id: project_id ?? null, project_code: projectMap[project_id] ?? null, lines }
      toolResponse = { success: true, message: '미리보기가 준비되었습니다.' }
    } else if (fc.name === 'create_journal') {
      // 서버 검증
      const totalDebit  = (lines as any[]).reduce((s: number, l: any) => s + (Number(l.debit)  || 0), 0)
      const totalCredit = (lines as any[]).reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0)
      if (!project_id) {
        toolResponse = { success: false, error: '프로젝트가 지정되지 않았습니다.' }
      } else if (!description?.trim()) {
        toolResponse = { success: false, error: '대표적요가 없습니다.' }
      } else if ((lines as any[]).some((l: any) => !l.counterparty_name?.trim())) {
        toolResponse = { success: false, error: '거래처가 비어 있는 라인이 있습니다.' }
      } else if (totalDebit !== totalCredit) {
        toolResponse = { success: false, error: `차변(${totalDebit.toLocaleString()}) ≠ 대변(${totalCredit.toLocaleString()}) — 금액을 다시 확인해 주세요.` }
      }

      if (toolResponse) {
        // validation 실패 → Gemini에게 알리고 재질문 유도
        const nextContents = [
          ...history,
          { role: 'model', parts: [{ functionCall: { name: fc.name, args: fc.args } }] },
          { role: 'user', parts: [{ functionResponse: { name: fc.name, response: toolResponse } }] },
        ]
        let result2
        try { result2 = await model.generateContent({ contents: nextContents }) }
        catch (e: any) { return NextResponse.json({ message: e.message }, { status: 500 }) }
        const finalText = result2.response.text()
        return NextResponse.json({
          text: finalText,
          history: [...nextContents, { role: 'model', parts: [{ text: finalText }] }],
          preview: null, journalId: null, journalNo: null,
        })
      }

      const { data: journal, error: je } = await (supabase as any)
        .from('journals')
        .insert({
          journal_no: nextNo,
          date,
          project_id: project_id || null,
          description: description || null,
        })
        .select('id')
        .single()

      if (je) {
        toolResponse = { success: false, error: je.message }
      } else {
        const linesPayload = (lines as any[]).map((l: any) => {
          const acc = accountMap[l.account_id] as any
          return {
            journal_id: journal.id,
            account_id: l.account_id,
            classification: l.classification,
            activity_type: acc?.activity_type ?? l.classification.split(' - ')[0],
            activity_subtype: l.classification.split(' - ')[1] ?? '',
            debit: l.debit || 0,
            credit: l.credit || 0,
            counterparty_name: l.counterparty_name || null,
            note: l.note || null,
            date,
          }
        })

        const { error: le } = await (supabase as any).from('journal_lines').insert(linesPayload)
        if (le) {
          await supabase.from('journals').delete().eq('id', journal.id)
          toolResponse = { success: false, error: le.message }
        } else {
          journalId = journal.id
          journalNo = nextNo
          preview = { date, description: description ?? null, project_id: project_id ?? null, project_code: projectMap[project_id] ?? null, lines }
          toolResponse = { success: true, journal_no: nextNo, message: `전표 #${nextNo} 발행 완료` }
        }
      }
    }

    let result2
    const nextContents = [
      ...history,
      { role: 'model', parts: [{ functionCall: { name: fc.name, args: fc.args } }] },
      { role: 'user', parts: [{ functionResponse: { name: fc.name, response: toolResponse } }] },
    ]
    try {
      result2 = await model.generateContent({ contents: nextContents })
    } catch (e: any) {
      return NextResponse.json({ message: e.message ?? '오류' }, { status: 500 })
    }
    const finalText = result2.response.text()

    return NextResponse.json({
      text: finalText,
      history: [...nextContents, { role: 'model', parts: [{ text: finalText }] }],
      preview,
      journalId,
      journalNo,
    })
  }

  const text = response.text()
  return NextResponse.json({
    text,
    history: [...history, { role: 'model', parts: [{ text }] }],
    preview: null,
    journalId: null,
    journalNo: null,
  })
}
