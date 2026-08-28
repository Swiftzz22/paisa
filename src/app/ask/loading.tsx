import { PageSkeleton } from "@/components/Skeletons";

export default function AskLoading() {
  return (
    <PageSkeleton>
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-11 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </PageSkeleton>
  );
}
