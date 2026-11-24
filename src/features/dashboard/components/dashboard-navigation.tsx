"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LoadingButton } from "@/components/feedback/loading-button";
import { switchProject } from "@/features/projects/actions";

export function OpenDashboardProject({ projectId, target }: { projectId: string; target: string }) {
  const [state, action] = useActionState(switchProject, { status: "idle" });

  return (
    <form action={action} className="flex flex-wrap items-center justify-center gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={target} />
      <LoadingButton loadingLabel="Abriendo detalle…">Cambiar proyecto y abrir</LoadingButton>
      <Link href="/" className="secondary-button">Volver al dashboard</Link>
      {state.status === "error" && <p role="alert" className="w-full text-sm text-destructive">{state.message}</p>}
    </form>
  );
}
