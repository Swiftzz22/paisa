/**
 * Browser sessions and device tokens are both Session rows, distinguished only
 * by this prefix.
 *
 * Neither resolver used to check which kind it had been handed, so a stolen
 * browser cookie authenticated as a device and a year-long device token
 * authenticated as a browser session. Each resolver now rejects the other kind.
 *
 * Kept in its own module so session.ts and mobile.ts can both use it without
 * importing each other.
 */
export const MOBILE_TOKEN_PREFIX = "pmt_";

export function isMobileToken(token: string): boolean {
  return token.startsWith(MOBILE_TOKEN_PREFIX);
}
