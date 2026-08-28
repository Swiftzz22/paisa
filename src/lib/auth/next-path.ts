/**
 * Where to land after a successful sign-in.
 *
 * Only same-site absolute paths are allowed. Anything else — a full URL, a
 * protocol-relative "//evil.com", a backslash that some browsers normalise to
 * a slash — would turn our own login into an open redirect, which is a
 * ready-made phishing step: the link genuinely starts at paisa.
 *
 * Lives here rather than in the login route because a route module should
 * export only its handlers; Next validates that.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (raw.includes("://")) return null;
  return raw;
}
