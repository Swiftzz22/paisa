import { NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getRpConfig, setChallenge } from "@/lib/auth/passkey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Authentication options for signing in with a passkey. allowCredentials is
 * empty so the browser offers any discoverable passkey for this site
 * (usernameless / "just tap and use your fingerprint").
 */
export async function POST(req: NextRequest) {
  const rp = getRpConfig(req.headers.get("host") || "localhost");
  // Unrecognised host: refuse rather than trust whatever was claimed.
  if (!rp) return Response.json({ error: "Unknown host" }, { status: 400 });
  const { rpID } = rp;
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });
  await setChallenge(options.challenge);
  return Response.json(options);
}
