import Image from "next/image";
import { Building2, HardHat } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl overflow-hidden rounded-2xl border border-border bg-surface shadow-sm sm:min-h-[calc(100vh-3rem)] lg:min-h-[calc(100vh-4rem)]">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar p-6 lg:flex lg:flex-col">
          <Image
            src="/pro-logo.png"
            alt="PRO"
            width={188}
            height={57}
            priority
            className="h-auto w-32"
          />

          <div className="mt-12 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="mb-3 flex items-center gap-2 font-medium text-white">
              <Building2 aria-hidden="true" className="size-4 text-brand" />
              Proyecto activo
            </div>
            Se habilitará en la Fase 2.
          </div>

          <p className="mt-auto text-xs leading-5 text-white/45">
            Plataforma de control operativo y documental.
          </p>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-20 items-center border-b border-border px-5 sm:px-8">
            <Image
              src="/pro-logo.png"
              alt="PRO"
              width={188}
              height={57}
              priority
              className="h-auto w-24 rounded bg-sidebar p-2 lg:hidden"
            />
            <span className="ml-auto rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground-muted">
              Fase 0 · Baseline
            </span>
          </header>

          <div className="grid flex-1 place-items-center p-6 sm:p-10">
            <div className="max-w-xl text-center">
              <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-strong">
                <HardHat aria-hidden="true" className="size-7" />
              </div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-brand-strong">
                Configuración completada
              </p>
              <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                La base técnica de PRO está lista.
              </h1>
              <p className="mt-4 text-pretty leading-7 text-foreground-muted">
                Next.js, TypeScript, Tailwind y Supabase SSR quedaron preparados.
                Los módulos funcionales comenzarán únicamente en la siguiente fase.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
