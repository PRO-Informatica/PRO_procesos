import { AuthCard } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { getAuthErrorMessage, safeInternalPath } from "@/features/auth/security";

export const metadata = { title: "Ingresar | PRO Procesos" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const safeNext = safeInternalPath(next);
  const errorMessage = getAuthErrorMessage(error);

  return (
    <AuthCard
      eyebrow="Bienvenido"
      title="Ingresa a tu cuenta"
      description="Utiliza las credenciales asignadas por el administrador de tu empresa."
    >
      <LoginForm
        nextPath={safeNext}
        initialState={
          errorMessage ? { status: "error", message: errorMessage } : undefined
        }
      />
    </AuthCard>
  );
}
