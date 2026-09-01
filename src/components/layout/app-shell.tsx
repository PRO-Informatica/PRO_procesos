"use client";

import { useState } from "react";

import type { SessionProfile } from "@/features/auth/types";

import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  profile,
  unreadNotifications,
  children,
}: {
  profile: SessionProfile;
  unreadNotifications: number;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas">
      <AppSidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onCollapse={() => setSidebarCollapsed((value) => !value)}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div
        className={`min-h-screen transition-[padding] duration-200 ${
          sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"
        }`}
      >
        <Topbar
          profile={profile}
          unreadNotifications={unreadNotifications}
          onOpenNavigation={() => setMobileSidebarOpen(true)}
        />
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
