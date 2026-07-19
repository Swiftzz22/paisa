import { NextRequest } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getRpConfig, takeChallenge } from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Verify a registration attestation and store the passkey for this user. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Bad request." }, { status: 400 });

  const challenge = await takeChallenge();
  if (!challenge) {
    return Response.json(
      { error: "Challenge expired — start again." },
      { status: 400 }
    );
  }

  const { rpID, origin } = getRpConfig(req.headers.get("host") || "localhost");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Verification failed." },
      { status: 400 }
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "Could not verify passkey." }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  try {
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports?.join(",") ?? null,
      },
    });
  } catch {
    // Unique-constraint hit → this passkey is already registered.
    return Response.json(
      { error: "That passkey is already registered." },
      { status: 409 }
    );
  }

  return Response.json({ verified: true });
}
