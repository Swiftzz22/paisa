import "server-only";
import { prisma } from "@/lib/prisma";
import { seedDefaultsForUser } from "@/lib/onboarding";
import type { GoogleIdentity } from "@/lib/auth/google-login";

const LEGACY_LOCAL_EMAIL = "me@local";

/**
 * Map a verified Google identity to a User row, in priority order:
 *
 *  1. Returning user — matched by googleSub. Refresh name/image, done.
 *  2. Email match — a user with this email exists but no googleSub yet
 *     (e.g. the legacy account was named with the real email). Link it.
 *  3. First-login claim — nobody has linked a Google account yet AND the
 *     seeded `me@local` user still exists. Claim it: rename its email to the
 *     real one and attach the Google identity. This carries ALL existing
 *     transactions/categories/etc. over to Sania's real login instead of
 *     orphaning months of data behind an unreachable local account.
 *  4. Brand-new user — create the row and seed default categories + modes.
 *
 * The guard in step 3 (`googleLinkedCount === 0`) ensures only the very first
 * sign-in claims the seed data; a second, different Google user gets a fresh
 * isolated account.
 */
export async function resolveUserForLogin(identity: GoogleIdentity): Promise<{
  id: string;
  isNew: boolean;
}> {
  // 1. Returning user by stable subject id.
  const bySub = await prisma.user.findUnique({
    where: { googleSub: identity.sub },
  });
  if (bySub) {
    await prisma.user.update({
      where: { id: bySub.id },
      data: { name: identity.name, image: identity.image },
    });
    return { id: bySub.id, isNew: false };
  }

  // 2. Existing user with the same email but not yet linked to Google.
  const byEmail = await prisma.user.findUnique({
    where: { email: identity.email },
  });
  if (byEmail && !byEmail.googleSub) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        googleSub: identity.sub,
        name: identity.name,
        image: identity.image,
      },
    });
    return { id: byEmail.id, isNew: false };
  }

  // 3. First-login claim of the legacy seed user.
  const googleLinkedCount = await prisma.user.count({
    where: { googleSub: { not: null } },
  });
  if (googleLinkedCount === 0) {
    const legacy = await prisma.user.findUnique({
      where: { email: LEGACY_LOCAL_EMAIL },
    });
    if (legacy && !legacy.googleSub) {
      await prisma.user.update({
        where: { id: legacy.id },
        data: {
          email: identity.email,
          googleSub: identity.sub,
          name: identity.name,
          image: identity.image,
        },
      });
      return { id: legacy.id, isNew: false };
    }
  }

  // 4. Brand-new user.
  const created = await prisma.user.create({
    data: {
      email: identity.email,
      googleSub: identity.sub,
      name: identity.name,
      image: identity.image,
    },
  });
  await seedDefaultsForUser(created.id);
  return { id: created.id, isNew: true };
}
