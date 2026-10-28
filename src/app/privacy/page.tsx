import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — paisa.",
  description:
    "What paisa. collects, why, who it is shared with, and how to delete it.",
};

const UPDATED = "27 October 2026";

/**
 * Public privacy policy. Required three times over: App Store Connect demands a
 * URL, Google's OAuth verification requires one that specifically describes how
 * Google user data is handled, and India's DPDP Act will require it from 2027.
 *
 * Deliberately specific rather than boilerplate — it names the third parties,
 * because a vague policy is what fails a Google review, and because "we take
 * your privacy seriously" tells a reader nothing.
 */
export default function PrivacyPolicy() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← paisa.
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {UPDATED}</p>
      </header>

      <div className="space-y-8 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <p>
            paisa. reads the transaction alerts your bank emails you and turns
            them into a record of your spending. This page explains exactly what
            that involves. It is written to be read, not to be survived.
          </p>
        </section>

        <Section title="What is collected">
          <Item label="Your account">
            Name, email address and profile picture, from Google when you sign
            in.
          </Item>
          <Item label="Bank alert emails">
            If you connect Gmail, paisa. reads messages from a fixed list of
            banks, card issuers and UPI apps. It stores the full contents of
            those messages, including the original HTML, so a transaction can be
            re-read if the extraction was wrong.
          </Item>
          <Item label="Your transactions">
            Merchant, amount, date, payment method, category, and any notes you
            add — whether they came from an email, a statement you uploaded, or
            were typed in by hand. For an expense in another currency, the
            amount on the receipt and the exchange rate used to convert it.
          </Item>
          <Item label="Receipts you scan">
            Photos of receipts are read on your iPhone, using its built-in text
            recognition, and are never uploaded or stored. Only the details you
            save (amount, merchant, date, currency) reach paisa. If a receipt
            can&rsquo;t be read and you choose to use AI, the text recognised
            from it, never the photo, is sent once to Google&rsquo;s Gemini API
            and not kept afterwards.
          </Item>
          <Item label="People you split with">
            The names you type for people you share expenses with, and a phone
            number or UPI ID if you add one, along with how each bill was split
            and what has been settled. paisa. never contacts these people.
            Paying someone opens your own UPI app; paisa. does not handle the
            money.
          </Item>
          <Item label="What you ask">
            Questions you put to the Ask feature, and the answers.
          </Item>
          <Item label="Website visits">
            The paisa. website (not the iOS app) uses Vercel Web Analytics. It
            counts page views and records coarse details like country, browser
            and device type. It sets no cookies, identifies visitors only by a
            hash of the request that is discarded after 24 hours, and carries no
            identifier that could follow you to another site. It is not linked
            to your account.
          </Item>
          <p className="mt-3 text-sm text-zinc-500">
            No advertising identifiers, no location, no contacts, no third-party
            analytics inside the app, and no tracking across other apps or
            websites. Nothing here is sold or used for advertising.
          </p>
        </Section>

        <Section title="What paisa. can and cannot do with Gmail">
          <p>
            paisa. requests read-only access. It cannot send email, delete
            anything, or change your mailbox in any way. It only reads messages
            from known financial senders — a promotional email or a message from
            a friend is not read or stored.
          </p>
          <p className="mt-3">
            paisa.&rsquo;s use of information from Google APIs follows the{" "}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including its Limited Use requirements. That data is never sold,
            never used for advertising, and paisa. never uses it to train a
            machine learning model.
          </p>
          <p className="mt-3">
            You can disconnect Gmail at any time in Settings, or revoke access
            directly at{" "}
            <a
              className="underline"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              your Google account permissions
            </a>
            .
          </p>
        </Section>

        <Section title="Who else sees your data">
          <p>
            paisa. is run by one person and your data is not sold, rented or
            shared for marketing. It reaches these companies, only to provide
            the app. The iOS app asks for your permission, and names the two AI
            services, before sending anything to either of them, and you can
            withdraw that permission in Settings at any time:
          </p>
          <Item label="Google (Gemini API)">
            The text of each bank or UPI alert, to read the amount, merchant
            and category, and merchant names, to suggest a category. These go
            to Gemini or NVIDIA, whichever is working at the time, and to the
            other only if the first can&rsquo;t answer. Also the contents of a
            statement you upload, to find and extract each transaction in it;
            and, only when you ask for help with a receipt your iPhone
            couldn&rsquo;t read, the text recognised from that receipt.
          </Item>
          <Item label="NVIDIA (hosted AI inference)">
            The text of bank or UPI alerts and merchant names, when it is the
            service handling them (see Google, above); statement contents, as
            a first attempt at reading them; and, when you use Ask, your
            question with the transactions needed to answer it.
          </Item>
          <Item label="RevenueCat">
            Your account ID and purchase history, to manage a paisa. plus
            subscription. Payment itself is handled by Apple.
          </Item>
          <Item label="Vercel">
            Runs the servers.
          </Item>
          <Item label="Turso">
            Stores the database.
          </Item>
          <Item label="Vercel Web Analytics">
            Counts visits to the website only, with no cookies and no link to
            your account. It is not used in the iOS app.
          </Item>
        </Section>

        <Section title="How long it is kept">
          <p>
            Your data is kept for as long as your account exists. Delete your
            account and all of it — transactions, stored emails, categories,
            budgets — is removed immediately and permanently. There is no
            archive and no backup copy to restore from.
          </p>
        </Section>

        <Section title="Deleting your account">
          <p>
            <Link href="/settings/delete-account" className="underline">
              Settings → Delete account
            </Link>
            , reachable from inside the app as well. It removes everything, signs
            out every device, and revokes paisa.&rsquo;s Gmail access with Google
            first. Your actual Gmail is untouched — only paisa.&rsquo;s copy of
            what it read is destroyed.
          </p>
        </Section>

        <Section title="How it is protected">
          <p>
            Traffic is encrypted in transit. Google credentials are encrypted at
            rest with AES-256-GCM. Every query is scoped to the signed-in
            account, so one user&rsquo;s data cannot be reached from
            another&rsquo;s session. Sign-in supports passkeys, and the app can
            be locked behind Face ID or your device passcode.
          </p>
          <p className="mt-3">
            No system is perfect. If something is exposed, affected users will be
            told without delay.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can see everything paisa. holds about you inside the app, correct
            any transaction, disconnect Gmail, or delete the account outright.
            Under India&rsquo;s Digital Personal Data Protection Act you may also
            ask what is held and request its erasure — the delete-account page
            does both immediately.
          </p>
        </Section>

        <Section title="Children">
          <p>
            paisa. is not intended for anyone under 13, and accounts are not
            knowingly created for them.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes in a way that affects how your data is used,
            you will be told in the app before it takes effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions, or a privacy request:{" "}
            <a className="underline" href="mailto:sania.kothari@gmail.com">
              sania.kothari@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mt-3">
      <strong className="text-zinc-900 dark:text-zinc-50">{label}.</strong>{" "}
      {children}
    </p>
  );
}
