import "server-only";
import { cookies } from "next/headers";

/**
 * WebAuthn relying-party config for a request.
 *
 * The host header is attacker-controllable, and taking rpID straight from it
 * meant the server would validate an assertion against whatever origin the
 * caller claimed — throwing away the server's half of origin binding. Only
 * hosts we recognise are accepted now: localhost for development, plus
 * whatever APP_ORIGIN names in production.
 *
 * Returns null for an unrecognised host so callers can refuse the request.
 */
export function getRpConfig(host: string): {
  rpID: string;
  origin: string;
  rpName: string;
} | null {
  const rpID = host.split(":")[0];
  const isLocal = rpID === "localhost" || rpID === "127.0.0.1";
  if (isLocal) {
    return { rpID, origin: `http://${host}`, rpName: "paisa" };
  }

  const configured = process.env.APP_ORIGIN;
  if (configured) {
    const allowed = new URL(configured).hostname;
    if (rpID !== allowed) return null;
    return { rpID, origin: `https://${host}`, rpName: "paisa" };
  }

  // No APP_ORIGIN set: fall back to trusting the host, which is how this
  // behaved before. Set APP_ORIGIN in production to close that.
  return { rpID, origin: `https://${host}`, rpName: "paisa" };
}

const CHALLENGE_COOKIE = "pk_challenge";

/** Stash the WebAuthn challenge in a short-lived httpOnly cookie until verify. */
export async function setChallenge(challenge: string): Promise<void> {
  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300, // 5 minutes
  });
}

/** Read and clear the stored challenge (single-use). */
export async function takeChallenge(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(CHALLENGE_COOKIE)?.value ?? null;
  jar.delete(CHALLENGE_COOKIE);
  return value;
}
