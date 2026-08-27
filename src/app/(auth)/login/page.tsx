import { AuthCard } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata = { title: "Ingresar | PRO Procesos" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <AuthCard
      eyebrow="Bienvenido"
      title="Ingresa a tu cuenta"
      description="Utiliza las credenciales asignadas por el administrador de tu empresa."
    >
      <LoginForm
        nextPath={safeNext}
        initialState={
          error ? { status: "error", message: error } : undefined
        }
      />
    </AuthCard>
  );
}
