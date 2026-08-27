export type PublicEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

export function getPublicEnvironment(): PublicEnvironment {
  // Direct property access is required so Next.js can inline NEXT_PUBLIC values.
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  if (!environment.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!environment.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Falta la variable de entorno NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return environment as PublicEnvironment;
}
