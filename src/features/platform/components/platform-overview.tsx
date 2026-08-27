import { Building2, Eye, LockKeyhole, ShieldCheck } from "lucide-react";

const foundations = [
  {
    icon: Eye,
    title: "Visibilidad global",
    description: "Lectura transversal habilitada por las políticas de plataforma.",
  },
  {
    icon: LockKeyhole,
    title: "Operación separada",
    description: "El acceso global no concede permisos para modificar proyectos.",
  },
  {
    icon: Building2,
    title: "Gestión por fases",
    description: "Empresas, usuarios y plantillas se habilitarán en fases posteriores.",
  },
];

export function PlatformOverview() {
  return (
    <div className="mx-auto max-w-6xl">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="border-b border-border p-6 sm:p-8">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
            Platform Phase 1
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Administración global
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
            Este ámbito está separado de la operación por proyecto. El shell base está listo para incorporar los módulos administrativos en sus fases correspondientes.
          </p>
        </div>

        <div className="grid gap-px bg-border md:grid-cols-3">
          {foundations.map(({ icon: Icon, title, description }) => (
            <article key={title} className="bg-surface p-6">
              <Icon aria-hidden="true" className="size-5 text-brand-strong" />
              <h2 className="mt-4 text-sm font-semibold text-foreground">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-foreground-muted">{description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
