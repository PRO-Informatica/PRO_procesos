export const SUPABASE_PROJECT_REFS = {
  DEV: "gholwtklihaphoevosyb",
  PROD: "jeyjblxfqqlypxiaznad",
} as const;

export type AppEnvironment = keyof typeof SUPABASE_PROJECT_REFS;

export type PublicEnvironmentSource = {
  NEXT_PUBLIC_APP_ENV?: string;
  NEXT_PUBLIC_SUPABASE_DEV_URL?: string;
  NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PROD_URL?: string;
  NEXT_PUBLIC_SUPABASE_PROD_PUBLISHABLE_KEY?: string;
};

export type PublicEnvironment = {
  appEnvironment: AppEnvironment;
  supabaseUrl: string;
  supabasePublishableKey: string;
  projectRef: (typeof SUPABASE_PROJECT_REFS)[AppEnvironment];
};

function required(value: string | undefined, variableName: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Falta la variable de entorno ${variableName}.`);
  return normalized;
}

function parseAppEnvironment(value: string | undefined): AppEnvironment {
  if (value === "DEV" || value === "PROD") return value;
  throw new Error(
    "NEXT_PUBLIC_APP_ENV debe definirse explícitamente como DEV o PROD.",
  );
}

function validateSupabaseUrl(url: string, environment: AppEnvironment) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`La URL de Supabase para ${environment} no es válida.`);
  }

  const expectedProjectRef = SUPABASE_PROJECT_REFS[environment];
  const expectedHostname = `${expectedProjectRef}.supabase.co`;
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error(
      `La URL de Supabase para ${environment} debe usar HTTPS y el dominio supabase.co.`,
    );
  }
  if (parsed.hostname !== expectedHostname) {
    throw new Error(
      `La URL de Supabase configurada para ${environment} no corresponde al proyecto esperado.`,
    );
  }
  return parsed.origin;
}

export function resolvePublicEnvironment(
  source: PublicEnvironmentSource,
): PublicEnvironment {
  const appEnvironment = parseAppEnvironment(source.NEXT_PUBLIC_APP_ENV);
  const selected =
    appEnvironment === "DEV"
      ? {
          url: source.NEXT_PUBLIC_SUPABASE_DEV_URL,
          publishableKey: source.NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY,
          urlVariable: "NEXT_PUBLIC_SUPABASE_DEV_URL",
          keyVariable: "NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY",
        }
      : {
          url: source.NEXT_PUBLIC_SUPABASE_PROD_URL,
          publishableKey: source.NEXT_PUBLIC_SUPABASE_PROD_PUBLISHABLE_KEY,
          urlVariable: "NEXT_PUBLIC_SUPABASE_PROD_URL",
          keyVariable: "NEXT_PUBLIC_SUPABASE_PROD_PUBLISHABLE_KEY",
        };

  return {
    appEnvironment,
    supabaseUrl: validateSupabaseUrl(
      required(selected.url, selected.urlVariable),
      appEnvironment,
    ),
    supabasePublishableKey: required(selected.publishableKey, selected.keyVariable),
    projectRef: SUPABASE_PROJECT_REFS[appEnvironment],
  };
}

export function getPublicEnvironment(): PublicEnvironment {
  // Direct property access is required so Next.js can inline NEXT_PUBLIC values.
  return resolvePublicEnvironment({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_SUPABASE_DEV_URL: process.env.NEXT_PUBLIC_SUPABASE_DEV_URL,
    NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_PROD_URL: process.env.NEXT_PUBLIC_SUPABASE_PROD_URL,
    NEXT_PUBLIC_SUPABASE_PROD_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PROD_PUBLISHABLE_KEY,
  });
}

export function maskProjectRef(projectRef: string) {
  if (projectRef.length <= 8) return "••••";
  return `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`;
}

export function getSupabaseEnvironmentIdentity(
  environment = getPublicEnvironment(),
) {
  return {
    environment: environment.appEnvironment,
    projectRef: maskProjectRef(environment.projectRef),
  };
}
