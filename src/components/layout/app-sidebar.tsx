"use client";

import {
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  Files,
  FolderKanban,
  Globe2,
  LayoutDashboard,
  ReceiptText,
  Scale,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ScopeSwitchLink } from "@/components/shared/scope-switch-link";
import { usePlatformContext } from "@/features/platform/platform-context";
import { ProjectSelector } from "@/features/projects/components/project-selector";
import { useProjectContext } from "@/features/projects/project-context";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onMobileClose: () => void;
};

type NavigationItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href?: string;
  enabled?: boolean;
  permission?: string;
  anyPermission?: string[];
  companyAdminOnly?: boolean;
};

const navigation: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "",
    items: [{ label: "Inicio", icon: LayoutDashboard, href: "/", enabled: true }],
  },
  {
    label: "Operación",
    items: [
      {
        label: "Programación",
        icon: CalendarDays,
        href: "/programming",
        permission: "programming.view",
      },
      { label: "Despachos", icon: Truck, href: "/dispatches", permission: "dispatch.view" },
    ],
  },
  {
    label: "Gestión",
    items: [
      { label: "Lotes", icon: FolderKanban, href: "/batches", permission: "batch.view" },
      { label: "Facturas", icon: ReceiptText, permission: "invoice.view" },
      {
        label: "Conciliación",
        icon: Scale,
        anyPermission: ["invoice.review", "batch.review"],
      },
    ],
  },
  {
    label: "Control",
    items: [
      {
        label: "Autorizaciones",
        icon: ShieldCheck,
        anyPermission: ["batch.final_authorize", "batch.request_authorization"],
      },
      { label: "Documentos", icon: Files, permission: "document.view" },
      { label: "Notificaciones", icon: Bell },
    ],
  },
  {
    label: "Administración",
    items: [
      { label: "Proyectos", icon: FolderKanban, companyAdminOnly: true },
      { label: "Usuarios", icon: Users, permission: "project.manage_members" },
      { label: "Proveedores", icon: Building2, permission: "project.manage_suppliers" },
      { label: "Configuración", icon: Settings, companyAdminOnly: true },
    ],
  },
];

export function AppSidebar({
  collapsed,
  mobileOpen,
  onCollapse,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const projectContext = useProjectContext();
  const platformContext = usePlatformContext();
  const visibleNavigation = navigation
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.enabled || (!item.permission && !item.anyPermission && !item.companyAdminOnly)) {
          return true;
        }
        if (item.companyAdminOnly && projectContext.isCompanyAdmin) return true;
        if (item.permission && projectContext.permissions.includes(item.permission)) return true;
        return item.anyPermission?.some((permission) =>
          projectContext.permissions.includes(permission),
        );
      }),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.button
            type="button"
            aria-label="Cerrar navegación"
            className="fixed inset-0 z-40 bg-black/45 lg:hidden"
            onClick={onMobileClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
        )}
      </AnimatePresence>

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

          <div className="border-b border-white/8 p-3">
            <ProjectSelector collapsed={collapsed} />
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Navegación principal">
            {visibleNavigation.map((section, sectionIndex) => (
              <div key={section.label || sectionIndex} className="mb-5">
                {section.label && !collapsed && (
                  <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
                    {section.label}
                  </p>
                )}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active =
                      item.href === "/"
                        ? pathname === "/"
                        : Boolean(item.href && pathname.startsWith(item.href));
                    const sharedClass = `flex h-10 w-full items-center rounded-lg text-sm transition-colors ${
                      collapsed ? "justify-center px-2" : "gap-3 px-3"
                    }`;

                    if (item.href) {
                      return (
                        <Link
                          href={item.href}
                          key={item.label}
                          onClick={onMobileClose}
                          className={`${sharedClass} font-medium ${
                            active
                              ? "bg-white/10 text-white"
                              : "text-white/62 hover:bg-white/8 hover:text-white"
                          }`}
                          title={collapsed ? item.label : undefined}
                          aria-current={active ? "page" : undefined}
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
              </div>
            ))}
          </nav>

          {platformContext.isPlatformAdmin && platformContext.hasOperationalAccess && (
            <div className="border-t border-white/8 p-3">
              <ScopeSwitchLink
                href="/platform"
                loadingLabel="Cambiando a administración global…"
                onNavigate={onMobileClose}
                className={`flex h-10 items-center rounded-lg text-sm font-medium text-white/65 transition-colors hover:bg-white/8 hover:text-white ${
                  collapsed ? "justify-center" : "gap-3 px-3"
                }`}
                title={collapsed ? "Administración global" : undefined}
              >
                <Globe2 aria-hidden="true" className="size-[18px] shrink-0" />
                {!collapsed && <span>Administración global</span>}
              </ScopeSwitchLink>
            </div>
          )}

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
