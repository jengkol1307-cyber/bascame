import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

export type HikerRegistrationInput = {
  mountainId: string;
  startDate: string;
  endDate: string;
  days: string[];
  groupSize: number;
  memberNames: string[];
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
};

type CapacityReservation = {
  mountainId: string;
  days: string[];
};

const CAPACITY_HOLDING_STATUSES = new Set([
  "pending",
  "revision_requested",
  "needs_revision",
  "approved",
  "checked_in",
]);

export function getTripDays(startDate: unknown, endDate: unknown): string[] | null {
  if (
    typeof startDate !== "string" ||
    typeof endDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    return null;
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== startDate ||
    end.toISOString().slice(0, 10) !== endDate ||
    end < start ||
    end.getTime() - start.getTime() > 14 * 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  const days: string[] = [];
  for (let timestamp = start.getTime(); timestamp <= end.getTime(); timestamp += 86400000) {
    days.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return days;
}

export function parseHikerRegistrationInput(
  body: Record<string, unknown>,
): HikerRegistrationInput | null {
  if (
    typeof body.mountainId !== "string" ||
    !body.mountainId.trim() ||
    body.mountainId.includes("/") ||
    body.mountainId.trim() === "." ||
    body.mountainId.trim() === ".." ||
    body.mountainId.length > 512 ||
    typeof body.startDate !== "string" ||
    typeof body.endDate !== "string" ||
    typeof body.groupSize !== "number" ||
    !Number.isInteger(body.groupSize) ||
    body.groupSize < 1 ||
    body.groupSize > 20 ||
    (body.groupSize > 1 &&
      (!Array.isArray(body.memberNames) || body.memberNames.length !== body.groupSize - 1)) ||
    (body.memberNames !== undefined &&
      (!Array.isArray(body.memberNames) || body.memberNames.length !== body.groupSize - 1 ||
        body.memberNames.some((name) =>
          typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80,
        ))) ||
    typeof body.emergencyContactName !== "string" ||
    typeof body.emergencyContactPhone !== "string" ||
    (body.notes !== undefined && typeof body.notes !== "string")
  ) {
    return null;
  }

  const startDate = body.startDate;
  const endDate = body.endDate;
  const days = getTripDays(startDate, endDate);
  if (!days) return null;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (start < today) return null;

  const emergencyContactName = body.emergencyContactName.trim();
  const emergencyContactPhone = body.emergencyContactPhone.trim();
  const memberNames = Array.isArray(body.memberNames)
    ? body.memberNames
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
    : [];
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (
    emergencyContactName.length < 2 ||
    emergencyContactName.length > 80 ||
    emergencyContactPhone.length < 6 ||
    emergencyContactPhone.length > 32 ||
    notes.length > 500
  ) {
    return null;
  }

  return {
    mountainId: body.mountainId.trim(),
    startDate,
    endDate,
    days,
    groupSize: body.groupSize,
    memberNames,
    emergencyContactName,
    emergencyContactPhone,
    notes,
  };
}

export function isMountainOpenForRegistration(status: unknown): boolean {
  if (typeof status !== "string") return false;
  return ["buka", "dibuka", "open"].includes(status.trim().toLocaleLowerCase("id-ID"));
}

export function getCapacityLockRefs(
  firestore: Firestore,
  reservations: CapacityReservation[],
) {
  const lockRefs = new Map<string, DocumentReference>();
  for (const reservation of reservations) {
    for (const day of reservation.days) {
      const ref = firestore
        .collection("mountains")
        .doc(reservation.mountainId)
        .collection("capacityLocks")
        .doc(day);
      lockRefs.set(ref.path, ref);
    }
  }
  return [...lockRefs.values()];
}

export async function readCapacityLocks(
  transaction: Transaction,
  lockRefs: ReturnType<typeof getCapacityLockRefs>,
) {
  await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
}

export function touchCapacityLocks(
  transaction: Transaction,
  lockRefs: ReturnType<typeof getCapacityLockRefs>,
) {
  for (const ref of lockRefs) {
    transaction.set(ref, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

export function isCapacityAvailable({
  registrations,
  days,
  groupSize,
  quota,
  excludeId,
}: {
  registrations: FirebaseFirestore.QuerySnapshot;
  days: string[];
  groupSize: number;
  quota: unknown;
  excludeId?: string;
}): boolean {
  if (quota == null) return true;
  if (typeof quota !== "number" || !Number.isSafeInteger(quota) || quota < 0) return false;

  const reservedByDay = new Map(days.map((day) => [day, 0]));
  for (const document of registrations.docs) {
    if (document.id === excludeId) continue;
    const data = document.data();
    if (!CAPACITY_HOLDING_STATUSES.has(String(data.status))) continue;
    if (typeof data.startDate !== "string" || typeof data.endDate !== "string") continue;
    if (typeof data.groupSize !== "number" || !Number.isSafeInteger(data.groupSize)) continue;

    for (const day of days) {
      if (data.startDate <= day && day <= data.endDate) {
        reservedByDay.set(day, (reservedByDay.get(day) ?? 0) + data.groupSize);
      }
    }
  }

  return [...reservedByDay.values()].every((reserved) => reserved + groupSize <= quota);
}
