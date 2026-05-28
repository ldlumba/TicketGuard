export type WalletState = {
  address: string;
  network: string;
  networkPassphrase: string;
  connected: boolean;
};

export type AccountRole = "student" | "organizer" | "admin";

export type UserProfile = {
  address: string;
  role: AccountRole;
  displayName: string;
  school: string;
  email: string;
  contact: string;
  password?: string;
  createdAt: number;
};

export type EventStatus =
  | "draft"
  | "review"
  | "published"
  | "paused"
  | "held"
  | "cancelled"
  | "released";

export type SavedEvent = {
  id: number;
  name: string;
  description: string;
  venue: string;
  campus: string;
  category: string;
  capacity: number;
  sold: number;
  ticketPrice: string;
  deadline: number;
  organizer: string;
  organizerName: string;
  organizerContact: string;
  status: EventStatus;
  hero: string;
  createdAt: number;
  updatedAt: number;
  contractCreated: boolean;
};

export type TicketRecord = {
  id: string;
  eventId: number;
  attendee: string;
  attendeeName: string;
  amount: string;
  status: "active" | "refunded" | "released" | "simulated_refund";
  txHash: string;
  createdAt: number;
  updatedAt: number;
};

export type AdminSettings = {
  adminAddresses: string[];
  reviewRequired: boolean;
};

export type Totals = {
  totalCollected: bigint | null;
  myBalance: bigint | null;
};

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};
