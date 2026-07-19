import "server-only";
import { cookies } from "next/headers";

/**
 * WebAuthn relying-party config, derived from the request host so it works on
 * localhost AND the deployed domain without extra env vars. rpID is the bare
 * hostname (no port); origin is the full scheme+host the browser will send.
 */
export function getRpConfig(host: string): {
  rpID: string;
  origin: string;
  rpName: string;
} {
  const rpID = host.split(":")[0];
  const isLocal = rpID === "localhost" || rpID === "127.0.0.1";
  return {
    rpID,
    origin: `${isLocal ? "http" : "https"}://${host}`,
    rpName: "paisa",
  };
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
