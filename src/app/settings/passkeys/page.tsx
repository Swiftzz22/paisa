import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import { AddPasskeyButton } from "@/components/AddPasskeyButton";
import { deletePasskeyAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PasskeysSettings() {
  const user = await getCurrentUser();
  const passkeys = await prisma.passkey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, deviceName: true },
  });

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Back to settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Passkeys
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with your fingerprint, face, or device PIN — no password. Add
          one on each device you use. Google sign-in still works anytime.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Add a passkey on this device
        </h2>
        <AddPasskeyButton />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {passkeys.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No passkeys yet. Add one above to enable biometric sign-in.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {passkeys.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">
                    {p.deviceName || "Passkey"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Added{" "}
                    {p.createdAt.toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <form action={deletePasskeyAction.bind(null, p.id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline dark:text-red-400"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
