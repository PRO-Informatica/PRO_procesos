const actionLabels: Record<string, string> = {
  COMPANY_ADMIN_ASSIGNED: "Administrador de empresa asignado",
  COMPANY_CREATED_BY_PLATFORM_ADMIN: "Empresa creada",
  COMPANY_DISABLED: "Empresa desactivada",
  COMPANY_ENABLED: "Empresa activada",
  COMPANY_MEMBERSHIP_CREATED: "Membresía de empresa creada",
  COMPANY_MEMBERSHIP_DISABLED: "Membresía de empresa desactivada",
  COMPANY_MEMBERSHIP_REACTIVATED: "Membresía de empresa reactivada",
  COMPANY_ROLE_ASSIGNED: "Rol de empresa asignado",
  COMPANY_ROLE_REVOKED: "Rol de empresa revocado",
  DISPATCH_REGISTERED: "Despacho registrado",
  GUIDE_WEEKLY_BATCH_ROLLOVER: "Guía trasladada al lote siguiente",
  INVOICE_AUTO_MATCH_APPROVED: "Factura aprobada automáticamente",
  INVOICE_SENT_TO_REINVOICING: "Factura enviada a refacturación",
  PROJECT_MEMBERSHIP_CREATED: "Membresía de proyecto creada",
  PROJECT_MEMBERSHIP_DISABLED: "Membresía de proyecto desactivada",
  PROJECT_MEMBERSHIP_REACTIVATED: "Membresía de proyecto reactivada",
  PROJECT_ROLE_ASSIGNED: "Rol de proyecto asignado",
  PROJECT_ROLE_REVOKED: "Rol de proyecto revocado",
  USER_DISABLED: "Usuario desactivado",
  USER_ENABLED: "Usuario activado",
  USER_INVITED: "Usuario invitado",
  USER_PASSWORD_RESET_BY_PLATFORM_ADMIN: "Contraseña actualizada por plataforma",
  USER_PASSWORD_RESET_REQUESTED: "Recuperación de contraseña solicitada",
  USER_PROFILE_UPDATED: "Perfil de usuario actualizado",
  WEEKLY_BATCH_CLOSED_AFTER_ROLLOVER: "Lote semanal cerrado tras rollover",
};

const entityLabels: Record<string, string> = {
  batch: "Lote",
  company: "Empresa",
  company_member: "Membresía de empresa",
  company_member_role: "Rol de empresa",
  dispatch: "Despacho",
  dispatch_guide: "Guía de despacho",
  invoice: "Factura",
  profile: "Perfil de usuario",
  project_member: "Membresía de proyecto",
  project_member_role: "Rol de proyecto",
  user: "Usuario",
};

function titleFromCode(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .toLocaleLowerCase("es-GT")
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("es-GT"));
}

export function formatAuditAction(action: string) {
  return actionLabels[action] ?? titleFromCode(action);
}

export function formatAuditEntity(entityType: string) {
  return entityLabels[entityType] ?? titleFromCode(entityType);
}

const auditDateFormatter = new Intl.DateTimeFormat("es-GT", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Guatemala",
});

export function formatAuditDate(value: string) {
  return auditDateFormatter.format(new Date(value));
}
