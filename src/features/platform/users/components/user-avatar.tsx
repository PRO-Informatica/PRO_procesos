/* eslint-disable @next/next/no-img-element -- Avatar origins are configured per user. */

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

export function UserAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl: string | null;
  size?: "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "size-14 text-base" : "size-9 text-xs";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-xl border border-border object-cover`}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} grid shrink-0 place-items-center rounded-xl bg-brand-soft font-bold text-brand-strong`}
    >
      {initials(name) || "U"}
    </span>
  );
}
