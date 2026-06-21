import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const email = await prisma.receivedEmail.findFirst({
    where: { id, userId: user.id },
  });
  if (!email) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <Link
          href="/inbox"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Back to inbox
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {email.subject || "(no subject)"}
        </h1>
        <dl className="mt-3 grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <Row label="From">{email.fromAddress}</Row>
          <Row label="Date">{formatDateTime(email.receivedAt)}</Row>
          <Row label="UID">{email.uid ?? "—"}</Row>
          <Row label="Parse status">{email.parseStatus}</Row>
          {email.parseError ? (
            <Row label="Parse error">
              <span className="text-red-600 dark:text-red-400">{email.parseError}</span>
            </Row>
          ) : null}
        </dl>
      </header>

      {email.bodyText ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Plain text body
          </h2>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            {email.bodyText}
          </pre>
        </section>
      ) : null}

      {email.rawHtml ? (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            HTML body (rendered)
          </h2>
          <div
            className="rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            dangerouslySetInnerHTML={{ __html: email.rawHtml }}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-zinc-500">
              View raw HTML source
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
              {email.rawHtml}
            </pre>
          </details>
        </section>
      ) : null}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-50">{children}</dd>
    </>
  );
}
