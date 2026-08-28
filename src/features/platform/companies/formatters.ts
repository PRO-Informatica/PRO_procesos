export function formatDate(value: string | null, includeTime = false) {
  if (!value) return "No definida";

  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}
