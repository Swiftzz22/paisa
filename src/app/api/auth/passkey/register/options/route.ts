import { NextRequest } from "next/server";
import {
  generateRegistrationOptions,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getRpConfig, setChallenge } from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Registration options for adding a passkey to the signed-in account. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const rp = getRpConfig(req.headers.get("host") || "localhost");
  // Unrecognised host: refuse rather than trust whatever was claimed.
  if (!rp) return Response.json({ error: "Unknown host" }, { status: 400 });
  const { rpID, rpName } = rp;
  const existing = await prisma.passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports
        ? (p.transports.split(",") as AuthenticatorTransportFuture[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred", // discoverable → usernameless sign-in later
      userVerification: "preferred",
    },
  });

  await setChallenge(options.challenge);
  return Response.json(options);
}
