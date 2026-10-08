import type { DecodedIdToken } from "firebase-admin/auth";

export const STAFF_ROLES = [
  "registration_operator",
  "treasurer",
  "field_officer",
  "information_manager",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type UserRole =
  | "user"
  | "admin"
  | "superadmin"
  | "basecamp_admin"
  | StaffRole
  | "disabled";

export const ROLE_LABELS: Record<UserRole, string> = {
  user: "Pendaki",
  admin: "Admin",
  superadmin: "Superadmin",
  basecamp_admin: "Admin Basecamp",
  registration_operator: "Operator Registrasi",
  treasurer: "Bendahara",
  field_officer: "Petugas Lapangan",
  information_manager: "Pengelola Informasi",
  disabled: "Akun dinonaktifkan",
};

export type Permission =
  | "staff:manage"
  | "basecamp:provision"
  | "registrations:read"
  | "registrations:decide"
  | "manifest:read"
  | "field:checkin"
  | "finance:read"
  | "finance:write"
  | "information:write";

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  user: [],
  admin: [
    "staff:manage",
    "registrations:read",
    "registrations:decide",
    "manifest:read",
    "field:checkin",
    "finance:read",
    "finance:write",
    "information:write",
  ],
  superadmin: [
    "basecamp:provision",
    "registrations:read",
    "registrations:decide",
    "manifest:read",
    "field:checkin",
    "finance:read",
    "finance:write",
    "information:write",
  ],
  basecamp_admin: [
    "staff:manage",
    "registrations:read",
    "registrations:decide",
    "manifest:read",
    "field:checkin",
    "finance:read",
    "finance:write",
    "information:write",
  ],
  registration_operator: ["registrations:read", "registrations:decide"],
  treasurer: ["finance:read", "finance:write"],
  field_officer: ["manifest:read", "field:checkin"],
  information_manager: ["information:write"],
  disabled: [],
};

export function getUserRole(user: DecodedIdToken): UserRole {
  const role = user.role;
  if (
    role === "user" ||
    role === "admin" ||
    role === "superadmin" ||
    role === "basecamp_admin" ||
    role === "registration_operator" ||
    role === "treasurer" ||
    role === "field_officer" ||
    role === "information_manager" ||
    role === "disabled"
  ) {
    return role;
  }
  return role == null ? "user" : "disabled";
}

export function hasPermission(
  user: DecodedIdToken,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[getUserRole(user)].includes(permission);
}

export function getDashboardPath(user: DecodedIdToken): string {
  switch (getUserRole(user)) {
    case "superadmin":
      return "/dashboard/superadmin";
    case "admin":
    case "basecamp_admin":
    case "registration_operator":
    case "treasurer":
    case "field_officer":
    case "information_manager":
      return "/dashboard/admin";
    case "disabled":
      return "/login";
    default:
      return "/dashboard";
  }
}

export function getAssignedBasecampId(
  user: DecodedIdToken,
): string | null {
  return typeof user.basecampId === "string" && user.basecampId.length > 0
    ? user.basecampId
    : null;
}

export function isStaffRole(value: unknown): value is StaffRole {
  return STAFF_ROLES.some((role) => role === value);
}
