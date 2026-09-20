import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { seedDefaultsForUser } from "@/lib/onboarding";
import type { AppleIdentity } from "@/lib/auth/apple-login";

/**
 * Turn an Apple identity into a user.
 *
 * `sub` first, always. After that there is one narrow case where email is a
 * sound way to recognise someone, and it is worth taking, because the
 * alternative is that everyone who has ever used paisa. gets a stranger's
 * empty account the first time they tap Sign in with Apple.
 *
 * The case is: Apple says the address is real (not a relay) and that it
 * verified it, and the account that holds that address signed up with Google,
 * which also verified it. Both sides are then an independent proof of control
 * of the same mailbox. To hold alice@gmail.com on an Apple ID you must answer
 * a code Apple sends to alice@gmail.com, so an attacker who cannot read that
 * mailbox cannot arrive here.
 *
 * Every condition is load-bearing and none may be relaxed alone:
 *
 * - `isPrivateEmail === false`, explicitly — a relay address is verified too
 *   (Apple checks deliverability of relays), so verification alone proves
 *   nothing. `null` means Apple omitted the claim and is not good enough.
 * - `emailVerified` — an unverified address is a claim, not a proof.
 * - the existing account has a `googleSub` — its address was verified by
 *   Google rather than typed in. Nothing else in this app vouches for one.
 * - the existing account has no `appleSub` — it belongs to another Apple ID
 *   already, and this is not a place to overrule that.
 *
 * Anything short of all four still becomes a new account, and joining it to an
 * existing one stays a deliberate action taken while signed in — see
 * linkAppleToUser, where consent is explicit.
 */

/** Trim and bound a client-supplied name; Apple never sees or vouches for it. */
function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Drop control characters by code point rather than with a literal character
  // class — this string is displayed, and it arrives unauthenticated from the
  // device rather than from Apple, so it gets sanitised before storage.
  const stripped = Array.from(raw)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
    .join("");
  const cleaned = stripped.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 120);
}

/**
 * A placeholder address for relay users, so `User.email` stays unique and
 * meaningful-looking without pretending a relay address is a contact address.
 */
function fallbackEmail(sub: string): string {
  return `apple_${sub.replace(/[^A-Za-z0-9]/g, "").slice(0, 32)}@appleid.local`;
}

export async function resolveUserForAppleLogin(
  identity: AppleIdentity,
  fullName?: string | null,
  refreshToken?: string | null
): Promise<{ id: string; isNew: boolean }> {
  const encRefresh = refreshToken ? encrypt(refreshToken) : null;

  // 1. Known Apple identity.
  const bySub = await prisma.user.findUnique({
    where: { appleSub: identity.sub },
    select: { id: true, name: true },
  });
  if (bySub) {
    const name = cleanName(fullName);
    await prisma.user.update({
      where: { id: bySub.id },
      data: {
        // Apple only sends the name on the very first authorization, so never
        // overwrite a stored one with nothing.
        ...(name && !bySub.name ? { name } : {}),
        ...(encRefresh ? { appleRefreshTokenEnc: encRefresh } : {}),
      },
    });
    return { id: bySub.id, isNew: false };
  }

  const usable =
    identity.email && identity.isPrivateEmail === false ? identity.email : null;

  // 2. A real, Apple-verified address that already belongs to a Google
  //    account. Both providers have proved the same mailbox, so this is the
  //    same person arriving by a second door. See the note above — all four
  //    conditions are required.
  if (usable && identity.emailVerified) {
    // Both providers hand back a lowercase address, but the column is stored
    // verbatim and SQLite compares case-sensitively, so an older row spelled
    // differently would silently miss and quietly make a second account.
    const candidates = Array.from(new Set([usable, usable.toLowerCase()]));
    const byEmail = await prisma.user.findFirst({
      where: { email: { in: candidates } },
      select: { id: true, name: true, appleSub: true, googleSub: true },
    });
    if (byEmail && byEmail.googleSub && !byEmail.appleSub) {
      const name = cleanName(fullName);
      await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          appleSub: identity.sub,
          appleLinkedAt: new Date(),
          ...(name && !byEmail.name ? { name } : {}),
          ...(encRefresh ? { appleRefreshTokenEnc: encRefresh } : {}),
        },
      });
      return { id: byEmail.id, isNew: false };
    }
  }

  // 3. Otherwise a new Apple identity is a new account.
  const email = usable ?? fallbackEmail(identity.sub);

  // Guard the placeholder against colliding with a real row.
  const taken = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  const created = await prisma.user.create({
    data: {
      email: taken ? fallbackEmail(identity.sub + Date.now()) : email,
      name: cleanName(fullName),
      appleSub: identity.sub,
      appleLinkedAt: new Date(),
      appleRefreshTokenEnc: encRefresh,
    },
  });
  await seedDefaultsForUser(created.id);
  return { id: created.id, isNew: true };
}

/**
 * Attach an Apple identity to the account already signed in.
 *
 * This is the safe half of linking: the person has proved they hold the
 * existing account before the Apple identity is joined to it, so there is no
 * path for a stranger holding a matching email to take it over.
 */
/**
 * Whether an account is nothing but the shell a first Apple sign-in left behind.
 *
 * Signing in with Apple before linking creates a fresh account, by design — but
 * that account then holds the Apple id, and linking the same Apple id to the
 * real account would be refused for the rest of time. Someone who tried Apple
 * sign-in once would be permanently unable to link it, which is a trap.
 *
 * Absorbing it is only safe when there is demonstrably nothing to lose: no
 * transactions, no other way to sign in, and no imports. Anything else is a
 * real account that happens to be small, and is never touched.
 */
async function isEmptyAppleShell(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleSub: true },
  });
  if (!user) return false;
  // Another sign-in method means someone can still get in here. Not a shell.
  if (user.googleSub) return false;

  const [txns, imports, passkeys, emailAccounts] = await Promise.all([
    prisma.transaction.count({ where: { userId } }),
    prisma.importBatch.count({ where: { userId } }),
    // A passkey is a sign-in method, and an email account is a live connection
    // someone set up — either makes this a real account, not a leftover.
    prisma.passkey.count({ where: { userId } }),
    prisma.emailAccount.count({ where: { userId } }),
  ]);
  return txns === 0 && imports === 0 && passkeys === 0 && emailAccounts === 0;
}

export async function linkAppleToUser(
  userId: string,
  identity: AppleIdentity,
  refreshToken?: string | null
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const claimed = await prisma.user.findUnique({
    where: { appleSub: identity.sub },
    select: { id: true },
  });
  if (claimed && claimed.id !== userId) {
    if (!(await isEmptyAppleShell(claimed.id))) {
      // Say what is in the way. "Already on another account" is true and
      // useless: the other account is usually one the same person made by
      // signing in with Apple once, and what they need to know is that it has
      // something in it and that deleting it is the way through.
      return {
        ok: false,
        reason:
          "That Apple ID already opens a different paisa account, and that account isn't empty. Sign in with Apple, check what's there, and delete that account from Settings if you don't need it — then link again.",
      };
    }
    // Free the Apple id from the empty shell so the link below can take it.
    // Deleted rather than just cleared: an account with no sign-in method and
    // nothing in it is unreachable, and leaving it behind serves nobody.
    await prisma.user.delete({ where: { id: claimed.id } });
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      appleSub: identity.sub,
      appleLinkedAt: new Date(),
      ...(refreshToken ? { appleRefreshTokenEnc: encrypt(refreshToken) } : {}),
    },
  });
  return { ok: true };
}
