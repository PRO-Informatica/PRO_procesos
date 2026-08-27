"use client";

import { createContext, useContext } from "react";

import type { ProjectContextState } from "./types";

const ProjectContext = createContext<ProjectContextState | null>(null);

export function ProjectProvider({
  value,
  children,
}: {
  value: ProjectContextState;
  children: React.ReactNode;
}) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjectContext debe utilizarse dentro de ProjectProvider.");
  }
  return context;
}

export function useHasPermission(permission: string) {
  const context = useProjectContext();
  return context.permissions.includes(permission);
}
