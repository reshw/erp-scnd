import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// 서버 전용 - service role key 사용 (RLS 우회)
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
