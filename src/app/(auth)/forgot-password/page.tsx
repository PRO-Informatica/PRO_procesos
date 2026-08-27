import { AuthCard } from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export const metadata = { title: "Recuperar acceso | PRO Procesos" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Recuperar acceso"
      title="Restablece tu contraseña"
      description="Te enviaremos un enlace seguro si encontramos una cuenta habilitada con ese correo."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
