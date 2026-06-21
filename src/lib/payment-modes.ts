import "server-only";
import { prisma } from "@/lib/prisma";

export type PaymentModeOption = {
  id: string;
  value: string;
  label: string;
  builtin: boolean;
  archived: boolean;
};

export async function getActivePaymentModes(
  userId: string
): Promise<PaymentModeOption[]> {
  const modes = await prisma.paymentMode.findMany({
    where: { userId, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return modes.map((m) => ({
    id: m.id,
    value: m.value,
    label: m.label,
    builtin: m.builtin,
    archived: m.archived,
  }));
}

export async function getAllPaymentModes(
  userId: string
): Promise<PaymentModeOption[]> {
  const modes = await prisma.paymentMode.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return modes.map((m) => ({
    id: m.id,
    value: m.value,
    label: m.label,
    builtin: m.builtin,
    archived: m.archived,
  }));
}

/** Look up a label for a payment mode value (used in lists / banners). */
export async function paymentModeLabelFor(
  userId: string,
  value: string
): Promise<string> {
  const mode = await prisma.paymentMode.findFirst({
    where: { userId, value },
  });
  if (mode) return mode.label;
  // Fall back to a humanized form of the value.
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizePaymentValue(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
