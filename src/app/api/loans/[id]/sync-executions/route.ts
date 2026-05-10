import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { syncLoanExecutions } from '@/lib/loans/syncExecutions'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const result = await syncLoanExecutions(supabase, id)
  return NextResponse.json({ ok: true, ...result })
}
