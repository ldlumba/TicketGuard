import {
  ADMIN_STORAGE_KEY,
  PROFILES_STORAGE_KEY,
  STORAGE_KEY,
  TICKETS_STORAGE_KEY,
} from "../config";
import type { AdminSettings, SavedEvent, TicketRecord, UserProfile } from "../types";

export function readSavedEvents(): SavedEvent[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedEvent[];
    return Array.isArray(parsed) ? parsed.map(normalizeEvent) : [];
  } catch {
    return [];
  }
}

export function writeSavedEvents(events: SavedEvent[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export function readProfiles(): UserProfile[] {
  try {
    const raw = window.localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserProfile[];
    return Array.isArray(parsed)
      ? parsed.map((profile) => ({
          ...profile,
          email: profile.email ?? profile.contact ?? "",
        }))
      : [];
  } catch {
    return [];
  }
}

export function writeProfiles(profiles: UserProfile[]) {
  window.localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function readTickets(): TicketRecord[] {
  try {
    const raw = window.localStorage.getItem(TICKETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TicketRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTickets(tickets: TicketRecord[]) {
  window.localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(tickets));
}

export function readAdminSettings(): AdminSettings {
  try {
    const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!raw) return { adminAddresses: [], reviewRequired: true };
    const parsed = JSON.parse(raw) as AdminSettings;
    return {
      adminAddresses: Array.isArray(parsed.adminAddresses)
        ? parsed.adminAddresses
        : [],
      reviewRequired: parsed.reviewRequired ?? true,
    };
  } catch {
    return { adminAddresses: [], reviewRequired: true };
  }
}

export function writeAdminSettings(settings: AdminSettings) {
  window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeEvent(event: SavedEvent): SavedEvent {
  const now = Date.now();
  return {
    ...event,
    description: event.description ?? "",
    venue: event.venue ?? "Campus Auditorium",
    campus: event.campus ?? "University Campus",
    category: event.category ?? "Campus Event",
    capacity: event.capacity ?? 100,
    sold: event.sold ?? 0,
    organizerName: event.organizerName ?? "Organizer",
    organizerContact: event.organizerContact ?? "",
    status: event.status ?? "published",
    hero: event.hero ?? "concert",
    updatedAt: event.updatedAt ?? event.createdAt ?? now,
    contractCreated: event.contractCreated ?? true,
  };
}
