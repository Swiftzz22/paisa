import { NextRequest } from "next/server";
import {
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/session";
import { getRpConfig, takeChallenge } from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Verify a passkey assertion, then create a login session for its owner. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return Response.json({ error: "Bad request." }, { status: 400 });

  const challenge = await takeChallenge();
  if (!challenge) {
    return Response.json(
      { error: "Challenge expired — try again." },
      { status: 400 }
    );
  }

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: body.id },
  });
  if (!passkey) {
    return Response.json({ error: "Unrecognized passkey." }, { status: 400 });
  }

  const { rpID, origin } = getRpConfig(req.headers.get("host") || "localhost");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports
          ? (passkey.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Verification failed." },
      { status: 400 }
    );
  }

  if (!verification.verified) {
    return Response.json({ error: "Passkey did not verify." }, { status: 400 });
  }

  // Bump the signature counter (replay protection).
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: verification.authenticationInfo.newCounter },
  });

  await createSession(passkey.userId);
  return Response.json({ verified: true });
}
