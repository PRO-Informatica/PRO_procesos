"use client";

import Link from "next/link";
import { useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";

export function ScopeSwitchLink({
  href,
  loadingLabel,
  className,
  children,
  onNavigate,
  title,
}: {
  href: string;
  loadingLabel: string;
  className?: string;
  children: React.ReactNode;
  onNavigate?: () => void;
  title?: string;
}) {
  const [navigating, setNavigating] = useState(false);
  useGlobalPending(navigating, loadingLabel);

  return (
    <Link
        href={href}
        className={className}
        title={title}
        aria-disabled={navigating}
        onClick={() => {
          setNavigating(true);
          onNavigate?.();
        }}
      >
        {children}
    </Link>
  );
}
