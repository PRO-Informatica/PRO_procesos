"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { PlatformUserActionState } from "./types";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readRawText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readUuidList(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string" && isUuid(value));
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function actionError(
  message: string,
  fields?: PlatformUserActionState["fields"],
): PlatformUserActionState {
  return { status: "error", message, fields };
}

async function authorizePlatformAction() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (error || !userId || !(await isPlatformAdmin(userId))) {
    return null;
  }

  return { supabase, userId };
}

function authInviteErrorMessage(error: { status?: number; code?: string; message: string }) {
  const message = `${error.code ?? ""} ${error.message}`.toLocaleLowerCase();

  if (
    error.status === 422 ||
    message.includes("already") ||
    message.includes("exists") ||
    message.includes("registered")
  ) {
    return "Ya existe un usuario registrado con ese correo electrónico.";
  }

  if (error.status === 429 || message.includes("rate")) {
    return "Se alcanzó temporalmente el límite de invitaciones. Intenta más tarde.";
  }

  return "No fue posible enviar la invitación. Verifica el correo e intenta nuevamente.";
}

function authCreateErrorMessage(error: { status?: number; code?: string; message: string }) {
  const message = `${error.code ?? ""} ${error.message}`.toLocaleLowerCase();

  if (
    error.status === 422 ||
    message.includes("already") ||
    message.includes("exists") ||
    message.includes("registered")
  ) {
    return "Ya existe un usuario registrado con ese correo electrónico.";
  }

  if (message.includes("password") || message.includes("weak")) {
    return "La contraseña no cumple los requisitos de seguridad.";
  }

  if (error.status === 429 || message.includes("rate")) {
    return "Se alcanzó temporalmente el límite de creación de usuarios. Intenta más tarde.";
  }

  return "No fue posible crear el usuario. Verifica los datos e intenta nuevamente.";
}

function rpcErrorMessage(error: { message: string }) {
  const message = error.message.toUpperCase();

  if (message.includes("CANNOT_DISABLE_SELF")) {
    return "No puedes desactivar tu propio usuario de plataforma.";
  }

  if (message.includes("USER_NOT_FOUND")) {
    return "El usuario ya no existe o no está disponible.";
  }

  if (message.includes("USER_NOT_ACTIVE")) {
    return "El usuario debe estar activo antes de administrar sus accesos.";
  }

  if (message.includes("COMPANY_NOT_ACTIVE")) {
    return "La empresa seleccionada no está activa.";
  }

  if (message.includes("PROJECT_NOT_ACTIVE")) {
    return "El proyecto seleccionado no está activo.";
  }

  if (message.includes("PROJECT_COMPANY_MISMATCH")) {
    return "El proyecto no pertenece a la empresa seleccionada.";
  }

  if (message.includes("MEMBERSHIP_NOT_FOUND") || message.includes("MEMBER_NOT_ACTIVE")) {
    return "La relación seleccionada ya no está activa o no existe.";
  }

  if (message.includes("INVALID_COMPANY_ROLE") || message.includes("INVALID_PROJECT_ROLE")) {
    return "El rol seleccionado no corresponde al ámbito solicitado.";
  }

  if (message.includes("ROLE_ASSIGNMENT_NOT_FOUND")) {
    return "La asignación de rol ya no existe.";
  }

  if (message.includes("COMPANY_ADMIN_ROLE_NOT_FOUND")) {
    return "El rol Company Admin no está disponible en la configuración actual.";
  }

  if (message.includes("PERMISSION_DENIED")) {
    return "No tienes autorización para realizar esta acción.";
  }

  return "No fue posible completar la operación. Intenta nuevamente.";
}

function revalidateUserAccess(userId: string, companyId?: string) {
  revalidatePath("/platform/users");
  revalidatePath(`/platform/users/${userId}`);
  revalidatePath("/platform/companies");
  if (companyId) revalidatePath(`/platform/companies/${companyId}`);
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("origin") ??
    `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${
      requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
    }`
  );
}

export async function invitePlatformUser(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const email = readText(formData, "email").toLocaleLowerCase();
  const fullName = readText(formData, "fullName").replace(/\s+/g, " ");
  const fields = { email, fullName };

  if (!isEmail(email)) {
    return actionError("Ingresa un correo electrónico válido.", fields);
  }

  if (email.length > 254) {
    return actionError("El correo electrónico es demasiado largo.", fields);
  }

  if (fullName.length < 2 || fullName.length > 160) {
    return actionError("El nombre debe tener entre 2 y 160 caracteres.", fields);
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para invitar usuarios.", fields);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });

  if (error || !data.user) {
    return actionError(
      authInviteErrorMessage(
        error ?? { message: "Auth Admin no devolvió el usuario invitado." },
      ),
      fields,
    );
  }

  const { error: auditError } = await admin.from("audit_events").insert({
    actor_user_id: authorization.userId,
    entity_type: "user",
    entity_id: data.user.id,
    action: "USER_INVITED",
    new_values: {
      email,
      full_name: fullName,
    },
  });

  revalidatePath("/platform/users");
  revalidatePath(`/platform/users/${data.user.id}`);

  if (auditError) {
    return actionError(
      "La invitación fue enviada, pero no fue posible registrar su auditoría. Repórtalo antes de continuar.",
    );
  }

  return {
    status: "success",
    message: `Invitación enviada a ${email}.`,
  };
}

export async function createPlatformUserWithPassword(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const email = readText(formData, "email").toLocaleLowerCase();
  const fullName = readText(formData, "fullName").replace(/\s+/g, " ");
  const password = readRawText(formData, "password");
  const passwordConfirmation = readRawText(formData, "passwordConfirmation");
  const fields = { email, fullName };

  if (!isEmail(email)) {
    return actionError("Ingresa un correo electrónico válido.", fields);
  }
  if (email.length > 254) {
    return actionError("El correo electrónico es demasiado largo.", fields);
  }
  if (fullName.length < 2 || fullName.length > 160) {
    return actionError("El nombre debe tener entre 2 y 160 caracteres.", fields);
  }
  if (password.length < 8 || password.length > 128) {
    return actionError("La contraseña debe tener entre 8 y 128 caracteres.", fields);
  }
  if (password !== passwordConfirmation) {
    return actionError("Las contraseñas no coinciden.", fields);
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para crear usuarios.", fields);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error || !data.user) {
    return actionError(
      authCreateErrorMessage(
        error ?? { message: "Auth Admin no devolvió el usuario creado." },
      ),
      fields,
    );
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({ full_name: fullName, active: true, updated_at: new Date().toISOString() })
    .eq("id", data.user.id)
    .select("id")
    .maybeSingle();
  const { error: auditError } = await admin.from("audit_events").insert({
    actor_user_id: authorization.userId,
    entity_type: "user",
    entity_id: data.user.id,
    action: "USER_CREATED_WITH_PASSWORD",
    new_values: {
      email,
      full_name: fullName,
      email_confirmed: true,
      creation_method: "ADMIN_PASSWORD",
    },
  });

  revalidatePath("/platform/users");
  revalidatePath(`/platform/users/${data.user.id}`);

  if (!profile || profileError || auditError) {
    return actionError(
      "El usuario fue creado y ya puede ingresar, pero no fue posible completar su perfil o auditoría. Repórtalo antes de asignarle accesos.",
    );
  }

  return {
    status: "success",
    message: `Usuario ${email} creado. Ya puede iniciar sesión con la contraseña definida.`,
  };
}

export async function setPlatformUserStatus(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const activeValue = readText(formData, "active");

  if (!isUuid(userId) || !["true", "false"].includes(activeValue)) {
    return actionError("La solicitud de cambio de estado no es válida.");
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para cambiar el estado del usuario.");
  }

  const { error } = await authorization.supabase.rpc("platform_set_user_active", {
    p_user_id: userId,
    p_active: activeValue === "true",
  });

  if (error) {
    return actionError(rpcErrorMessage(error));
  }

  revalidatePath("/platform/users");
  revalidatePath(`/platform/users/${userId}`);

  return {
    status: "success",
    message:
      activeValue === "true"
        ? "El usuario fue activado correctamente."
        : "El usuario fue desactivado sin eliminar su historial.",
  };
}

export async function assignPlatformCompanyAdmin(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const companyId = readText(formData, "companyId");
  const fields = { companyId };

  if (!isUuid(userId) || !isUuid(companyId)) {
    return actionError("Selecciona una empresa válida.", fields);
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para asignar Company Admin.", fields);
  }

  const { error } = await authorization.supabase.rpc(
    "platform_assign_company_admin",
    {
      p_company_id: companyId,
      p_user_id: userId,
    },
  );

  if (error) {
    return actionError(rpcErrorMessage(error), fields);
  }

  revalidatePath("/platform/users");
  revalidatePath(`/platform/users/${userId}`);
  revalidatePath("/platform/companies");
  revalidatePath(`/platform/companies/${companyId}`);

  return {
    status: "success",
    message: "El usuario ahora es Company Admin de la empresa seleccionada.",
  };
}

export async function updatePlatformUserProfile(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const fullName = readText(formData, "fullName").replace(/\s+/g, " ");
  const fields = { fullName };

  if (!isUuid(userId) || fullName.length < 2 || fullName.length > 160) {
    return actionError("El nombre debe tener entre 2 y 160 caracteres.", fields);
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para editar usuarios.", fields);
  }

  const { error } = await authorization.supabase.rpc("platform_update_user_profile", {
    p_user_id: userId,
    p_full_name: fullName,
  });

  if (error) return actionError(rpcErrorMessage(error), fields);

  revalidateUserAccess(userId);
  return { status: "success", message: "La información fue actualizada." };
}

export async function requestPlatformPasswordReset(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  if (!isUuid(userId)) return actionError("El usuario solicitado no es válido.");

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para restablecer contraseñas.");
  }

  const admin = createAdminClient();
  const { data, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = data.user?.email;

  if (userError || !email) {
    return actionError("No fue posible obtener el correo del usuario.");
  }

  const origin = await getRequestOrigin();
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) {
    return actionError("No fue posible enviar el enlace de restablecimiento.");
  }

  const { error: auditError } = await admin.from("audit_events").insert({
    actor_user_id: authorization.userId,
    entity_type: "user",
    entity_id: userId,
    action: "USER_PASSWORD_RESET_REQUESTED",
    new_values: { method: "RECOVERY_EMAIL" },
  });

  revalidateUserAccess(userId);
  if (auditError) {
    return actionError(
      "El enlace fue enviado, pero no fue posible registrar la auditoría. Repórtalo antes de continuar.",
    );
  }

  return { status: "success", message: "Enlace de restablecimiento enviado." };
}

export async function setPlatformUserPassword(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const password = readRawText(formData, "password");
  const confirmation = readRawText(formData, "passwordConfirmation");

  if (!isUuid(userId)) return actionError("El usuario solicitado no es válido.");
  if (password.length < 8 || password.length > 128) {
    return actionError("La contraseña debe tener entre 8 y 128 caracteres.");
  }
  if (password !== confirmation) {
    return actionError("Las contraseñas no coinciden.");
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) {
    return actionError("No tienes autorización para cambiar contraseñas.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return actionError("No fue posible establecer la nueva contraseña.");

  const { error: auditError } = await admin.from("audit_events").insert({
    actor_user_id: authorization.userId,
    entity_type: "user",
    entity_id: userId,
    action: "USER_PASSWORD_RESET_BY_PLATFORM_ADMIN",
    new_values: { method: "ADMIN_RESET" },
  });

  revalidateUserAccess(userId);
  if (auditError) {
    return actionError(
      "La contraseña cambió, pero no fue posible registrar la auditoría. Repórtalo inmediatamente.",
    );
  }

  return { status: "success", message: "La contraseña fue actualizada." };
}

export async function assignPlatformCompany(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const companyId = readText(formData, "companyId");
  const roleIds = readUuidList(formData, "roleIds");
  const fields = { companyId };

  if (!isUuid(userId) || !isUuid(companyId)) {
    return actionError("Selecciona una empresa válida.", fields);
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) return actionError("No tienes autorización para asignar empresas.");

  const { data: membershipId, error } = await authorization.supabase.rpc(
    "platform_set_company_membership",
    { p_company_id: companyId, p_user_id: userId, p_active: true },
  );
  if (error || typeof membershipId !== "string") {
    return actionError(error ? rpcErrorMessage(error) : "No se recibió la relación creada.", fields);
  }

  for (const roleId of roleIds) {
    const { error: roleError } = await authorization.supabase.rpc(
      "platform_assign_company_role",
      { p_company_member_id: membershipId, p_role_id: roleId },
    );
    if (roleError) return actionError(rpcErrorMessage(roleError), fields);
  }

  revalidateUserAccess(userId, companyId);
  return {
    status: "success",
    message: roleIds.length
      ? "Empresa y roles asignados correctamente."
      : "Membership de empresa asignada correctamente.",
  };
}

export async function setPlatformCompanyMembership(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const companyId = readText(formData, "companyId");
  const activeValue = readText(formData, "active");
  if (!isUuid(userId) || !isUuid(companyId) || !["true", "false"].includes(activeValue)) {
    return actionError("La solicitud de membership no es válida.");
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) return actionError("No tienes autorización para modificar memberships.");

  const active = activeValue === "true";
  const { error } = await authorization.supabase.rpc("platform_set_company_membership", {
    p_company_id: companyId,
    p_user_id: userId,
    p_active: active,
  });
  if (error) return actionError(rpcErrorMessage(error));

  revalidateUserAccess(userId, companyId);
  return {
    status: "success",
    message: active
      ? "Membership reactivada. Los roles históricos no fueron restaurados."
      : "Membership desactivada junto con sus accesos activos relacionados.",
  };
}

export async function setPlatformCompanyRole(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const membershipId = readText(formData, "membershipId");
  const roleId = readText(formData, "roleId");
  const assignmentId = readText(formData, "assignmentId");
  const active = readText(formData, "active") === "true";
  if (!isUuid(userId) || !isUuid(membershipId) || !isUuid(roleId)) {
    return actionError("La asignación de rol no es válida.");
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) return actionError("No tienes autorización para modificar roles.");

  const { error } = active
    ? await authorization.supabase.rpc("platform_assign_company_role", {
        p_company_member_id: membershipId,
        p_role_id: roleId,
      })
    : isUuid(assignmentId)
      ? await authorization.supabase.rpc("platform_revoke_company_role", {
          p_assignment_id: assignmentId,
        })
      : { error: { message: "ROLE_ASSIGNMENT_NOT_FOUND" } };
  if (error) return actionError(rpcErrorMessage(error));

  revalidateUserAccess(userId);
  return { status: "success", message: active ? "Rol asignado." : "Rol revocado y conservado en historial." };
}

export async function assignPlatformProject(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const companyId = readText(formData, "companyId");
  const projectId = readText(formData, "projectId");
  const roleIds = readUuidList(formData, "roleIds");
  const fields = { companyId, projectId };
  if (!isUuid(userId) || !isUuid(companyId) || !isUuid(projectId)) {
    return actionError("Selecciona una empresa y un proyecto válidos.", fields);
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) return actionError("No tienes autorización para asignar proyectos.");

  const { data: membershipId, error } = await authorization.supabase.rpc(
    "platform_set_project_membership",
    { p_company_id: companyId, p_project_id: projectId, p_user_id: userId, p_active: true },
  );
  if (error || typeof membershipId !== "string") {
    return actionError(error ? rpcErrorMessage(error) : "No se recibió la relación creada.", fields);
  }

  for (const roleId of roleIds) {
    const { error: roleError } = await authorization.supabase.rpc(
      "platform_assign_project_role",
      { p_project_member_id: membershipId, p_role_id: roleId },
    );
    if (roleError) return actionError(rpcErrorMessage(roleError), fields);
  }

  revalidateUserAccess(userId, companyId);
  return {
    status: "success",
    message: roleIds.length
      ? "Proyecto y roles asignados correctamente."
      : "Membership de proyecto asignada correctamente.",
  };
}

export async function setPlatformProjectMembership(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const companyId = readText(formData, "companyId");
  const projectId = readText(formData, "projectId");
  const activeValue = readText(formData, "active");
  if (
    !isUuid(userId) ||
    !isUuid(companyId) ||
    !isUuid(projectId) ||
    !["true", "false"].includes(activeValue)
  ) {
    return actionError("La solicitud de membership no es válida.");
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) return actionError("No tienes autorización para modificar memberships.");

  const active = activeValue === "true";
  const { error } = await authorization.supabase.rpc("platform_set_project_membership", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_user_id: userId,
    p_active: active,
  });
  if (error) return actionError(rpcErrorMessage(error));

  revalidateUserAccess(userId, companyId);
  return {
    status: "success",
    message: active
      ? "Membership reactivada. Los roles históricos no fueron restaurados."
      : "Membership de proyecto desactivada; sus roles activos fueron revocados.",
  };
}

export async function setPlatformProjectRole(
  _previousState: PlatformUserActionState,
  formData: FormData,
): Promise<PlatformUserActionState> {
  const userId = readText(formData, "userId");
  const membershipId = readText(formData, "membershipId");
  const roleId = readText(formData, "roleId");
  const assignmentId = readText(formData, "assignmentId");
  const active = readText(formData, "active") === "true";
  if (!isUuid(userId) || !isUuid(membershipId) || !isUuid(roleId)) {
    return actionError("La asignación de rol no es válida.");
  }

  const authorization = await authorizePlatformAction();
  if (!authorization) return actionError("No tienes autorización para modificar roles.");

  const { error } = active
    ? await authorization.supabase.rpc("platform_assign_project_role", {
        p_project_member_id: membershipId,
        p_role_id: roleId,
      })
    : isUuid(assignmentId)
      ? await authorization.supabase.rpc("platform_revoke_project_role", {
          p_assignment_id: assignmentId,
        })
      : { error: { message: "ROLE_ASSIGNMENT_NOT_FOUND" } };
  if (error) return actionError(rpcErrorMessage(error));

  revalidateUserAccess(userId);
  return { status: "success", message: active ? "Rol asignado." : "Rol revocado y conservado en historial." };
}
