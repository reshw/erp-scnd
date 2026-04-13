# ERP — 복식부기 현금출납 관리 시스템

Next.js 15 + Supabase 기반의 소규모 사업체용 복식부기 ERP 시스템입니다.

## 기술 스택

- **프레임워크**: Next.js 15 (App Router)
- **데이터베이스**: Supabase (PostgreSQL)
- **UI**: Tailwind CSS + shadcn/ui
- **배포**: Vercel

## 로컬 개발

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.local` 파일 생성:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Supabase 대시보드 → Project Settings → API 에서 확인.

### 3. DB 마이그레이션

Supabase SQL Editor에서 순서대로 실행:

```
supabase/migrations/001_schema.sql
supabase/migrations/002_seed_accounts.sql
```

### 4. 개발 서버 실행

```bash
npm run dev
```

http://localhost:3000 접속

---

## Vercel 배포

### 1. Vercel CLI 또는 GitHub 연동으로 프로젝트 생성

```bash
npx vercel
```

또는 Vercel 대시보드에서 GitHub 레포지토리 연동.

### 2. 환경 변수 설정

Vercel 대시보드 → Settings → Environment Variables:

| 변수명 | 값 | 환경 |
|--------|-----|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<anon-key>` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | `<service-role-key>` | All |

> **주의**: `SUPABASE_SERVICE_ROLE_KEY`는 절대 공개 레포지토리에 커밋하지 마세요.

### 3. 배포

```bash
npx vercel --prod
```

또는 main 브랜치 push 시 자동 배포 (GitHub 연동 시).

---

## Supabase 설정

### RLS (Row Level Security)

현재 모든 테이블에 `authenticated users` 정책이 적용되어 있습니다.
Supabase Authentication을 활성화하거나, 개발/내부 용도라면 service role key를 사용하는 현재 구조를 유지해도 됩니다.

### 백업

Supabase 대시보드 → Database → Backups 에서 자동 백업 확인.

---

## 주요 기능

| 메뉴 | 기능 |
|------|------|
| 대시보드 | 프로젝트별/통장별 잔고, 무결성 검사 |
| 현금출납 | 복식부기 전표 CRUD, 엑셀 업로드 |
| 계정과목 | 계정과목 목록, 활성/비활성 토글 |
| 거래처 | 거래처 추가/수정/삭제 |
| 프로젝트 | 프로젝트 추가/수정, 활성 토글 |
| 대출 | 대출 등록, 상환 스케줄, 전표 자동 발행 |
| 월말마감 | 월별 활동구분별 현금흐름 집계 |
