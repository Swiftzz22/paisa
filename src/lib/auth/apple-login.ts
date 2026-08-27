import "server-only";
import { timingSafeEqual } from "node:crypto";
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from "jose";

/**
 * Sign in with Apple, native flow only.
 *
 * We never do the web flow, which removes a lot: no Services ID, no registered
 * return URLs, no redirect_uri on the token exchange. `client_id` is just the
 * bundle id throughout.
 */

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys")
);

/** Bundle id doubles as client_id in the native flow. */
function clientId(): string {
  return process.env.APPLE_CLIENT_ID ?? "com.saniakothari.paisa";
}

/**
 * Apple sends `email_verified` and `is_private_email` as either booleans or the
 * strings "true"/"false" — both are intentional, per Apple's own developer
 * support. Coerce rather than compare to `true`.
 */
function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

export type AppleIdentity = {
  sub: string;
  email: string | null;
  /**
   * null when Apple omitted the claim, which is reported to happen for some
   * Hide My Email users. Absent is treated as private everywhere downstream:
   * wrongly splitting an account is recoverable, wrongly merging one is not.
   */
  isPrivateEmail: boolean | null;
  emailVerified: boolean;
};

function equalConstantTime(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify the identity token the app received from Apple.
 *
 * `expectedNonce` must be the value this server issued and stored. Apple echoes
 * the nonce back verbatim on the native flow — it does not hash it — so a
 * client-chosen nonce would prove nothing, since the client could replay its
 * own token along with its own nonce.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  expectedNonce: string
): Promise<AppleIdentity> {
  const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
    issuer: APPLE_ISSUER,
    audience: clientId(),
    // Pinned explicitly: leaving the algorithm open is the classic
    // algorithm-confusion hole.
    algorithms: ["ES256"],
    clockTolerance: 30,
    maxTokenAge: "10 minutes",
  });

  if (typeof payload.nonce !== "string") {
    throw new Error("Apple token carried no nonce.");
  }
  if (!equalConstantTime(payload.nonce, expectedNonce)) {
    throw new Error("Apple nonce did not match.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Apple token carried no subject.");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    isPrivateEmail:
      "is_private_email" in payload ? asBool(payload.is_private_email) : null,
    // Recorded, not enforced: Apple verifies deliverability for both real and
    // relay addresses, so this makes a poor gate.
    emailVerified: asBool(payload.email_verified),
  };
}

/** True when every credential needed for Apple's server endpoints is present. */
export function isAppleServerConfigured(): boolean {
  return Boolean(
    process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY_B64
  );
}

/**
 * Apple's client secret is itself a short-lived ES256 JWT.
 *
 * Minted per request rather than cached: Apple allows up to six months, and a
 * long-lived secret sitting in an env var is a silent time bomb that expires
 * on a day nobody remembers. There is nothing to rotate but the key.
 */
async function clientSecret(): Promise<string> {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const keyB64 = process.env.APPLE_PRIVATE_KEY_B64;
  if (!teamId || !keyId || !keyB64) {
    throw new Error("Apple server credentials are not configured.");
  }
  // Base64 so the PEM's newlines survive being an environment variable.
  const pem = Buffer.from(keyB64, "base64").toString("utf8");
  const key = await importPKCS8(pem, "ES256");

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId())
    .setAudience(APPLE_ISSUER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

/**
 * Trade the authorization code for a refresh token.
 *
 * Must happen during sign-in: the code is single-use and lives five minutes, so
 * there is no deferring it to the day the account is deleted — and without a
 * refresh token there is nothing to revoke, which is an App Store requirement.
 * Returns null when Apple credentials are not configured, so sign-in still
 * works before the paid account exists.
 */
export async function exchangeAppleCode(
  authorizationCode: string
): Promise<string | null> {
  if (!isAppleServerConfigured()) return null;

  const res = await fetch(`${APPLE_ISSUER}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: await clientSecret(),
      code: authorizationCode,
      grant_type: "authorization_code",
      // No redirect_uri: Apple wants it only when the authorization request
      // supplied one, and the native flow does not.
    }),
  });
  if (!res.ok) {
    throw new Error(`Apple token exchange failed (${res.status}).`);
  }
  const body = (await res.json()) as { refresh_token?: string };
  return body.refresh_token ?? null;
}

/**
 * Revoke a refresh token. Apple requires this when an account is deleted.
 * Returns 200 with no body whether it revoked something or the token was
 * already dead, so success here only means Apple accepted the request.
 */
export async function revokeAppleToken(refreshToken: string): Promise<void> {
  if (!isAppleServerConfigured()) return;

  await fetch(`${APPLE_ISSUER}/auth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: await clientSecret(),
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
}
