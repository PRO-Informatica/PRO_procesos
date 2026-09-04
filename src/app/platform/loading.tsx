import { WorkspaceSkeleton } from "@/components/feedback/skeletons";

export default function PlatformLoading() {
  return <WorkspaceSkeleton rows={4} metrics={4} filters={false} />;
}
