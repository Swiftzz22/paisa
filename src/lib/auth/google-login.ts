import "server-only";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/**
 * Google OAuth, LOGIN flavour. Distinct from src/lib/email/google-oauth.ts
 * (which requests the sensitive gmail.readonly scope for ingestion):
 *
 *  - Only basic identity scopes (openid email profile) → NON-sensitive, so
 *    no "unverified app" warning and no 7-day refresh-token expiry.
 *  - access_type "online" — login doesn't need a refresh token, just a
 *    one-time identity check.
 *  - Its own redirect URI so the two flows don't collide.
 */

const LOGIN_SCOPES = ["openid", "email", "profile"];

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

export function isLoginConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_LOGIN_REDIRECT_URI
  );
}

function loginClient(): OAuth2Client {
  return new google.auth.OAuth2({
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: env("GOOGLE_LOGIN_REDIRECT_URI"),
  });
}

export function buildLoginUrl(state: string): string {
  return loginClient().generateAuthUrl({
    access_type: "online",
    scope: LOGIN_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export type GoogleIdentity = {
  sub: string; // stable Google subject id
  email: string;
  name: string | null;
  image: string | null;
};

/** Exchange the login code for the user's Google identity. */
export async function exchangeLoginCode(code: string): Promise<GoogleIdentity> {
  const client = loginClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token at login.");
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();
  const { id, email, name, picture } = profile.data;
  if (!id || !email) {
    throw new Error("Google login did not return an id/email.");
  }
  return {
    sub: id,
    email,
    name: name ?? null,
    image: picture ?? null,
  };
}
