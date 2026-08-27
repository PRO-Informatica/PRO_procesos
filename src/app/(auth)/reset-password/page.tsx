import { AuthCard } from "@/features/auth/components/auth-card";
import { UpdatePasswordForm } from "@/features/auth/components/update-password-form";

export const metadata = { title: "Nueva contraseña | PRO Procesos" };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      eyebrow="Seguridad"
      title="Crea una nueva contraseña"
      description="Elige una contraseña que no utilices en otros servicios."
    >
      <UpdatePasswordForm />
    </AuthCard>
  );
}
