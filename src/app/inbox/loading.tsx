import { PageSkeleton, RowsSkeleton } from "@/components/Skeletons";

export default function InboxLoading() {
  return (
    <PageSkeleton>
      <RowsSkeleton rows={10} />
    </PageSkeleton>
  );
}
