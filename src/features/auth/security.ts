export const CORPORATE_EMAIL_DOMAIN = "pro.com.gt";
export const GOOGLE_IDENTITY_SCOPES = "openid email profile";

export type AuthorizedProjectScope = {
  project: { status: string };
  roleCodes: string[];
};

export function safeInternalPath(value: string | null | undefined, fallback = "/") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://internal.invalid");
    if (parsed.origin !== "https://internal.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function hasExactCorporateDomain(value: string | null | undefined) {
  const email = normalizeEmail(value);
  const parts = email.split("@");
  return (
    parts.length === 2 &&
    parts[0].length > 0 &&
    parts[1] === CORPORATE_EMAIL_DOMAIN
  );
}

export function isVerifiedCorporateIdentity(input: {
  email: string | null | undefined;
  emailConfirmedAt: string | null | undefined;
}) {
  return Boolean(input.emailConfirmedAt) && hasExactCorporateDomain(input.email);
}

export function hasAuthorizedApplicationAccess(input: {
  profileActive: boolean;
  isPlatformAdmin: boolean;
  projectScopes: AuthorizedProjectScope[];
}) {
  if (!input.profileActive) return false;
  if (input.isPlatformAdmin) return true;

  return input.projectScopes.some(
    ({ project, roleCodes }) =>
      project.status === "ACTIVE" && roleCodes.length > 0,
  );
}

export function buildTrustedUrl(
  appUrl: string,
  path: string | null | undefined,
  fallback = "/",
) {
  return new URL(safeInternalPath(path, fallback), appUrl);
}

export type AuthErrorCode =
  | "oauth_cancelled"
  | "oauth_failed"
  | "auth_link_invalid"
  | "email_unverified"
  | "domain_not_allowed"
  | "access_denied";

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  oauth_cancelled: "Se canceló el ingreso con Google. Puedes intentarlo nuevamente.",
  oauth_failed: "No fue posible ingresar con Google. Inténtalo nuevamente.",
  auth_link_invalid: "El enlace no es válido o ya expiró. Solicita uno nuevo.",
  email_unverified: "La cuenta de Google debe tener un correo verificado.",
  domain_not_allowed: "Utiliza una cuenta corporativa autorizada.",
  access_denied: "Tu cuenta no tiene acceso activo al sistema.",
};

export function getAuthErrorMessage(value: string | null | undefined) {
  if (!value || !(value in AUTH_ERROR_MESSAGES)) return null;
  return AUTH_ERROR_MESSAGES[value as AuthErrorCode];
}
