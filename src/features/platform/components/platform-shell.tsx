"use client";

import { useState } from "react";

import type { SessionProfile } from "@/features/auth/types";
import { RouteTransition } from "@/components/motion/route-transition";

import { PlatformSidebar } from "./platform-sidebar";
import { PlatformTopbar } from "./platform-topbar";

export function PlatformShell({
  profile,
  children,
}: {
  profile: SessionProfile;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas">
      <PlatformSidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onCollapse={() => setSidebarCollapsed((value) => !value)}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div
        className={`min-h-screen min-w-0 transition-[padding] duration-200 ${
          sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"
        }`}
      >
        <PlatformTopbar
          profile={profile}
          onOpenNavigation={() => setMobileSidebarOpen(true)}
        />
        <main className="min-w-0 overflow-x-clip p-3 sm:p-6 lg:p-8"><RouteTransition>{children}</RouteTransition></main>
      </div>
    </div>
  );
}
