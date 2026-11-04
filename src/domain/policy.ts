export type Role = "ADMIN" | "LECTOR" | "LECTOR_SUPER";
export function canManual(role: Role) {
  return role === "ADMIN" || role === "LECTOR_SUPER";
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
