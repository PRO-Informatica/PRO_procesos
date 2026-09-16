import "server-only";

import { getPublicEnvironment, type PublicEnvironment } from "@/lib/env";

export type PrivilegedEnvironment = PublicEnvironment & {
  supabaseServiceRoleKey: string;
};

export function getPrivilegedEnvironment(): PrivilegedEnvironment {
  const environment = getPublicEnvironment();
  const serviceRoleKeys = {
    DEV: process.env.SUPABASE_DEV_SERVICE_ROLE_KEY,
    PROD: process.env.SUPABASE_PROD_SERVICE_ROLE_KEY,
  };
  const variableName =
    environment.appEnvironment === "DEV"
      ? "SUPABASE_DEV_SERVICE_ROLE_KEY"
      : "SUPABASE_PROD_SERVICE_ROLE_KEY";
  const serviceRoleKey = serviceRoleKeys[environment.appEnvironment]?.trim();

  if (!serviceRoleKey) {
    throw new Error(`Falta la variable server-side ${variableName}.`);
  }

  return { ...environment, supabaseServiceRoleKey: serviceRoleKey };
}
