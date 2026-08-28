import { notFound } from "next/navigation";

import { MotionPage } from "@/components/motion/motion-page";
import { UserDetailView } from "@/features/platform/users/components/user-detail-view";
import { getPlatformUserDetail } from "@/features/platform/users/queries";

export default async function PlatformUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const user = await getPlatformUserDetail(id);
  if (!user) notFound();

  return (
    <MotionPage>
      <UserDetailView user={user} />
    </MotionPage>
  );
}
