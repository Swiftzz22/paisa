import "server-only";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// Scopes the app requests during OAuth consent.
// gmail.readonly = read messages (enough for our parse-and-log use case)
// openid + email + profile = learn which Gmail address the user authorized
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
  "profile",
];

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI &&
      process.env.TOKEN_ENCRYPTION_KEY
  );
}

/** Create a fresh OAuth2 client without any tokens set. */
export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2({
    clientId: getEnvOrThrow("GOOGLE_CLIENT_ID"),
    clientSecret: getEnvOrThrow("GOOGLE_CLIENT_SECRET"),
    redirectUri: getEnvOrThrow("GOOGLE_REDIRECT_URI"),
  });
}

/**
 * Build the Google consent URL.
 * `access_type=offline` + `prompt=consent` is what makes Google return a
 * refresh_token (without these, you'd only get an access token).
 */
export function buildAuthUrl(state: string): string {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange an OAuth code for tokens and learn the user's email. */
export async function exchangeCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  expiresAt: Date | null;
  scope: string;
  email: string;
}> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke the app's access at " +
        "https://myaccount.google.com/permissions and try connecting again."
    );
  }
  if (!tokens.access_token) {
    throw new Error("Google did not return an access_token.");
  }
  client.setCredentials(tokens);

  // Use the access token to fetch the authorized account's email.
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();
  const email = profile.data.email;
  if (!email) throw new Error("Could not read the Google account's email.");

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
    email,
  };
}

/** Build a logged-in OAuth client from a refresh token. */
export function makeAuthorizedClient(refreshToken: string): OAuth2Client {
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** Revoke a Google refresh token. Best-effort. */
export async function revokeToken(refreshToken: string): Promise<void> {
  const client = makeAuthorizedClient(refreshToken);
  try {
    await client.revokeToken(refreshToken);
  } catch {
    // already revoked or network issue — not actionable here
  }
}
