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

/**
 * The .p8 as a PEM, however it was pasted into the environment.
 *
 * Base64 is the documented form, because a PEM's newlines do not survive most
 * environment-variable editors. But pasting the file's contents directly is the
 * obvious thing to try, and a base64 tool that wraps its output at 64 columns
 * is equally easy to reach for — both produced a key that silently failed to
 * parse. All three shapes are accepted now.
 */
function applePem(raw: string): string {
  const trimmed = raw.trim();

  // Already a PEM: the file's contents pasted straight in.
  if (trimmed.includes("BEGIN PRIVATE KEY")) return trimmed;

  const compact = trimmed.replace(/\s+/g, "");

  // Base64 of the whole file — the documented form. Possibly wrapped at 64
  // columns by whichever tool produced it, hence stripping whitespace first.
  let decoded = "";
  try {
    decoded = Buffer.from(compact, "base64").toString("utf8");
  } catch {
    /* fall through to the bare-body case */
  }
  if (decoded.includes("BEGIN PRIVATE KEY")) return decoded;

  // Just the base64 between the header and footer, with the headers left
  // behind. Opening the .p8 and copying the block in the middle is the natural
  // thing to do, and it is still the key — so put the envelope back rather
  // than rejecting it.
  const lines = [
    "-----BEGIN PRIVATE KEY-----",
    ...(compact.match(/.{1,64}/g) ?? []),
    "-----END PRIVATE KEY-----",
    "",
  ];
  return lines.join(NEWLINE);
}

/** A PEM's line separator, kept out of the literal above so no editor or
 *  line-ending conversion can turn it into a real break. */
const NEWLINE = String.fromCharCode(10);

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
  const pem = applePem(keyB64);
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

/**
 * Check the Apple server credentials without revealing them.
 *
 * The private key is only exercised when someone signs in or deletes their
 * account, so a bad value — truncated base64, the wrong key, a stray newline —
 * stays invisible until it breaks one of those. This mints a client secret and
 * throws the result away, which proves the key decodes and signs.
 *
 * Reports presence and success only. No values, and errors are reduced to a
 * short class so nothing about the key can leak through a message.
 */
export async function checkAppleCredentials(): Promise<{
  teamId: boolean;
  keyId: boolean;
  privateKey: boolean;
  signs: boolean;
  /**
   * Whether the audience tokens are checked against is the app's bundle id.
   * A wrong APPLE_CLIENT_ID — a Services ID, say, which is what the web flow
   * would want — rejects every identity token with no clue as to why, and is
   * invisible to the signing check above because minting a client secret never
   * consults the audience.
   */
  clientIdIsBundleId: boolean;
  problem?: string;
  /** Character count only — never the value. */
  valueLength?: number;
  hint?: string;
}> {
  const present = {
    teamId: Boolean(process.env.APPLE_TEAM_ID),
    keyId: Boolean(process.env.APPLE_KEY_ID),
    privateKey: Boolean(process.env.APPLE_PRIVATE_KEY_B64),
    clientIdIsBundleId: clientId() === "com.saniakothari.paisa",
  };
  if (!present.teamId || !present.keyId || !present.privateKey) {
    return { ...present, signs: false, problem: "missing" };
  }
  try {
    await clientSecret();
    return { ...present, signs: true };
  } catch {
    // Report the shape of what is there, not its content — enough to say which
    // paste went wrong without echoing any of the key.
    const raw = (process.env.APPLE_PRIVATE_KEY_B64 ?? "").trim();
    let decoded = "";
    try {
      decoded = Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      /* handled below */
    }
    const problem = decoded.includes("BEGIN PRIVATE KEY")
      ? "key-decodes-but-apple-rejected-it"
      : decoded.includes("BEGIN")
        ? "wrong-key-type-expected-a-p8-private-key"
        : raw.includes("BEGIN")
          ? "pasted-the-pem-itself-not-base64"
          : "not-base64-of-a-p8-file";
    // Length alone separates the common mistakes: a base64'd .p8 runs to
    // several hundred characters, while the Key ID and Team ID are ten. It
    // says nothing useful about a real key — the size is fixed by the format.
    return {
      ...present,
      signs: false,
      problem,
      valueLength: raw.length,
      hint:
        raw.length <= 20
          ? "too short to be a key — this looks like a Key ID or Team ID pasted into the wrong variable"
          : raw.length < 200
            ? "shorter than a .p8 — the value may have been truncated when pasted"
            : "right sort of length, but not a private key file",
    };
  }
}
