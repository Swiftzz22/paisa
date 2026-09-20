"use server";

import { getCurrentUser } from "@/lib/user";
import { createMobileToken } from "@/lib/auth/mobile";
import { rotateInboundAddress } from "@/lib/email/inbound";

/** Mint a mobile access token for the signed-in user (pasted into the app). */
export async function createMobileTokenAction(): Promise<{ token: string }> {
  const user = await getCurrentUser();
  const token = await createMobileToken(user.id);
  return { token };
}

/**
 * Replace this account's forwarding address, revoking the old one.
 *
 * Worth having for the same reason any credential is rotatable: the address
 * ends up pasted into a filter, and sometimes into the wrong one.
 */
export async function rotateForwardingAddressAction(): Promise<{
  address: string | null;
}> {
  const user = await getCurrentUser();
  return { address: await rotateInboundAddress(user.id) };
}
