import { Client } from 'pg'

/**
 * Supabase pooler에 postgres(슈퍼유저급) role로 직접 접속 — CREATE ROLE/ALTER ROLE/GRANT 등
 * Supabase JS 클라이언트로는 못 하는 DDL 전용. staff-access 관리 API에서만 쓴다.
 */
export async function withPoolerAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: 'aws-1-ap-northeast-2.pooler.supabase.com',
    port: 5432,
    user: 'postgres.cyblyfitotnnwzfndpfx',
    password: process.env.SUPABASE_DB_PW,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Postgres 식별자로 안전한지 검증(영문 소문자/숫자/언더스코어, 첫글자는 영문) */
export function isValidRoleName(name: string): boolean {
  return /^[a-z][a-z0-9_]{2,62}$/.test(name)
}
