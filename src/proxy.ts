import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/api/auth') && !request.nextUrl.pathname.startsWith('/api/timetable') && !request.nextUrl.pathname.startsWith('/api/loans/auto-execute')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 직원(employee) 계정은 /staff 밖의 모든 경로를 차단 — 화이트리스트 = 기본 차단.
  // 기존 20여 개 회사 전체 재무 화면에 필터를 덧대는 방식은 하나라도 빠뜨리면 다른
  // 프로젝트 데이터가 새는 위험이 있어 채택하지 않음(docs/decisions.md 참조).
  const path = request.nextUrl.pathname
  const isEmployee = user?.app_metadata?.role === 'employee'
  // startsWith('/staff')만 쓰면 '/staff-access'(관리자 전용)까지 통과해버리므로
  // 정확히 '/staff' 자신이거나 '/staff/'로 시작하는 하위 경로만 허용한다.
  const employeeAllowed =
    path === '/staff' ||
    path.startsWith('/staff/') ||
    path.startsWith('/login') ||
    path.startsWith('/api/auth')

  if (isEmployee && !employeeAllowed) {
    return NextResponse.redirect(new URL('/staff', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
