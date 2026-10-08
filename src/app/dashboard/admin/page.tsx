import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getSessionUser } from "@/lib/auth/session";
import {
  getAssignedBasecampId,
  getDashboardPath,
  getUserRole,
  hasPermission,
  ROLE_LABELS,
  type UserRole,
} from "@/lib/auth/roles";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { StaffManager } from "./staff-manager";
import { OperationsWorkspace } from "./operations";
import { AdminDashboardView, type DashboardMetric, type DashboardPanel } from "./dashboard-view";

export const instant = false;

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  user: "",
  admin: "Akses admin lama; semua Basecamp dan operasional tersedia.",
  superadmin: "",
  basecamp_admin: "Kelola operasional dan tim Basecamp Anda dari satu ruang kerja.",
  registration_operator: "Tinjau pengajuan dan bantu pendaki menyiapkan perjalanan.",
  treasurer: "Pantau tagihan, pembayaran, refund, dan transaksi Basecamp.",
  field_officer: "Kelola manifest serta proses check-in dan check-out pendaki.",
  information_manager: "Perbarui informasi gunung, status jalur, kuota, dan pengumuman.",
  disabled: "",
};

async function getDashboardMetrics(
  user: DecodedIdToken,
  role: UserRole,
): Promise<{ metrics: DashboardMetric[]; basecampName: string; error: string }> {
  const canReadRegistrations =
    hasPermission(user, "registrations:read") ||
    hasPermission(user, "manifest:read") ||
    hasPermission(user, "finance:read");
  const canManageStaff = hasPermission(user, "staff:manage");
  const basecampId = getAssignedBasecampId(user);
  const basecampScoped = role !== "admin";

  if (basecampScoped && !basecampId) {
    return {
      metrics: [],
      basecampName: "Basecamp belum ditautkan",
      error: "Akun ini belum terhubung ke Basecamp. Hubungi Superadmin untuk memperbaiki penetapan akun.",
    };
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const basecampRef = basecampId && basecampScoped
      ? firestore.collection("basecamps").doc(basecampId)
      : null;
    const [basecampSnapshot, registrationsSnapshot, staffSnapshot] = await Promise.all([
      basecampRef?.get(),
      canReadRegistrations
        ? (basecampRef
            ? firestore.collection("registrations").where("basecampId", "==", basecampId)
            : firestore.collection("registrations")
          ).get()
        : Promise.resolve(null),
      canManageStaff && basecampRef
        ? basecampRef.collection("staff").count().get()
        : Promise.resolve(null),
    ]);
    if (basecampRef && !basecampSnapshot?.exists) {
      return {
        metrics: [],
        basecampName: "Basecamp tidak ditemukan",
        error: "Data Basecamp untuk akun ini tidak ditemukan. Periksa penetapan Basecamp di pengelolaan platform.",
      };
    }
    const basecampName =
      typeof basecampSnapshot?.get("name") === "string"
        ? basecampSnapshot.get("name")
        : role === "admin"
          ? "Semua Basecamp"
          : "Basecamp";

    const metrics: DashboardMetric[] = [];
    if (registrationsSnapshot) {
      let pending = 0;
      let approved = 0;
      let activeHikers = 0;
      for (const document of registrationsSnapshot.docs) {
        const data = document.data();
        if (data.status === "pending" || data.status === "revision_requested" || data.status === "needs_revision") {
          pending += 1;
        }
        if (data.status === "approved") approved += 1;
        if (data.status === "checked_in" && typeof data.groupSize === "number") {
          activeHikers += data.groupSize;
        }
      }
      metrics.push(
        {
          id: "total-registrations",
          label: "Total pengajuan",
          value: registrationsSnapshot.size.toLocaleString("id-ID"),
          detail: "Seluruh pengajuan pendakian",
          tone: "green",
        },
        {
          id: "pending-registrations",
          label: "Perlu ditinjau",
          value: pending.toLocaleString("id-ID"),
          detail: "Menunggu keputusan pengelola",
          tone: "amber",
        },
        {
          id: "active-hikers",
          label: "Pendaki di jalur",
          value: activeHikers.toLocaleString("id-ID"),
          detail: "Jumlah orang dengan status check-in",
          tone: "blue",
        },
        {
          id: "approved-registrations",
          label: "Siap berangkat",
          value: approved.toLocaleString("id-ID"),
          detail: "Pengajuan yang telah disetujui",
          tone: "violet",
        },
      );
    }
    if (staffSnapshot) {
      metrics.push({
        id: "active-staff",
        label: "Akun staf",
        value: staffSnapshot.data().count.toLocaleString("id-ID"),
        detail: "Terdaftar di Basecamp ini",
        tone: "slate",
      });
    }
    return { metrics, basecampName, error: "" };
  } catch (error) {
    console.error("Could not load admin dashboard metrics:", error);
    return {
      metrics: [],
      basecampName: role === "admin" ? "Semua Basecamp" : "Basecamp",
      error: "Ringkasan belum dapat dimuat. Silakan muat ulang halaman.",
    };
  }
}

export default async function AdminDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const role = getUserRole(user);
  if (role === "superadmin" || role === "user" || role === "disabled") {
    redirect(getDashboardPath(user));
  }

  const canManageStaff = hasPermission(user, "staff:manage");
  const panels: DashboardPanel[] = [];
  if (canManageStaff) {
    panels.push({
      id: "staff-management",
      label: "Manajemen akun",
      detail: "Akun dan hak akses staf",
      icon: "03",
      content: <StaffManager />,
    });
  }
  if (
    hasPermission(user, "registrations:read") ||
    hasPermission(user, "manifest:read") ||
    hasPermission(user, "finance:read")
  ) {
    panels.push({
      id: "registration-operations",
      label: role === "field_officer" ? "Manifest lapangan" : "Pendaftaran",
      detail: role === "field_officer" ? "Check-in dan check-out" : "Permohonan pendakian",
      icon: "04",
      content: <OperationsWorkspace role={role} section="registrations" />,
    });
  }
  if (hasPermission(user, "finance:read")) {
    panels.push({
      id: "finance-operations",
      label: "Keuangan",
      detail: "Tagihan dan transaksi",
      icon: "05",
      content: <OperationsWorkspace role={role} section="finance" />,
    });
  }
  if (hasPermission(user, "information:write")) {
    panels.push({
      id: "information-operations",
      label: "Informasi Basecamp",
      detail: "Gunung dan pengumuman",
      icon: "06",
      content: <OperationsWorkspace role={role} section="information" />,
    });
  }

  const summary = await getDashboardMetrics(user, role);
  const displayName = String(user.name ?? user.username ?? user.email ?? "Admin Basecamp");
  const initials = displayName
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <AdminDashboardView
      roleLabel={ROLE_LABELS[role]}
      roleDescription={ROLE_DESCRIPTIONS[role]}
      displayName={displayName}
      initials={initials || "A"}
      basecampName={summary.basecampName}
      metrics={summary.metrics}
      summaryError={summary.error}
      panels={panels}
    />
  );
}
