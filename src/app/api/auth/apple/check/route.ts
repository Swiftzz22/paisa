import { checkAppleCredentials } from "@/lib/auth/apple-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/apple/check
 *
 * Whether Sign in with Apple's server credentials are configured and usable.
 * Returns booleans and a coarse problem code — never a value, never a key.
 *
 * Exists because the private key is otherwise only exercised at sign-in and at
 * account deletion, so a wrong value stays hidden until it breaks one of them.
 */
export async function GET() {
  return Response.json(await checkAppleCredentials());
}
