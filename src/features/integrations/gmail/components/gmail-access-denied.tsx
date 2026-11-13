import { Mail } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";

export function GmailAccessDenied() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-xl py-6">
      <EmptyState
        icon={Mail}
        title="No tienes acceso a Correo"
        description="Este módulo está disponible para cuentas corporativas autorizadas. Puedes continuar usando las demás opciones del sistema."
        action={<Link href="/" className="secondary-button w-full sm:w-auto">Volver al inicio</Link>}
      />
    </div>
  );
}
