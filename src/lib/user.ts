import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/session";

/**
 * The logged-in user for the current request. Server components and server
 * actions call this; if there's no valid session it redirects to /login
 * (which throws, so nothing after the call runs).
 *
 * For places that must NOT redirect (e.g. JSON API routes that want to return
 * a 401), call getSessionUser() directly and handle the null case.
 */
export async function getCurrentUser() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    redirect("/login");
  }
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
  });
  if (!user) {
    // Session referenced a user that no longer exists — treat as logged out.
    redirect("/login");
  }
  return user;
}
