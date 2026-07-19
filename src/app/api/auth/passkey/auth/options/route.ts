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
  const { rpID } = getRpConfig(req.headers.get("host") || "localhost");
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });
  await setChallenge(options.challenge);
  return Response.json(options);
}
