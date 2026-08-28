/**
 * Print the Microsoft authorize URL for testing the Entra app registration
 * by hand, before any of the OAuth code exists.
 *
 * Hand-editing this URL is error-prone: a wrapped line drops the query string
 * entirely and Microsoft answers with AADSTS900144 ("must contain the
 * parameter 'client_id'"), which reads like a registration problem but is
 * really a copy-paste problem. Building it here means the only thing to get
 * right is the client id.
 *
 *   node scripts/ms-authorize-url.mjs <client-id> [--prod]
 *
 * Defaults to the localhost redirect; --prod uses the Vercel one. Whichever
 * you pick must already be registered under the app's "Web" platform.
 */

const LOCAL_REDIRECT = "http://localhost:3000/api/auth/microsoft/callback";
const PROD_REDIRECT =
  "https://paisa-tawny.vercel.app/api/auth/microsoft/callback";

// offline_access is what makes Microsoft return a refresh token at all;
// without it the connection dies the moment the first access token expires.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
];

const args = process.argv.slice(2);
const useProd = args.includes("--prod");
const clientId = (args.find((a) => !a.startsWith("--")) ?? "").trim();

if (!clientId) {
  console.error(
    "Usage: node scripts/ms-authorize-url.mjs <client-id> [--prod]\n\n" +
      "The client id is the 'Application (client) ID' on your app\n" +
      "registration's Overview page in entra.microsoft.com."
  );
  process.exit(1);
}

// A wrong-shaped id produces a confusing Microsoft error page, so say so here
// instead. Entra client ids are GUIDs.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!GUID.test(clientId)) {
  console.error(
    `That doesn't look like a client id: ${JSON.stringify(clientId)}\n\n` +
      "It should be a GUID, e.g. 11111111-2222-3333-4444-555555555555.\n" +
      "Take it from 'Application (client) ID' on the Overview page — not the\n" +
      "Object ID, and not the secret."
  );
  process.exit(1);
}

// URLSearchParams handles the encoding, including the spaces between scopes,
// so there is no chance of a hand-escaped %20 going wrong.
const params = new URLSearchParams({
  client_id: clientId,
  response_type: "code",
  redirect_uri: useProd ? PROD_REDIRECT : LOCAL_REDIRECT,
  response_mode: "query",
  scope: SCOPES.join(" "),
  state: "test123",
  // Force the consent screen every time, so the permission list can actually
  // be read rather than being skipped after the first run.
  prompt: "consent",
});

// URLSearchParams writes the spaces between scopes as "+". That is legal form
// encoding and Microsoft accepts it, but every Microsoft example uses %20, and
// a literal "+" is what a stricter reading of RFC 3986 would give. Match the
// documented form so a scope error can never be blamed on this.
const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params
  .toString()
  .replace(/\+/g, "%20")}`;

console.log(`\nRedirect: ${useProd ? PROD_REDIRECT : LOCAL_REDIRECT}`);
console.log("(this exact string must be registered under the Web platform)\n");
console.log(url);
console.log(
  "\nOpen it in a private window and sign in with an Outlook/Hotmail account.\n" +
    "Success = consent screen listing 'Read your mail', then a failed page load\n" +
    "whose address bar contains code=... and state=test123.\n"
);
