import { NextResponse, type NextRequest } from "next/server";
import { BRAND } from "./app/_brand/brand";

// Dummy session gate: the login page sets this cookie. Replace with Supabase auth later.
const SESSION_COOKIE = BRAND.sessionCookie;

export function middleware(request: NextRequest) {
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard") && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/login"] };
