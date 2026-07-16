import { createAdminClient } from '@/lib/supabase/admin'
import type { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'

// ─────────────────────────────────────────────────────────────
// 부가세 신고용 엑셀 다운로드
// GET /api/vat/export?start=YYYY-MM-DD&end=YYYY-MM-DD
// 시트1: 부가세신고 갑지(요약) / 시트2: 매입매출 명세 / 시트3: 증빙 SQL
// ─────────────────────────────────────────────────────────────

const VAT_SALES_ACCOUNT    = '부가세예수금'
const VAT_PURCHASE_ACCOUNT = '부가세대급금'

type LineRow = {
  debit: number
  credit: number
  counterparty_name: string | null
  note: string | null
  accounts: { name: string; activity_type: string } | null
}

type JournalRow = {
  id: string
  journal_no: number
  date: string
  description: string | null
  journal_lines: LineRow[]
}

type VatRow = {
  date: string
  journalNo: number
  description: string
  counterparty: string
  accountNames: string
  supply: number   // 공급가액
  vat: number      // 부가세
}

// 직전 반기(부가세 과세기간) 기본값: 7~12월이면 당해 1기(1/1~6/30), 1~6월이면 전년 2기(7/1~12/31)
function defaultPeriod(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  if (now.getMonth() + 1 >= 7) return { start: `${y}-01-01`, end: `${y}-06-30` }
  return { start: `${y - 1}-07-01`, end: `${y - 1}-12-31` }
}

type EntityInfo = {
  id: string
  name: string
  business_no: string | null
  biz_type: string | null
  biz_item: string | null
}

async function fetchEntity(entityId: string): Promise<EntityInfo | null> {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('entities')
    .select('id, name, business_no, biz_type, biz_item')
    .eq('id', entityId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// 사업자에 속한 프로젝트 id 목록 (사업자 필터용)
async function fetchProjectIdsByEntity(entityId: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('projects')
    .select('id')
    .eq('entity_id', entityId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((p: { id: string }) => p.id)
}

async function fetchJournals(start: string, end: string, projectIds: string[] | null): Promise<JournalRow[]> {
  const supabase = createAdminClient()
  const all: JournalRow[] = []
  const PAGE = 500

  for (let from = 0; ; from += PAGE) {
    let query = (supabase as any)
      .from('journals')
      .select(`
        id, journal_no, date, description,
        journal_lines ( debit, credit, counterparty_name, note, accounts ( name, activity_type ) )
      `)
      .eq('is_cancelled', false)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
      .order('journal_no', { ascending: true })
      .range(from, from + PAGE - 1)

    if (projectIds) query = query.in('project_id', projectIds)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return all
}

// 전표 하나에서 부가세 라인과 상대(공급가액) 라인을 분리해 한 행으로 매핑
function extractRows(journals: JournalRow[]) {
  const sales: VatRow[] = []
  const purchases: VatRow[] = []

  for (const j of journals) {
    const lines = j.journal_lines ?? []

    const salesVatLines    = lines.filter(l => l.accounts?.name === VAT_SALES_ACCOUNT)
    const purchaseVatLines = lines.filter(l => l.accounts?.name === VAT_PURCHASE_ACCOUNT)

    // 상대 라인: 부가세/현금 계정 제외 (보통예금 등 결제 라인은 공급가액이 아님)
    // 공급가액은 부가세 라인과 같은 방향의 라인만 집계한다.
    // (선급금·미지급금 등 반대편 정산 라인이 공급가액을 깎아먹지 않도록)
    const counterpartLines = lines.filter(l =>
      l.accounts &&
      l.accounts.name !== VAT_SALES_ACCOUNT &&
      l.accounts.name !== VAT_PURCHASE_ACCOUNT &&
      l.accounts.activity_type !== '현금'
    )

    const counterparty =
      counterpartLines.find(l => l.counterparty_name)?.counterparty_name ??
      lines.find(l => l.counterparty_name)?.counterparty_name ?? ''

    const description = j.description ?? counterpartLines.find(l => l.note)?.note ?? ''

    // ── 매출: 부가세예수금 (대변 발생) ──
    if (salesVatLines.length > 0) {
      const vat = salesVatLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0)
      // 공급가액: 부가세와 같은 방향(대변) 라인만. 취소전표(부가세 차변)는 차변 라인을 음수로.
      const used = counterpartLines.filter(l => (vat >= 0 ? Number(l.credit) : Number(l.debit)) > 0)
      const supply = used.reduce(
        (s, l) => s + (vat >= 0 ? Number(l.credit) : -Number(l.debit)), 0)
      // 부가세 납부 전표(예수금 차변 + 보통예금)처럼 상대 매출 라인이 없으면 제외
      if (supply !== 0) {
        sales.push({
          date: j.date, journalNo: j.journal_no, description, counterparty,
          accountNames: [...new Set(used.map(l => l.accounts!.name))].join(', '),
          supply, vat,
        })
      }
    }

    // ── 매입: 부가세대급금 (차변 발생) ──
    if (purchaseVatLines.length > 0) {
      const vat = purchaseVatLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)
      // 공급가액: 부가세와 같은 방향(차변) 라인만. 취소전표(부가세 대변)는 대변 라인을 음수로.
      const used = counterpartLines.filter(l => (vat >= 0 ? Number(l.debit) : Number(l.credit)) > 0)
      const supply = used.reduce(
        (s, l) => s + (vat >= 0 ? Number(l.debit) : -Number(l.credit)), 0)
      // 부가세 환급 전표(대급금 대변 + 보통예금)처럼 상대 비용 라인이 없으면 제외
      if (supply !== 0) {
        purchases.push({
          date: j.date, journalNo: j.journal_no, description, counterparty,
          accountNames: [...new Set(used.map(l => l.accounts!.name))].join(', '),
          supply, vat,
        })
      }
    }
  }
  return { sales, purchases }
}

// ─────────────────────────────────────────────────────────────
// 엑셀 스타일 헬퍼
// ─────────────────────────────────────────────────────────────
const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
}

function styleHeaderRow(row: ExcelJS.Row, color = 'FFD9E1F2') {
  row.eachCell(cell => {
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
    cell.border = thinBorder
  })
}

const NUM_FMT = '#,##0'

function buildSummarySheet(
  wb: ExcelJS.Workbook, start: string, end: string,
  sales: VatRow[], purchases: VatRow[],
  entity: EntityInfo | null,
) {
  const ws = wb.addWorksheet('부가세신고 갑지')
  ws.columns = [
    { width: 22 }, { width: 20 }, { width: 20 }, { width: 20 },
  ]

  const title = ws.getCell('A1')
  title.value = '부가가치세 신고 요약 (갑지)'
  title.font = { bold: true, size: 16 }
  ws.mergeCells('A1:D1')
  title.alignment = { horizontal: 'center' }

  let rowIdx = 2
  const infoRow = (label: string, value: string) => {
    ws.getCell(`A${rowIdx}`).value = label
    ws.getCell(`A${rowIdx}`).font = { bold: true }
    ws.getCell(`B${rowIdx}`).value = value
    ws.mergeCells(`B${rowIdx}:D${rowIdx}`)
    rowIdx++
  }

  infoRow('과세기간', `${start} ~ ${end}`)
  if (entity) {
    infoRow('상호',          entity.name)
    infoRow('사업자등록번호', entity.business_no ?? '-')
    infoRow('업태 / 종목',   `${entity.biz_type ?? '-'} / ${entity.biz_item ?? '-'}`)
  } else {
    infoRow('사업자', '전체 사업자 통합')
  }

  const salesSupply    = sales.reduce((s, r) => s + r.supply, 0)
  const salesVat       = sales.reduce((s, r) => s + r.vat, 0)
  const purchaseSupply = purchases.reduce((s, r) => s + r.supply, 0)
  const purchaseVat    = purchases.reduce((s, r) => s + r.vat, 0)
  const netVat         = salesVat - purchaseVat

  ws.addRow([])
  const header = ws.addRow(['구분', '공급가액', '세액', '건수'])
  styleHeaderRow(header)

  const rows = [
    ['매출 (부가세예수금)', salesSupply, salesVat, sales.length],
    ['매입 (부가세대급금)', purchaseSupply, purchaseVat, purchases.length],
  ]
  for (const r of rows) {
    const row = ws.addRow(r)
    row.eachCell((cell, col) => {
      cell.border = thinBorder
      if (col >= 2) cell.numFmt = NUM_FMT
    })
  }

  const netRow = ws.addRow([
    netVat >= 0 ? '납부할 세액 (매출세액 - 매입세액)' : '환급받을 세액 (매입세액 - 매출세액)',
    '', Math.abs(netVat), '',
  ])
  netRow.eachCell((cell, col) => {
    cell.border = thinBorder
    cell.font = { bold: true }
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: netVat >= 0 ? 'FFFCE4D6' : 'FFE2EFDA' },
    }
    if (col === 3) cell.numFmt = NUM_FMT
  })

  ws.addRow([])
  const bankLabel = ws.addRow(['환급 계좌 (은행/계좌번호)', ''])
  bankLabel.getCell(1).font = { bold: true }
  bankLabel.getCell(1).border = thinBorder
  ws.mergeCells(`B${bankLabel.number}:D${bankLabel.number}`)
  bankLabel.getCell(2).border = thinBorder

  ws.addRow([])
  const note = ws.addRow(['※ 취소전표(is_cancelled) 제외. 부가세 계정이 없는 면세·해외결제 지출은 매입세액에서 자동 제외됩니다.'])
  note.getCell(1).font = { size: 9, color: { argb: 'FF808080' } }
}

function buildDetailSheet(wb: ExcelJS.Workbook, sales: VatRow[], purchases: VatRow[]) {
  const ws = wb.addWorksheet('부가세 매입매출 명세')
  ws.columns = [
    { width: 8 },  { width: 12 }, { width: 10 }, { width: 32 },
    { width: 18 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 14 },
  ]

  const header = ws.addRow([
    '구분', '거래일자', '전표번호', '적요', '거래처명', '계정과목', '공급가액', '부가세', '합계',
  ])
  styleHeaderRow(header)
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const addRows = (label: string, rows: VatRow[], color: string) => {
    for (const r of rows) {
      const row = ws.addRow([
        label, r.date, r.journalNo, r.description, r.counterparty,
        r.accountNames, r.supply, r.vat, r.supply + r.vat,
      ])
      row.eachCell((cell, col) => {
        cell.border = thinBorder
        if (col >= 7) cell.numFmt = NUM_FMT
      })
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
    }
    if (rows.length > 0) {
      const sum = ws.addRow([
        `${label} 합계`, '', '', '', '', '',
        rows.reduce((s, r) => s + r.supply, 0),
        rows.reduce((s, r) => s + r.vat, 0),
        rows.reduce((s, r) => s + r.supply + r.vat, 0),
      ])
      sum.eachCell((cell, col) => {
        cell.border = thinBorder
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
        if (col >= 7) cell.numFmt = NUM_FMT
      })
    }
  }

  addRows('매출', sales, 'FFE2EFDA')
  ws.addRow([])
  addRows('매입', purchases, 'FFFCE4D6')
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const def = defaultPeriod()
    const start = sp.get('start') || def.start
    const end   = sp.get('end')   || def.end

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return Response.json({ message: '날짜 형식은 YYYY-MM-DD 입니다.' }, { status: 400 })
    }

    const entityId = sp.get('entity_id') || null
    const [entity, projectIds] = entityId
      ? await Promise.all([fetchEntity(entityId), fetchProjectIdsByEntity(entityId)])
      : [null, null]

    if (entityId && projectIds!.length === 0) {
      return Response.json({ message: '해당 사업자에 매칭된 프로젝트가 없습니다.' }, { status: 400 })
    }

    const journals = await fetchJournals(start, end, projectIds)
    const { sales, purchases } = extractRows(journals)

    const wb = new ExcelJS.Workbook()
    wb.creator = 'ERP'
    wb.created = new Date()

    buildSummarySheet(wb, start, end, sales, purchases, entity)
    buildDetailSheet(wb, sales, purchases)

    const buffer = await wb.xlsx.writeBuffer()
    const filename = entity
      ? `부가세신고_${entity.name}_${start}_${end}.xlsx`
      : `부가세신고_${start}_${end}.xlsx`

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : '엑셀 생성 실패' },
      { status: 500 },
    )
  }
}
