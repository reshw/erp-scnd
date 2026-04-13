import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

function calcClassification(
  accountName: string,
  debit: number,
  credit: number,
  accountMeta: Record<string, { normal_side: string; increase_label: string; decrease_label: string }>
): string {
  const meta = accountMeta[accountName]
  if (!meta) return ''
  const normalIsDebit = meta.normal_side === 'debit'
  const actualIsDebit = debit > 0
  return normalIsDebit === actualIsDebit ? meta.increase_label : meta.decrease_label
}

function ok(data: object) {
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()

    // 마스터 데이터
    const [{ data: accountsRaw }, { data: projectsRaw }] = await Promise.all([
      (supabase as any).from('accounts').select('id,name,normal_side,increase_label,decrease_label') as any,
      (supabase as any).from('projects').select('id,code') as any,
    ])

    const accountMap:  Record<string, string> = {}
    const accountMeta: Record<string, { normal_side: string; increase_label: string; decrease_label: string }> = {}
    for (const a of (accountsRaw ?? [])) {
      accountMap[a.name]  = a.id
      accountMeta[a.name] = a
    }
    const projectMap: Record<string, string> = {}
    for (const p of (projectsRaw ?? [])) projectMap[p.code] = p.id

    // 파일
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return ok({ ok: 0, fail: 0, total: 0, errors: ['파일이 없습니다.'] })

    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

    // 현금출납 시트 우선, 없으면 첫 번째 시트
    const sheetName = wb.SheetNames.find(n => n.includes('현금출납')) ?? wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: null })

    if (raw.length === 0) {
      return ok({ ok: 0, fail: 0, total: 0, errors: [`시트(${sheetName})가 비어있습니다.`] })
    }

    // 실제 헤더 확인 (디버깅용)
    const headers = Object.keys(raw[0])

    // 필수 컬럼 확인
    const required = ['전표번호', '계정과목']
    const missing = required.filter(h => !headers.includes(h))
    if (missing.length > 0) {
      return ok({
        ok: 0, fail: 0, total: 0,
        errors: [`필수 컬럼 없음: ${missing.join(', ')} | 실제 헤더: ${headers.join(', ')}`],
      })
    }

    // 행 정규화
    const rows = raw
      .filter(r => r['전표번호'] != null && r['계정과목'] != null)
      .map(r => {
        let dateStr = ''
        const rawDate = r['날짜']
        if (rawDate instanceof Date) {
          dateStr = rawDate.toISOString().slice(0, 10)
        } else if (typeof rawDate === 'number') {
          // Excel 날짜 시리얼 넘버
          const d = XLSX.SSF.parse_date_code(rawDate)
          dateStr = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
        } else {
          dateStr = String(rawDate ?? '').slice(0, 10)
        }
        return {
          전표번호: Number(r['전표번호']),
          날짜:    dateStr,
          프로젝트: r['프로젝트'] ? String(r['프로젝트']).trim() : undefined,
          계정과목: String(r['계정과목']).trim(),
          차변:    Number(r['차변']  ?? 0) || 0,
          대변:    Number(r['대변']  ?? 0) || 0,
          거래처:  r['거래처'] ? String(r['거래처']).trim() : undefined,
          적요:    r['적요']   ? String(r['적요']).trim()   : undefined,
        }
      })
      .filter(r => r.전표번호 > 0 && r.날짜.length === 10)

    if (rows.length === 0) {
      return ok({
        ok: 0, fail: 0, total: 0,
        errors: [`데이터 행 없음. 헤더: ${headers.join(', ')} | 첫 행 샘플: ${JSON.stringify(raw[0])}`],
      })
    }

    // 거래처 등록
    const cpNames = [...new Set(rows.map(r => r.거래처).filter(Boolean))] as string[]
    const { data: existingCp } = await (supabase as any).from('counterparties').select('id,name') as any
    const cpMap: Record<string, string> = Object.fromEntries((existingCp ?? []).map((c: any) => [c.name, c.id]))
    const newCpNames = cpNames.filter(n => !cpMap[n])
    if (newCpNames.length > 0) {
      await (supabase as any)
        .from('counterparties').insert(newCpNames.map(n => ({ name: n }))) as any
      const { data: newCps } = await (supabase as any)
        .from('counterparties').select('id,name').in('name', newCpNames).limit(10000) as any
      for (const c of (newCps ?? [])) cpMap[c.name] = c.id
    }

    // 전표 그룹핑
    const groups = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = `${r.전표번호}__${r.날짜}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }

    const errors: string[] = []
    const groupEntries = [...groups.entries()]

    // 매칭 안 된 프로젝트 코드 경고
    const unmatchedProjects = new Set<string>()
    for (const [, lines] of groupEntries) {
      const code = lines[0].프로젝트
      if (code && !projectMap[code]) unmatchedProjects.add(code)
    }
    if (unmatchedProjects.size > 0) {
      errors.push(`프로젝트 미등록(무시됨): ${[...unmatchedProjects].join(', ')} — DB에 등록 후 재업로드 필요`)
    }

    // ── 1단계: 전표 헤더 일괄 insert ──────────────────
    const journalPayload = groupEntries.map(([, lines]) => {
      const first = lines[0]
      return {
        journal_no:  first.전표번호,
        date:        first.날짜,
        project_id:  first.프로젝트 ? (projectMap[first.프로젝트] ?? null) : null,
        description: first.적요 ?? null,
      }
    })

    const { error: je } = await (supabase as any)
      .from('journals').insert(journalPayload) as any

    if (je) {
      return ok({ ok: 0, fail: groupEntries.length, total: groupEntries.length, errors: [`전표 헤더 insert 실패: ${je.message}`] })
    }

    // insert 후 journal_no 목록으로 ID 별도 조회 (insert 반환값 100건 제한 우회)
    const journalNos = journalPayload.map(j => j.journal_no)
    const { data: insertedJournals, error: qe } = await (supabase as any)
      .from('journals').select('id, journal_no, date').in('journal_no', journalNos).limit(10000) as any

    if (qe) {
      return ok({ ok: 0, fail: groupEntries.length, total: groupEntries.length, errors: [`전표 ID 조회 실패: ${qe.message}`] })
    }

    // journal_no + date → id 매핑
    const journalIdMap: Record<string, string> = {}
    for (const j of (insertedJournals ?? [])) {
      journalIdMap[`${j.journal_no}__${j.date}`] = j.id
    }

    // ── 2단계: 전표 명세 일괄 insert ──────────────────
    const allLines: object[] = []
    const skipped: string[] = []

    for (const [key, lines] of groupEntries) {
      const journalId = journalIdMap[key]
      if (!journalId) continue

      const linePayload = lines
        .filter(l => l.차변 > 0 || l.대변 > 0)
        .map(l => {
          const cls = calcClassification(l.계정과목, l.차변, l.대변, accountMeta)
          return {
            journal_id:        journalId,
            date:              l.날짜,
            classification:    cls,
            activity_type:     cls.split(' - ')[0] ?? '',
            activity_subtype:  cls.split(' - ')[1] ?? '',
            account_id:        accountMap[l.계정과목] ?? null,
            debit:             Math.round(l.차변),
            credit:            Math.round(l.대변),
            counterparty_id:   l.거래처 ? (cpMap[l.거래처] ?? null) : null,
            counterparty_name: l.거래처 ?? null,
            note:              l.적요 ?? null,
          }
        })
        .filter(l => (l as any).account_id && (l as any).activity_type)

      if (linePayload.length === 0) {
        skipped.push(`전표 ${lines[0].전표번호}: 유효 명세 없음`)
      } else {
        allLines.push(...linePayload)
      }
    }

    const { error: le } = await (supabase as any).from('journal_lines').insert(allLines) as any
    if (le) {
      errors.push(`명세 insert 실패: ${le.message} (${le.code})`)
    }

    const okCount  = le ? 0 : (insertedJournals?.length ?? 0) - skipped.length
    const failCount = (le ? insertedJournals?.length ?? 0 : 0) + skipped.length

    return ok({ ok: okCount, fail: failCount, total: groups.size, errors: [...errors, ...skipped] })

  } catch (e: any) {
    return ok({ ok: 0, fail: 0, total: 0, errors: [`서버 오류: ${e?.message ?? String(e)}`] })
  }
}
