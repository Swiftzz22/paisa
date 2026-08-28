import { PageSkeleton, RowsSkeleton } from "@/components/Skeletons";

export default function RulesLoading() {
  return (
    <PageSkeleton>
      <RowsSkeleton rows={6} />
    </PageSkeleton>
  );
}
