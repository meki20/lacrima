import { NextResponse, type NextRequest } from "next/server";

const PROFILE_COOKIE = "lacrima_profile";

/** A browser without a selected profile always starts at the household picker. */
export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname !== "/profiles" &&
    !request.cookies.has(PROFILE_COOKIE)
  ) {
    return NextResponse.redirect(new URL("/profiles", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|.*\\..*).*)",
};
