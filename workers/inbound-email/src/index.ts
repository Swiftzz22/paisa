import PostalMime from "postal-mime";

/**
 * Cloudflare Email Worker: the front door for forwarded bank alerts.
 *
 * Mail addressed to <key>@usepaisa.com arrives here, gets parsed out of MIME,
 * and is posted to paisa.'s /api/inbound/email. That route does the real work
 * — it resolves the key to a user, checks the sender looks like a bank, drops
 * duplicates, and stores the message for the parser.
 *
 * This exists because the app must never hold access to anyone's mailbox.
 * Reading Gmail through Google's API means a restricted OAuth scope, an annual
 * security assessment, and a permanent cap on how many people may ever grant
 * it. Mail the user forwards to us needs none of that.
 */

type Env = {
  /** Where paisa. is served, no trailing slash. */
  PAISA_ORIGIN: string;
  /** Shared with the route; compared in constant time on the other side. */
  INBOUND_EMAIL_SECRET: string;
};

/**
 * The route stores at most 200k characters per body. Cutting here as well
 * keeps a giant statement attachment from making a request that is rejected
 * whole after crossing the network.
 */
const MAX_BODY_CHARS = 200_000;

function clip(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_BODY_CHARS ? value.slice(0, MAX_BODY_CHARS) : value;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(await new Response(message.raw).arrayBuffer());

    /**
     * The sender we report is the one in the `From:` HEADER, not the envelope.
     *
     * These differ for exactly the case this worker exists to serve. When
     * Gmail forwards a message through a filter, the envelope sender becomes
     * the user's own address while the original `From:` header is preserved —
     * so `message.from` would say "sania@gmail.com" and the route would
     * discard every alert as not coming from a bank. The header is the bank.
     */
    const from = parsed.from?.address ?? message.from;

    /**
     * The recipient comes from the envelope, which is the opposite choice, for
     * the opposite reason: the envelope is where the key actually was
     * delivered. A `To:` header can say anything, and on forwarded mail it
     * usually still names the user's own inbox.
     */
    const to = message.to;

    const payload = {
      to,
      from,
      subject: parsed.subject ?? "",
      html: clip(parsed.html),
      text: clip(parsed.text),
      messageId: parsed.messageId ?? message.headers.get("message-id") ?? undefined,
      date: parsed.date ?? undefined,
    };

    const res = await fetch(`${env.PAISA_ORIGIN}/api/inbound/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-inbound-secret": env.INBOUND_EMAIL_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      // The route answers 200 for mail it deliberately ignored too, saying so
      // in the body. Worth logging: "ignored: not-a-bank-email" is the first
      // thing to look at when a forwarded alert never appears.
      console.log(`[inbound] ${to} <- ${from}: ${(await res.text()).slice(0, 200)}`);
      return;
    }

    const body = (await res.text()).slice(0, 200);

    /**
     * A 5xx is paisa. being down or broken, and the mail is still good — throw,
     * so Cloudflare reports a temporary failure and the sending server tries
     * again later. Storing is idempotent on Message-ID, so a retry cannot
     * duplicate anything.
     *
     * A 4xx means this request will never be accepted however many times it is
     * sent. Retrying that only turns one lost message into a bounce loop, so
     * it is logged and dropped.
     */
    if (res.status >= 500) {
      throw new Error(`paisa. returned ${res.status}: ${body}`);
    }
    console.error(`[inbound] rejected ${res.status}: ${body}`);
  },
};
