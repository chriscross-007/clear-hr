import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.

  // IMPORTANT: DO NOT REPLACE getClaims() with getUser(). getClaims() reads
  // from the JWT directly, which is sufficient for session refresh. getUser()
  // sends a request to Supabase Auth server every time, which is slow and
  // unnecessary in middleware.

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // Routes that should never trigger the org-setup redirect
  const skipOrgCheck = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/logout",
    "/auth/callback",
    "/organisation-setup",
    "/accept-invite",
  ];

  const pathname = request.nextUrl.pathname;
  const isSkipped = skipOrgCheck.some((route) => pathname.startsWith(route));

  // If user is authenticated and not on a skipped route, check org membership
  if (claims?.sub && !isSkipped) {
    const { data: membership } = await supabase
      .from("members")
      .select("id")
      .eq("user_id", claims.sub)
      .limit(1)
      .maybeSingle();

    if (!membership) {
      const url = request.nextUrl.clone();
      url.pathname = "/organisation-setup";
      const redirectResponse = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }

    // Authenticated user with org on landing page → redirect to /employees
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/employees";
      const redirectResponse = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make
  // sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
