import Link from "next/link";

export const metadata = {
  title: "Terms of Use — paisa.",
  description:
    "The agreement between you and paisa.: what the app does, what it does not promise, and how either side can end it.",
};

const UPDATED = "1 September 2026";

/**
 * Terms of Use.
 *
 * App Store Review asks for a terms URL, and App Review Guideline 3.1.2 expects
 * an EULA for apps with accounts. Apple's standard EULA can be used instead, but
 * it says nothing about reading someone's bank email, which is the part of this
 * app a user would actually want terms about.
 *
 * Written in plain words on purpose. Terms nobody reads protect nobody.
 */
export default function TermsOfUse() {
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
          Terms of Use
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {UPDATED}</p>
      </header>

      <div className="space-y-8 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <p>
            These terms are the agreement between you and paisa. By creating an
            account or using the app, you accept them. If you don&rsquo;t, please
            don&rsquo;t use it — and if you already have,{" "}
            <Link href="/settings/delete-account" className="underline">
              delete your account
            </Link>
            .
          </p>
        </section>

        <Section title="What paisa. is">
          <p>
            paisa. records your spending. It can read transaction alerts from
            banks, card issuers and UPI apps in an inbox you connect, read
            statements you upload, and let you enter transactions by hand. It
            sorts them into categories and shows you totals.
          </p>
          <p className="mt-3">
            It is a record-keeping tool. It is <strong>not</strong> a bank, not a
            payment service, and not a financial adviser. It cannot move money,
            make payments, or act on your accounts, and nothing in it is
            financial, tax or investment advice.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            You need an account, created by signing in with Google or Apple. You
            are responsible for keeping access to that sign-in secure — anyone
            who can use it can see your spending.
          </p>
          <p className="mt-3">
            One account is for one person. Don&rsquo;t share it, and don&rsquo;t
            connect an inbox that isn&rsquo;t yours or that you don&rsquo;t have
            permission to read.
          </p>
          <p className="mt-3">
            You must be old enough to hold the accounts you connect, and at least
            13.
          </p>
        </Section>

        <Section title="Accuracy — please read this one">
          <p>
            Transactions are extracted from emails and statements automatically,
            partly by AI. It gets things wrong. Amounts, dates, merchants and
            categories can all be misread, and some transactions will be missed
            entirely — paisa. only ever sees what your bank happens to email you
            or what you upload.
          </p>
          <p className="mt-3">
            <strong className="text-zinc-900 dark:text-zinc-50">
              Never treat paisa. as the authoritative record of your money.
            </strong>{" "}
            Your bank&rsquo;s own statement is. Check anything that matters
            against it, particularly before making a decision or filing anything
            official.
          </p>
        </Section>

        <Section title="What you may not do">
          <p>
            Don&rsquo;t use paisa. to break the law. Don&rsquo;t try to reach
            anyone else&rsquo;s data, probe or overload the service, scrape it,
            or resell access to it. Don&rsquo;t upload documents you have no
            right to.
          </p>
        </Section>

        <Section title="Your data and your content">
          <p>
            Your transactions, statements and stored emails remain yours. You
            give paisa. permission to process them only in order to run the
            service for you — extract transactions, categorize them, and show
            them back to you. Nothing more.
          </p>
          <p className="mt-3">
            What is collected, which companies it reaches, and how to remove it
            is set out in the{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            , which forms part of these terms.
          </p>
        </Section>

        <Section title="Cost">
          <p>
            paisa. is currently free to use. If paid features are ever
            introduced, the price and terms will be shown before you are charged,
            and anything you already have will not start costing money without
            your agreement. Purchases made through the App Store are handled by
            Apple under Apple&rsquo;s terms, including refunds.
          </p>
        </Section>

        <Section title="Ending it">
          <p>
            You can stop at any time by{" "}
            <Link href="/settings/delete-account" className="underline">
              deleting your account
            </Link>
            , in the app or on the web. That removes your transactions, stored
            emails, categories and budgets immediately and permanently, and
            revokes paisa.&rsquo;s access to any inbox you connected. There is no
            backup to restore from.
          </p>
          <p className="mt-3">
            Access may be suspended or ended if these terms are broken, or if
            running the service becomes impossible. Reasonable notice will be
            given where it can be.
          </p>
        </Section>

        <Section title="No warranty, and the limits of liability">
          <p>
            paisa. is provided as it is, without warranties of any kind. It is
            run by one person and may be unavailable, lose data, or stop
            existing. It is not guaranteed to be accurate, complete, or
            uninterrupted.
          </p>
          <p className="mt-3">
            To the extent the law allows, paisa. is not liable for indirect or
            consequential loss, or for financial decisions made on the basis of
            what the app showed you. Nothing here limits liability that
            cannot legally be limited — including for fraud, or for death or
            personal injury caused by negligence. Where liability cannot be
            excluded, it is limited to the greater of the amount you paid in the
            preceding twelve months, or ₹1,000.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            These terms may change as the app does. The date at the top says when
            they last did. If a change materially reduces your rights, you will
            be told in the app before it takes effect. Continuing to use paisa.
            after that means you accept the new version.
          </p>
        </Section>

        <Section title="Apple">
          <p>
            If you use paisa. on an Apple device: this agreement is between you
            and paisa. only, not Apple. Apple has no obligation to provide
            support for the app and is not responsible for it. Apple and its
            subsidiaries are third-party beneficiaries of these terms and may
            enforce them against you.
          </p>
        </Section>

        <Section title="Law, and getting in touch">
          <p>
            These terms are governed by the laws of India, and the courts of
            India have jurisdiction — without removing any protection you have
            under the consumer law of the country you live in.
          </p>
          <p className="mt-3">
            Questions, complaints or requests about your data:{" "}
            <a href="mailto:sania.kothari@gmail.com" className="underline">
              sania.kothari@gmail.com
            </a>
            .
          </p>
        </Section>

        <p className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
          See also the{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
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
