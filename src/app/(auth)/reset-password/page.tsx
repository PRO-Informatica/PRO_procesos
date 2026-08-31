import { AuthCard } from "@/features/auth/components/auth-card";
import { UpdatePasswordForm } from "@/features/auth/components/update-password-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Nueva contraseña | PRO Procesos" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  return (
    <AuthCard
      eyebrow="Seguridad"
      title="Crea una nueva contraseña"
      description="Elige una contraseña que no utilices en otros servicios."
    >
      <UpdatePasswordForm hasRecoverySession={Boolean(data?.claims?.sub)} />
    </AuthCard>
  );
}
