"use server";

import { getCurrentUser } from "@/lib/user";
import { createMobileToken } from "@/lib/auth/mobile";

/** Mint a mobile access token for the signed-in user (pasted into the app). */
export async function createMobileTokenAction(): Promise<{ token: string }> {
  const user = await getCurrentUser();
  const token = await createMobileToken(user.id);
  return { token };
}
