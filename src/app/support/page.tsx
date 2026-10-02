import Link from "next/link";

export const metadata = {
  title: "Support — paisa.",
  description:
    "How to reach paisa., and answers to the questions people ask most.",
};

const CONTACT = "sania.kothari@gmail.com";

/**
 * Support.
 *
 * The App Store's Support URL has to lead somewhere a person can get help;
 * pointing it at the app's sign-in page leaves a reviewer, and a customer,
 * with nobody to ask. This is that page — public, no sign-in, a real address.
 */
export default function Support() {
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
          Support
        </h1>
      </header>

      <div className="space-y-8 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <p>
            Questions, problems or requests about your data: email{" "}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            . A person reads every message, usually within two days.
          </p>
        </section>

        <Section title="Getting your transactions in">
          <p>
            Upload a statement from any bank in Settings › Add transactions ›
            Upload a statement — CSV, Excel or PDF. With paisa. plus you can
            instead connect a Gmail mailbox, and paisa. reads the transaction
            alerts your bank already sends. You can always add a transaction by
            hand with the + button.
          </p>
        </Section>

        <Section title="AI processing">
          <p>
            Statements, bank alerts and questions in Ask are read by AI
            services run by Google (Gemini) and NVIDIA. The app asks before
            sending anything to them. To withdraw permission, go to Settings ›
            Privacy › AI processing; any connected mailbox is disconnected at
            the same time.
          </p>
        </Section>

        <Section title="paisa. plus">
          <p>
            Plus is an auto-renewing subscription, monthly or yearly, bought
            through Apple. Manage or cancel it in iPhone Settings › your name ›
            Subscriptions. If you change phones, open Settings › paisa. plus ›
            Restore purchases. Refunds are handled by Apple at{" "}
            <a
              href="https://reportaproblem.apple.com"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              reportaproblem.apple.com
            </a>
            .
          </p>
        </Section>

        <Section title="Deleting your account">
          <p>
            In the app, go to Settings › Delete account. This permanently
            removes your account, every transaction and every stored email, and
            revokes paisa.&rsquo;s access to Google and Apple. It cannot be
            undone.
          </p>
        </Section>

        <Section title="Policies">
          <p>
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>{" "}
            ·{" "}
            <Link href="/terms" className="underline">
              Terms of Use
            </Link>
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
