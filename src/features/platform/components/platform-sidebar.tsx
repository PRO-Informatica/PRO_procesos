"use client";

import {
  Building2,
  ChevronLeft,
  FileClock,
  LayoutDashboard,
  PanelsTopLeft,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

type PlatformSidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onMobileClose: () => void;
};

const navigation = [
  { label: "Resumen", icon: LayoutDashboard, href: "/platform", enabled: true },
  { label: "Empresas", icon: Building2, enabled: false },
  { label: "Usuarios", icon: Users, enabled: false },
  { label: "Plantillas", icon: PanelsTopLeft, enabled: false },
  { label: "Auditoría", icon: FileClock, enabled: false },
];

export function PlatformSidebar({
  collapsed,
  mobileOpen,
  onCollapse,
  onMobileClose,
}: PlatformSidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex bg-sidebar text-white transition-[width,transform] duration-200 ${
          collapsed ? "w-20" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-white/8">
          <div className="flex h-20 shrink-0 items-center border-b border-white/8 px-5">
            <Image
              src="/pro-logo.png"
              alt="PRO"
              width={120}
              height={60}
              priority
              className={`h-auto object-contain ${collapsed ? "w-10 object-left" : "w-28"}`}
            />
            <button
              type="button"
              onClick={onMobileClose}
              className="ml-auto grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/8 hover:text-white lg:hidden"
              aria-label="Cerrar navegación"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>

          {!collapsed && (
            <div className="border-b border-white/8 px-6 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                Plataforma
              </p>
              <p className="mt-1 text-sm font-semibold text-white">Administración global</p>
            </div>
          )}

          <nav
            className="flex-1 overflow-y-auto px-3 py-4"
            aria-label="Navegación de plataforma"
          >
            <p
              className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30 ${
                collapsed ? "sr-only" : ""
              }`}
            >
              Control global
            </p>
            <div className="space-y-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                const sharedClass = `flex h-10 w-full items-center rounded-lg text-sm transition-colors ${
                  collapsed ? "justify-center px-2" : "gap-3 px-3"
                }`;

                if (item.enabled && item.href) {
                  return (
                    <Link
                      href={item.href}
                      key={item.label}
                      onClick={onMobileClose}
                      className={`${sharedClass} bg-white/10 font-medium text-white`}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon aria-hidden="true" className="size-[18px] shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                }

                return (
                  <button
                    type="button"
                    disabled
                    key={item.label}
                    className={`${sharedClass} cursor-not-allowed text-white/32`}
                    title={`${item.label} · Próxima fase`}
                  >
                    <Icon aria-hidden="true" className="size-[18px] shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="hidden border-t border-white/8 p-3 lg:block">
            <button
              type="button"
              onClick={onCollapse}
              className={`flex h-10 w-full items-center rounded-lg text-sm text-white/50 transition-colors hover:bg-white/8 hover:text-white ${
                collapsed ? "justify-center" : "gap-3 px-3"
              }`}
              aria-label={collapsed ? "Expandir navegación" : "Colapsar navegación"}
            >
              <ChevronLeft
                aria-hidden="true"
                className={`size-[18px] transition-transform ${collapsed ? "rotate-180" : ""}`}
              />
              {!collapsed && <span>Colapsar</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
