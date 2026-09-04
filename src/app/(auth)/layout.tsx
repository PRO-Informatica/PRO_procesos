import Image from "next/image";
import { ClipboardCheck, FileCheck2, ShieldCheck } from "lucide-react";

const benefits = [
  { icon: ClipboardCheck, label: "Operación trazable" },
  { icon: FileCheck2, label: "Expedientes completos" },
  { icon: ShieldCheck, label: "Acceso por permisos" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="auth-grid absolute inset-0 opacity-25" />
        <div className="relative z-10">
          <Image src="/pro-logo.png" alt="PRO" width={150} height={75} priority />
        </div>

        <div className="relative z-10 my-auto max-w-lg py-14">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">
            Control de concreto
          </p>
          <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            La operación y sus documentos, en un solo lugar.
          </h2>
          <p className="mt-6 max-w-md text-base leading-7 text-white/60">
            Programa, recibe, concilia y autoriza con trazabilidad por empresa y proyecto.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {benefits.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <Icon aria-hidden="true" className="size-5 text-brand" />
                <p className="mt-3 text-sm font-medium text-white/80">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/35">
          PRO Procesos · Plataforma empresarial
        </p>
      </section>

      <section className="grid min-h-screen place-items-center px-3 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-10">
        {children}
      </section>
    </main>
  );
}
