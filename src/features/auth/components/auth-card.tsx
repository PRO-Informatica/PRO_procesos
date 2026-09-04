import Image from "next/image";
import * as motion from "motion/react-client";

import { fadeUp } from "@/lib/motion/variants";

export function AuthCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="w-full max-w-lg"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
    >
      <div className="mb-6 flex justify-center sm:mb-9 lg:hidden">
        <div className="rounded-xl bg-sidebar px-5 py-3">
          <Image src="/pro-logo.png" alt="PRO" width={120} height={60} priority />
        </div>
      </div>

      <div className="auth-card rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-base leading-7 text-foreground-muted">
          {description}
        </p>
        <div className="mt-7 sm:mt-9">{children}</div>
      </div>

      <p className="mt-5 text-center text-xs leading-5 text-foreground-muted">
        Acceso exclusivo para personal autorizado.
      </p>
    </motion.div>
  );
}
