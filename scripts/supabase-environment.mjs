const PROJECT_REFS = {
  DEV: "gholwtklihaphoevosyb",
  PROD: "jeyjblxfqqlypxiaznad",
};

function required(value, variableName) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Falta la variable ${variableName}.`);
  return normalized;
}

export function getScriptSupabaseEnvironment() {
  const environment = process.env.NEXT_PUBLIC_APP_ENV;
  if (environment !== "DEV" && environment !== "PROD") {
    throw new Error("NEXT_PUBLIC_APP_ENV debe ser DEV o PROD.");
  }

  const selected =
    environment === "DEV"
      ? {
          url: process.env.NEXT_PUBLIC_SUPABASE_DEV_URL,
          key: process.env.SUPABASE_DEV_SERVICE_ROLE_KEY,
          urlVariable: "NEXT_PUBLIC_SUPABASE_DEV_URL",
          keyVariable: "SUPABASE_DEV_SERVICE_ROLE_KEY",
        }
      : {
          url: process.env.NEXT_PUBLIC_SUPABASE_PROD_URL,
          key: process.env.SUPABASE_PROD_SERVICE_ROLE_KEY,
          urlVariable: "NEXT_PUBLIC_SUPABASE_PROD_URL",
          keyVariable: "SUPABASE_PROD_SERVICE_ROLE_KEY",
        };

  const url = required(selected.url, selected.urlVariable);
  const parsed = new URL(url);
  const expectedHostname = `${PROJECT_REFS[environment]}.supabase.co`;
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHostname) {
    throw new Error(
      `La URL configurada para ${environment} no corresponde al proyecto esperado.`,
    );
  }

  return {
    environment,
    url: parsed.origin,
    serviceRoleKey: required(selected.key, selected.keyVariable),
  };
}
