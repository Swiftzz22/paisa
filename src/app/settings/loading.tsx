import { CardsSkeleton, PageSkeleton } from "@/components/Skeletons";

export default function SettingsLoading() {
  return (
    <PageSkeleton>
      <CardsSkeleton cards={8} />
    </PageSkeleton>
  );
}
