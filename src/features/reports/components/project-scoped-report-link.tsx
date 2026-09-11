"use client";

import Link from "next/link";
import { useActionState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { switchProject } from "@/features/projects/actions";
import { useProjectContext } from "@/features/projects/project-context";

const initialState = { status: "idle" as const };

export function ProjectScopedReportLink({
  projectId,
  href,
  className,
  children,
}: {
  projectId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const context = useProjectContext();
  const [state, action, pending] = useActionState(switchProject, initialState);
  const needsProjectSwitch = context.activeProject?.id !== projectId;
  useGlobalPending(
    pending,
    "Abriendo detalle…",
    "Estamos cambiando al proyecto correspondiente.",
  );

  if (!needsProjectSwitch) {
    return <Link href={href} className={className}>{children}</Link>;
  }

  return (
    <form action={action} className="contents">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={href} />
      <button type="submit" className={className} disabled={pending}>
        {children}
      </button>
      {state.status === "error" && <span className="sr-only" role="alert">{state.message}</span>}
    </form>
  );
}
