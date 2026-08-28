import { MotionPage } from "@/components/motion/motion-page";
import { UsersList } from "@/features/platform/users/components/users-list";
import { getPlatformUsers } from "@/features/platform/users/queries";
import type {
  PlatformUserListFilters,
  PlatformUserProfileStatus,
} from "@/features/platform/users/types";

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function parseFilters(
  params: Record<string, string | string[] | undefined>,
): PlatformUserListFilters {
  const rawPage = Number.parseInt(readParam(params.page), 10);
  const rawStatus = readParam(params.status);
  const status: PlatformUserProfileStatus | "ALL" =
    rawStatus === "ACTIVE" || rawStatus === "INACTIVE" ? rawStatus : "ALL";

  return {
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: 10,
    query: readParam(params.search).trim().slice(0, 100),
    status,
  };
}

export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const result = await getPlatformUsers(filters);

  return (
    <MotionPage>
      <UsersList result={result} filters={filters} />
    </MotionPage>
  );
}
