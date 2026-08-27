"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/user";
import { deleteAccount } from "@/lib/account";

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/**
 * Permanently delete the signed-in account. Apple requires this to be reachable
 * in-app for any app with accounts, and it has to actually delete rather than
 * deactivate.
 *
 * The typed email is a deliberate speed bump: there is no undo, and no backup
 * to restore from.
 */
export async function deleteAccountAction(form: FormData) {
  const user = await getCurrentUser();
  const typed = String(form.get("confirmEmail") ?? "").trim().toLowerCase();

  if (typed !== user.email.toLowerCase()) {
    redirect("/settings/delete-account?error=mismatch");
  }

  await deleteAccount(user.id);
  await destroySession();
  redirect("/login?deleted=1");
}
