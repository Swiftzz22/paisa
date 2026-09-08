import { NextRequest } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/auth/mobile";
import { deleteAccount } from "@/lib/account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  /**
   * The account's own email address, typed by the user. Deleting is permanent
   * and there is no undo, so it takes more than one mistaken tap — and typing
   * the address proves they know which account they are erasing.
   */
  confirmEmail: z.string().min(3).max(320),
});

/**
 * An address this app invented, not one anybody has.
 *
 * Sign in with Apple through Hide My Email gives us no usable address, so the
 * account gets a generated placeholder. Asking someone to type
 * `apple_0004899ec30a43187a44dc91232871dd@appleid.local` to confirm a deletion
 * is asking for something they have never seen and could not reproduce — the
 * confirmation stops being a safeguard and becomes a locked door.
 */
function isPlaceholderEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@appleid.local");
}

/** Permanently delete the signed-in account. Required by App Store rules. */
export async function DELETE(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Type your email address to confirm." },
      { status: 400 }
    );
  }

  const typed = parsed.data.confirmEmail.trim().toLowerCase();
  const expected = user.email.toLowerCase();
  // On a placeholder account the word DELETE is the confirmation, since there
  // is no address to know. The real address is still accepted, so anyone who
  // does have it — from this screen, say — is not turned away.
  const ok = isPlaceholderEmail(expected)
    ? typed === "delete" || typed === expected
    : typed === expected;
  if (!ok) {
    return Response.json(
      {
        error: isPlaceholderEmail(expected)
          ? "Type DELETE to confirm."
          : "That doesn't match the email on this account.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await deleteAccount(user.id);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[mobile/account] delete failed:", e);
    // Nothing was deleted — the whole thing runs in one transaction.
    return Response.json(
      { error: "Couldn't delete the account. Nothing was removed; try again." },
      { status: 500 }
    );
  }
}
