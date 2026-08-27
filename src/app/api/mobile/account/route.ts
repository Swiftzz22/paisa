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
  if (typed !== user.email.toLowerCase()) {
    return Response.json(
      { error: "That doesn't match the email on this account." },
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
