import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  ExternalLink,
  Landmark,
  Link2,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  CONTRACT_ID,
  EXPLORER_CONTRACT_URL,
  explorerTxUrl,
  NETWORK_NAME,
} from "./config";
import {
  readAdminSettings,
  readProfiles,
  readSavedEvents,
  readTickets,
  writeAdminSettings,
  writeProfiles,
  writeSavedEvents,
  writeTickets,
} from "./lib/storage";
import {
  connectWallet,
  getClient,
  isTestnet,
  loadWalletState,
  submitTransaction,
} from "./lib/stellar";
import type {
  AdminSettings,
  EventStatus,
  SavedEvent,
  TicketRecord,
  Toast,
  ToastKind,
  Totals,
  UserProfile,
  WalletState,
} from "./types";

const EMPTY_TOTALS: Totals = { totalCollected: null, myBalance: null };
const ADMIN_LOGIN = {
  username: "admin",
  email: "admin@admin.com",
  password: "admin123",
};
const DEFAULT_STUDENT: UserProfile = {
  address: "dean@email.com",
  role: "student",
  displayName: "Dean",
  school: "Campus Demo",
  email: "dean@email.com",
  contact: "",
  password: "password123",
  createdAt: Date.now(),
};

type View = "marketplace" | "myTickets" | "organizer" | "admin";

const starterEvents: SavedEvent[] = [
  {
    id: 0,
    name: "Foundation Week Concert",
    description:
      "A student council concert demo event. Sync it on-chain before accepting ticket purchases.",
    venue: "Main Auditorium",
    campus: "Pampanga State University",
    category: "Concert",
    capacity: 300,
    sold: 0,
    ticketPrice: "200",
    deadline: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
    organizer: "Demo organizer",
    organizerName: "Student Council",
    organizerContact: "sc@example.edu.ph",
    status: "draft",
    hero: "concert",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    contractCreated: false,
  },
];

function shortAddress(value: string) {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function formatUnits(value: bigint | null) {
  if (value === null) return "-";
  return value.toLocaleString("en-PH");
}

function formatDeadline(value: number) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000));
}

function deadlineFromLocal(value: string) {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : 0;
}

function statusLabel(status: EventStatus) {
  return {
    draft: "Draft",
    review: "In Review",
    published: "Selling",
    paused: "Paused",
    held: "Held",
    cancelled: "Cancelled",
    released: "Released",
  }[status];
}

function eventAvailability(event: SavedEvent) {
  if (!event.contractCreated) return "Needs on-chain setup";
  if (event.status === "paused") return "Sales paused";
  if (event.status === "cancelled") return "Cancelled - refunds available";
  if (event.status === "held") return "Awaiting organizer release";
  if (event.status === "released") return "Funds released";
  if (event.deadline <= Math.floor(Date.now() / 1000)) return "Sales closed";
  return `${Math.max(event.capacity - event.sold, 0)} seats left`;
}

function isEventPurchasable(event: SavedEvent) {
  return (
    event.contractCreated &&
    event.status === "published" &&
    event.sold < event.capacity &&
    event.deadline > Math.floor(Date.now() / 1000)
  );
}

function purchaseLabel(event: SavedEvent) {
  if (!event.contractCreated) return "Not Ready";
  if (event.status === "paused") return "Paused";
  if (event.status !== "published") return "Closed";
  if (event.sold >= event.capacity) return "Sold Out";
  if (event.deadline <= Math.floor(Date.now() / 1000)) return "Closed";
  return "Pay";
}

function canReleaseEvent(event: SavedEvent) {
  return (
    event.contractCreated &&
    event.status === "held" &&
    event.sold > 0 &&
    event.deadline > Math.floor(Date.now() / 1000)
  );
}

function refundOpenForEvent(event: SavedEvent | undefined) {
  if (!event || event.status === "released") return false;
  return event.status === "cancelled" || Date.now() / 1000 > event.deadline;
}

function ticketStatusLabel(ticket: TicketRecord, event: SavedEvent | undefined) {
  if (ticket.status === "simulated_refund") {
    return "Demo refund - not submitted on-chain";
  }
  if (ticket.status === "refunded") return "Refunded on testnet";
  if (ticket.status === "released") return "Funds released to organizer";
  if (event?.status === "cancelled") return "Event cancelled";
  if (event && Date.now() / 1000 <= event.deadline) {
    return `Refunds open after ${formatDeadline(event.deadline)}`;
  }
  return "Refunds available";
}

function isOrganizer(profile: UserProfile | null) {
  return profile?.role === "admin";
}

function App() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [adminSettings, setAdminSettings] = useState<AdminSettings>({
    adminAddresses: [],
    reviewRequired: true,
  });
  const [selectedId, setSelectedId] = useState(0);
  const [view, setView] = useState<View>("marketplace");
  const [query, setQuery] = useState("");
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [busy, setBusy] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastHash, setLastHash] = useState("");
  const [activeAddress, setActiveAddress] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | "admin">("login");
  const [authLoading, setAuthLoading] = useState(false);

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });
  const [adminLoginForm, setAdminLoginForm] = useState({
    username: "",
    email: "",
    password: "",
  });
  const [registerForm, setRegisterForm] = useState({
    displayName: "",
    school: "",
    email: "",
    password: "",
    confirmPassword: "",
    contact: "",
  });
  const [eventForm, setEventForm] = useState({
    expectedId: "0",
    name: "Campus Night",
    description: "Ticketed campus event protected by TicketGuard escrow.",
    venue: "Main Auditorium",
    campus: "University of the Philippines",
    category: "Concert",
    capacity: "150",
    ticketPrice: "200",
    deadline: "",
  });

  const profile = useMemo(
    () => profiles.find((item) => item.address === activeAddress) ?? null,
    [activeAddress, profiles],
  );

  const isAdmin = profile?.role === "admin";

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0],
    [events, selectedId],
  );

  const myTickets = useMemo(
    () => tickets.filter((ticket) => ticket.attendee === wallet?.address),
    [tickets, wallet?.address],
  );

  const visibleEvents = useMemo(() => {
    const searchable = query.trim().toLowerCase();
    return events.filter((event) => {
      const matchesSearch =
        !searchable ||
        `${event.name} ${event.campus} ${event.category} ${event.venue}`
          .toLowerCase()
          .includes(searchable);
      const visible =
        event.status === "published" ||
        event.status === "paused" ||
        event.status === "held" ||
        event.status === "cancelled" ||
        event.status === "released" ||
        isAdmin ||
        event.organizer === wallet?.address;
      return matchesSearch && visible;
    });
  }, [events, isAdmin, query, wallet?.address]);

  const organizerEvents = useMemo(
    () =>
      events.filter(
        (event) => event.organizer === wallet?.address || (isAdmin && view === "admin"),
      ),
    [events, isAdmin, view, wallet?.address],
  );

  const networkReady = isTestnet(wallet);
  const hasAccount = Boolean(profile);
  const canUseContract = Boolean(wallet?.address && networkReady && profile);
  const registerEmailTouched = registerForm.email.length > 0;
  const registerEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerForm.email);
  const loginEmailValid =
    loginForm.email.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginForm.email);

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now();
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const saveEvents = useCallback((nextEvents: SavedEvent[]) => {
    const sorted = [...nextEvents].sort((a, b) => a.id - b.id);
    setEvents(sorted);
    writeSavedEvents(sorted);
  }, []);

  const saveProfiles = useCallback((nextProfiles: UserProfile[]) => {
    setProfiles(nextProfiles);
    writeProfiles(nextProfiles);
  }, []);

  const saveTickets = useCallback((nextTickets: TicketRecord[]) => {
    setTickets(nextTickets);
    writeTickets(nextTickets);
  }, []);

  const saveAdminSettings = useCallback((settings: AdminSettings) => {
    setAdminSettings(settings);
    writeAdminSettings(settings);
  }, []);

  const updateEvent = useCallback(
    (eventId: number, updates: Partial<SavedEvent>) => {
      saveEvents(
        events.map((event) =>
          event.id === eventId ? { ...event, ...updates, updatedAt: Date.now() } : event,
        ),
      );
    },
    [events, saveEvents],
  );

  const refreshTotals = useCallback(
    async (eventId = selectedId, address = wallet?.address) => {
      if (eventId < 0) return;
      setBusy("refresh");
      try {
        const client = await getClient(address || undefined);
        const totalTx = await client.total_collected({ event_id: eventId });
        const totalCollected = totalTx.result;
        let myBalance: bigint | null = null;

        if (address) {
          const balanceTx = await client.get_balance({
            event_id: eventId,
            attendee: address,
          });
          myBalance = balanceTx.result;
        }

        setTotals({ totalCollected, myBalance });
      } catch (error) {
        pushToast(
          "error",
          error instanceof Error ? error.message : "Could not refresh contract data.",
        );
      } finally {
        setBusy("");
      }
    },
    [pushToast, selectedId, wallet?.address],
  );

  const handleConnect = async () => {
    setBusy("connect");
    try {
      const nextWallet = await connectWallet();
      setWallet(nextWallet);
      pushToast("success", "Freighter connected.");
      await refreshTotals(selectedId, nextWallet.address);
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Wallet connection failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loginEmailValid || !loginForm.email || !loginForm.password) {
      pushToast("error", "Enter a valid email and password.");
      return;
    }

    setAuthLoading(true);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    const found = profiles.find(
      (item) =>
        item.email?.toLowerCase() === loginForm.email.trim().toLowerCase() &&
        item.password === loginForm.password,
    );
    setAuthLoading(false);

    if (!found) {
      pushToast("error", "We could not find an account with those details.");
      return;
    }

    setActiveAddress(found.address);
    pushToast("success", `Welcome back, ${found.displayName}.`);
  };

  const handleAdminLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    setAuthLoading(false);

    const valid =
      adminLoginForm.username.trim() === ADMIN_LOGIN.username &&
      adminLoginForm.email.trim().toLowerCase() === ADMIN_LOGIN.email &&
      adminLoginForm.password === ADMIN_LOGIN.password;

    if (!valid) {
      pushToast("error", "Admin login failed. Check the demo credentials.");
      return;
    }

    const adminAddress = wallet?.address || ADMIN_LOGIN.email;
    const nextProfile: UserProfile = {
      address: adminAddress,
      role: "admin",
      displayName: "TicketGuard Admin",
      school: "Campus Events Office",
      email: ADMIN_LOGIN.email,
      contact: "admin@admin.com",
      password: ADMIN_LOGIN.password,
      createdAt: Date.now(),
    };

    saveProfiles([
      ...profiles.filter((item) => item.address !== adminAddress),
      nextProfile,
    ]);
    saveAdminSettings({
      ...adminSettings,
      adminAddresses: Array.from(new Set([...adminSettings.adminAddresses, adminAddress])),
    });
    setActiveAddress(adminAddress);
    setView("admin");
    pushToast("success", "Admin dashboard unlocked.");
  };

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!registerForm.displayName.trim() || !registerForm.school.trim()) {
      pushToast("error", "Display name and school are required.");
      return;
    }
    if (!registerEmailValid) {
      pushToast("error", "Use a valid school or personal email address.");
      return;
    }
    if (registerForm.password.length < 6) {
      pushToast("error", "Password must be at least 6 characters.");
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      pushToast("error", "Passwords do not match.");
      return;
    }
    if (
      profiles.some(
        (item) => item.email?.toLowerCase() === registerForm.email.trim().toLowerCase(),
      )
    ) {
      pushToast("error", "An account already exists for that email.");
      return;
    }

    setAuthLoading(true);
    try {
      let connectedWallet = wallet;
      if (!connectedWallet?.address) {
        connectedWallet = await connectWallet();
        setWallet(connectedWallet);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 850));

      const nextProfile: UserProfile = {
        address: connectedWallet.address,
        role: "student",
        displayName: registerForm.displayName.trim(),
        school: registerForm.school.trim(),
        email: registerForm.email.trim(),
        contact: registerForm.contact.trim(),
        password: registerForm.password,
        createdAt: Date.now(),
      };

      saveProfiles([
        ...profiles.filter((item) => item.address !== connectedWallet.address),
        nextProfile,
      ]);
      setActiveAddress(connectedWallet.address);
      pushToast("success", "Account secured. You can now manage your tickets.");
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error
          ? error.message
          : "We could not verify your wallet. Please try again.",
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setActiveAddress("");
    setView("marketplace");
    pushToast("info", "You have been logged out.");
  };

  const confirmEventUpdate = (
    eventItem: SavedEvent,
    status: EventStatus,
    message: string,
  ) => {
    if (!window.confirm(message)) return;
    updateEvent(eventItem.id, { status });
    pushToast(
      "success",
      `${eventItem.name} is now ${statusLabel(status).toLowerCase()}.`,
    );
  };

  const handleCloseEvent = async (eventItem: SavedEvent) => {
    if (
      !window.confirm(
        `Close ${eventItem.name}? Ticket sales will stop and students should be able to request refunds.`,
      )
    ) {
      return;
    }

    if (!eventItem.contractCreated || eventItem.organizer !== wallet?.address) {
      updateEvent(eventItem.id, { status: "cancelled" });
      pushToast(
        "info",
        "Event closed in the app. Connect the organizer wallet and use the updated contract to unlock immediate on-chain refunds.",
      );
      return;
    }

    setBusy(`close-${eventItem.id}`);
    try {
      const client = await getClient(wallet.address);
      if (typeof client.cancel_event !== "function") {
        updateEvent(eventItem.id, { status: "cancelled" });
        pushToast(
          "info",
          "Event closed in the app. Immediate on-chain cancellation refunds require redeploying the updated contract.",
        );
        return;
      }
      const tx = await client.cancel_event({ event_id: eventItem.id });
      const sent = await submitTransaction(tx);
      setLastHash(sent.hash);
      updateEvent(eventItem.id, { status: "cancelled" });
      pushToast("success", "Event cancelled on-chain. Students can request refunds.");
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Event cancellation failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleCreateEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!wallet?.address || !profile) {
      pushToast("error", "Connect Freighter before creating an event.");
      return;
    }
    if (!isOrganizer(profile)) {
      pushToast("error", "Only admins can create campus event listings.");
      return;
    }

    const deadline = deadlineFromLocal(eventForm.deadline);
    const ticketPrice = BigInt(eventForm.ticketPrice || "0");
    const eventId = Number.parseInt(eventForm.expectedId || "0", 10);
    const capacity = Number.parseInt(eventForm.capacity || "0", 10);

    if (!deadline || ticketPrice <= 0n || Number.isNaN(eventId) || eventId < 0 || capacity <= 0) {
      pushToast("error", "Check the on-chain event ID, capacity, price, and deadline.");
      return;
    }

    setBusy("create");
    try {
      const client = await getClient(wallet.address);
      const tx = await client.create_event({
        organizer: wallet.address,
        ticket_price: ticketPrice,
        deadline: BigInt(deadline),
      });
      const sent = await submitTransaction(tx);
      setLastHash(sent.hash);

      const status: EventStatus = adminSettings.reviewRequired && !isAdmin ? "review" : "published";
      const nextEvent: SavedEvent = {
        id: eventId,
        name: eventForm.name.trim() || `Event ${eventId}`,
        description: eventForm.description.trim(),
        venue: eventForm.venue.trim(),
        campus: eventForm.campus.trim(),
        category: eventForm.category.trim(),
        capacity,
        sold: 0,
        ticketPrice: ticketPrice.toString(),
        deadline,
        organizer: wallet.address,
        organizerName: profile.displayName,
        organizerContact: profile.contact,
        status,
        hero: eventForm.category.toLowerCase(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        contractCreated: true,
      };

      saveEvents([...events.filter((item) => item.id !== eventId), nextEvent]);
      setSelectedId(eventId);
      setView("organizer");
      setEventForm((current) => ({
        ...current,
        expectedId: String(eventId + 1),
      }));
      pushToast(
        "success",
        status === "review"
          ? `Event #${eventId} created on-chain and sent for admin review.`
          : `Event #${eventId} created on-chain and published.`,
      );
      await refreshTotals(eventId, wallet.address);
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Create event failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleBuyTicket = async (eventItem: SavedEvent) => {
    if (!canUseContract || !wallet?.address || !profile) {
      pushToast("error", "Connect Freighter and create a student account first.");
      return;
    }
    if (!eventItem.contractCreated || eventItem.status !== "published") {
      pushToast("error", "This event is not open for ticket purchases.");
      return;
    }
    if (!isEventPurchasable(eventItem)) {
      pushToast("error", eventAvailability(eventItem));
      return;
    }
    if (eventItem.sold >= eventItem.capacity) {
      pushToast("error", "This event is sold out.");
      return;
    }

    setBusy(`buy-${eventItem.id}`);
    try {
      const client = await getClient(wallet.address);
      const tx = await client.buy_ticket({
        event_id: eventItem.id,
        attendee: wallet.address,
      });
      const sent = await submitTransaction(tx);
      setLastHash(sent.hash);

      saveTickets([
        ...tickets,
        {
          id: `${eventItem.id}-${wallet.address}-${Date.now()}`,
          eventId: eventItem.id,
          attendee: wallet.address,
          attendeeName: profile.displayName,
          amount: eventItem.ticketPrice,
          status: "active",
          txHash: sent.hash,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
      updateEvent(eventItem.id, { sold: eventItem.sold + 1 });
      setSelectedId(eventItem.id);
      pushToast("success", "Ticket purchase submitted to testnet.");
      await refreshTotals(eventItem.id, wallet.address);
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Buy ticket failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleRefund = async (ticket: TicketRecord) => {
    if (!wallet?.address) {
      pushToast("error", "Connect Freighter before refunding.");
      return;
    }
    const eventItem = events.find((item) => item.id === ticket.eventId);
    if (!eventItem) return;

    setBusy(`refund-${ticket.id}`);
    try {
      const client = await getClient(wallet.address);
      const tx = await client.refund({
        event_id: ticket.eventId,
        attendee: wallet.address,
      });
      const sent = await submitTransaction(tx);
      setLastHash(sent.hash);
      saveTickets(
        tickets.map((item) =>
          item.id === ticket.id
            ? { ...item, status: "refunded", txHash: sent.hash, updatedAt: Date.now() }
            : item,
        ),
      );
      updateEvent(eventItem.id, { sold: Math.max(eventItem.sold - 1, 0) });
      pushToast("success", "Refund submitted.");
      await refreshTotals(ticket.eventId, wallet.address);
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Refund failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleSimulatedRefund = (ticket: TicketRecord) => {
    const eventItem = events.find((item) => item.id === ticket.eventId);
    if (!eventItem) {
      pushToast("error", "We could not find the event for this ticket.");
      return;
    }
    if (ticket.status !== "active") {
      pushToast("error", "This ticket is already closed.");
      return;
    }
    if (eventItem.status === "released") {
      pushToast(
        "error",
        "Demo refund is unavailable after funds have been released to the organizer.",
      );
      return;
    }
    if (
      !window.confirm(
        `Simulate a cancelled-event refund for ${eventItem.name}? This updates the demo app only and will not submit a Stellar transaction.`,
      )
    ) {
      return;
    }

    saveTickets(
      tickets.map((item) =>
        item.id === ticket.id
          ? { ...item, status: "simulated_refund", updatedAt: Date.now() }
          : item,
      ),
    );
    updateEvent(eventItem.id, {
      status: eventItem.status === "cancelled" ? eventItem.status : "cancelled",
      sold: Math.max(eventItem.sold - 1, 0),
    });
    pushToast(
      "info",
      "Demo refund simulated. No Stellar transaction was submitted.",
    );
  };

  const handleReleaseFunds = async (eventItem: SavedEvent) => {
    if (!wallet?.address || eventItem.organizer !== wallet.address) {
      pushToast("error", "Only the organizer wallet can release this event.");
      return;
    }
    if (!canReleaseEvent(eventItem)) {
      pushToast(
        "error",
        eventItem.sold <= 0
          ? "Release is unavailable because no tickets have been purchased yet."
          : "Release is only available after marking an on-chain event as held and before refunds open.",
      );
      return;
    }
    if (
      !window.confirm(
        `Release collected funds for ${eventItem.name}? This should only be done after the event has been held.`,
      )
    ) {
      return;
    }

    setBusy(`release-${eventItem.id}`);
    try {
      const client = await getClient(wallet.address);
      const tx = await client.release_funds({ event_id: eventItem.id });
      const sent = await submitTransaction(tx);
      setLastHash(sent.hash);
      updateEvent(eventItem.id, { status: "released" });
      saveTickets(
        tickets.map((ticket) =>
          ticket.eventId === eventItem.id && ticket.status === "active"
            ? { ...ticket, status: "released", updatedAt: Date.now() }
            : ticket,
        ),
      );
      pushToast("success", "Funds released to organizer accounting.");
      await refreshTotals(eventItem.id, wallet.address);
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Release failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleTrackEvent = () => {
    const eventId = Number.parseInt(String(selectedId), 10);
    if (Number.isNaN(eventId) || eventId < 0) return;
    if (!events.some((event) => event.id === eventId)) {
      saveEvents([
        ...events,
        {
          ...starterEvents[0],
          id: eventId,
          name: `External Event ${eventId}`,
          status: "published",
          contractCreated: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
    }
    void refreshTotals(eventId);
  };

  useEffect(() => {
    const storedEvents = readSavedEvents();
    const initialEvents = storedEvents.length > 0 ? storedEvents : starterEvents;
    setEvents(initialEvents);
    const storedProfiles = readProfiles();
    const hasDean = storedProfiles.some(
      (profile) => profile.email?.toLowerCase() === DEFAULT_STUDENT.email,
    );
    const initialProfiles = hasDean
      ? storedProfiles.map((profile) =>
          profile.email?.toLowerCase() === DEFAULT_STUDENT.email
            ? { ...DEFAULT_STUDENT, ...profile, password: DEFAULT_STUDENT.password }
            : profile,
        )
      : [...storedProfiles, DEFAULT_STUDENT];
    setProfiles(initialProfiles);
    writeProfiles(initialProfiles);
    setTickets(readTickets());
    setAdminSettings(readAdminSettings());
    setSelectedId(initialEvents[0]?.id ?? 0);
    setEventForm((current) => ({ ...current, expectedId: "0" }));

    void loadWalletState().then((state) => {
      if (state) setWallet(state);
    });
  }, []);

  useEffect(() => {
    if (!isAdmin && (view === "admin" || view === "organizer")) {
      setView("marketplace");
    }
  }, [isAdmin, view]);

  useEffect(() => {
    if (selectedEvent) {
      void refreshTotals(selectedEvent.id, wallet?.address);
    }
  }, [refreshTotals, selectedEvent, wallet?.address]);

  if (!profile) {
    return (
      <main className="auth-shell">
        <section className="auth-hero">
          <div className="brand-block">
            <div className="brand-mark">
              <ShieldCheck size={28} />
            </div>
            <div>
              <p className="eyebrow">Campus event protection</p>
              <h1>TicketGuard</h1>
            </div>
          </div>
          <div className="auth-copy">
            <h2>Join your campus community to discover secure events.</h2>
            <p>
              Buy tickets with confidence, manage refunds, and follow event updates
              from verified campus organizers.
            </p>
          </div>
          <div className="auth-value-grid">
            <div>
              <Ticket />
              <strong>Manage your tickets</strong>
              <span>Keep purchases, refunds, and event status in one place.</span>
            </div>
            <div>
              <ShieldCheck />
              <strong>Verified on-chain identity</strong>
              <span>Connect Freighter during signup to protect ticket claims.</span>
            </div>
            <div>
              <RotateCcw />
              <strong>Refund-ready events</strong>
              <span>Refunds open after cancellation or the confirmation deadline.</span>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-tabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              className={authMode === "register" ? "active" : ""}
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
            <button
              className={authMode === "admin" ? "active" : ""}
              onClick={() => setAuthMode("admin")}
            >
              Admin Login
            </button>
          </div>

          {authMode === "login" && (
            <form className="auth-form" onSubmit={handleLogin}>
              <div>
                <p className="eyebrow">Welcome back</p>
                <h2>Login to TicketGuard</h2>
              </div>
              <label>
                Email
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  aria-invalid={!loginEmailValid}
                />
                {!loginEmailValid && <small className="field-error">Enter a valid email.</small>}
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>
              <button className="primary-button wide" disabled={authLoading}>
                {authLoading ? <Loader2 className="spin" /> : <UserRound />}
                Login
              </button>
            </form>
          )}

          {authMode === "register" && (
            <form className="auth-form" onSubmit={handleRegister}>
              <div>
                <p className="eyebrow">Student registration</p>
                <h2>Create your account</h2>
                <p>
                  Secure your account once, then use it to buy tickets and track
                  refund eligibility.
                </p>
              </div>
              <label>
                Display name <span className="required">Required</span>
                <input
                  value={registerForm.displayName}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                School <span className="required">Required</span>
                <input
                  value={registerForm.school}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      school: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  aria-invalid={registerEmailTouched && !registerEmailValid}
                />
                {registerEmailTouched && !registerEmailValid && (
                  <small className="field-error">Use a valid email address.</small>
                )}
              </label>
              <label>
                Phone or Messenger
                <input
                  value={registerForm.contact}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      contact: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  value={registerForm.confirmPassword}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                />
              </label>
              <button className="primary-button wide" disabled={authLoading}>
                {authLoading ? <Loader2 className="spin" /> : <ShieldCheck />}
                Save Account
              </button>
              <small className="auth-note">
                If wallet verification fails, an error message will appear here and
                your account will not be created.
              </small>
            </form>
          )}

          {authMode === "admin" && (
            <form className="auth-form" onSubmit={handleAdminLogin}>
              <div>
                <p className="eyebrow">Staff access</p>
                <h2>Admin login</h2>
                <p>Review event listings and manage platform safety controls.</p>
              </div>
              <label>
                Username
                <input
                  value={adminLoginForm.username}
                  onChange={(event) =>
                    setAdminLoginForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={adminLoginForm.email}
                  onChange={(event) =>
                    setAdminLoginForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={adminLoginForm.password}
                  onChange={(event) =>
                    setAdminLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="credential-hint">
                <span>Demo credentials</span>
                <strong>admin / admin@admin.com / admin123</strong>
              </div>
              <button className="primary-button wide" disabled={authLoading}>
                {authLoading ? <Loader2 className="spin" /> : <ShieldCheck />}
                Login as Admin
              </button>
            </form>
          )}
        </section>

        <div className="toast-stack">
          {toasts.map((toast) => (
            <div className={`toast ${toast.kind}`} key={toast.id}>
              {toast.message}
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <ShieldCheck size={28} />
          </div>
          <div>
            <p className="eyebrow">Campus event escrow</p>
            <h1>TicketGuard</h1>
          </div>
        </div>

        <div className="wallet-panel">
          <div>
            <span>Account</span>
            <strong>{profile?.displayName ?? shortAddress(wallet?.address ?? "")}</strong>
          </div>
          <div>
            <span>Network</span>
            <strong className={networkReady ? "ok" : "warn"}>
              {networkReady ? NETWORK_NAME : wallet?.network || "Freighter"}
            </strong>
          </div>
          <button className="primary-button" onClick={handleConnect}>
            {busy === "connect" ? <Loader2 className="spin" /> : <Wallet />}
            Connect
          </button>
          <button className="ghost-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </section>

      <section className="status-strip">
        <a href={EXPLORER_CONTRACT_URL} target="_blank" rel="noreferrer">
          <Link2 size={16} />
          {shortAddress(CONTRACT_ID)}
          <ExternalLink size={14} />
        </a>
        <span className={networkReady ? "pill ok" : "pill warn"}>
          {networkReady
            ? `${NETWORK_NAME} ready`
            : wallet?.connected
              ? `Switch Freighter to ${NETWORK_NAME}`
              : "Connect Freighter"}
        </span>
        <span className={hasAccount ? "pill ok" : "pill warn"}>
          {hasAccount ? `${profile?.role.toUpperCase()} account` : "Create account"}
        </span>
        {lastHash && (
          <a href={explorerTxUrl(lastHash)} target="_blank" rel="noreferrer">
            <CheckCircle2 size={16} />
            Last transaction
            <ExternalLink size={14} />
          </a>
        )}
      </section>

      <nav className="mode-tabs">
        {(
          [
            ["marketplace", "Events", Ticket],
            ["myTickets", "My Tickets", ClipboardCheck],
            ...(isAdmin
              ? [
                  ["organizer", "Host Events", Landmark],
                  ["admin", "Admin", ShieldCheck],
                ]
              : []),
          ] as Array<[View, string, typeof Ticket]>
        ).map(([id, label, Icon]) => (
            <button
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => setView(id)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
      </nav>

      {view === "marketplace" && (
        <section className="market-grid">
          <div className="market-main">
            <div className="section-header">
              <div>
                <p className="eyebrow">Ongoing events</p>
                <h2>Campus Marketplace</h2>
              </div>
              <div className="search-box">
                <Search size={17} />
                <input
                  aria-label="Search events"
                  placeholder="Search campus, venue, event"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="event-catalog">
              {visibleEvents.map((eventItem) => (
                <article
                  className={`event-card ${selectedEvent?.id === eventItem.id ? "active" : ""}`}
                  key={eventItem.id}
                  onClick={() => setSelectedId(eventItem.id)}
                >
                  <div className={`event-art ${eventItem.hero}`}>
                    <span>{eventItem.category}</span>
                  </div>
                  <div className="event-body">
                    <div className="event-title-row">
                      <h3>{eventItem.name}</h3>
                      <span className={`status-badge ${eventItem.status}`}>
                        {statusLabel(eventItem.status)}
                      </span>
                    </div>
                    <p>{eventItem.description}</p>
                    <div className="event-meta">
                      <span>{eventItem.campus}</span>
                      <span>{eventItem.venue}</span>
                      <span>{formatDeadline(eventItem.deadline)}</span>
                    </div>
                    <div className="event-actions">
                      <strong>PHP/USDC {eventItem.ticketPrice}</strong>
                      <span>{eventAvailability(eventItem)}</span>
                      <button
                        className="action-button buy"
                        disabled={
                          !canUseContract ||
                          !isEventPurchasable(eventItem) ||
                          busy === `buy-${eventItem.id}`
                        }
                        title={
                          isEventPurchasable(eventItem)
                            ? "Buy ticket"
                            : eventAvailability(eventItem)
                        }
                        onClick={(click) => {
                          click.stopPropagation();
                          void handleBuyTicket(eventItem);
                        }}
                      >
                        {busy === `buy-${eventItem.id}` ? (
                          <Loader2 className="spin" />
                        ) : (
                          <Ticket />
                        )}
                        {purchaseLabel(eventItem)}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="detail-panel">
            <div className="panel-heading">
              <h2>Contract Snapshot</h2>
              <button className="icon-button" onClick={() => void refreshTotals()}>
                {busy === "refresh" ? <Loader2 className="spin" /> : <RefreshCcw />}
              </button>
            </div>
            <div className="metrics-grid compact">
              <div className="metric">
                <CircleDollarSign />
                <span>Total collected</span>
                <strong>{formatUnits(totals.totalCollected)}</strong>
              </div>
              <div className="metric">
                <Ticket />
                <span>My balance</span>
                <strong>{formatUnits(totals.myBalance)}</strong>
              </div>
            </div>
            {selectedEvent && (
              <div className="selected-summary">
                <p className="eyebrow">Selected event #{selectedEvent.id}</p>
                <h3>{selectedEvent.name}</h3>
                <p>{selectedEvent.description}</p>
                {!selectedEvent.contractCreated && (
                  <div className="readiness-note warn">
                    This event is only a local draft. Create it on-chain before
                    students can buy tickets.
                  </div>
                )}
                {selectedEvent.contractCreated && (
                  <div className="readiness-note ok">
                    On-chain event ID #{selectedEvent.id}. Use this same ID for
                    testing purchases and releases.
                  </div>
                )}
                <div className="readiness-note">
                  Refunds open when an event is cancelled on-chain, or
                  automatically after the confirmation deadline if funds were not
                  released.
                </div>
                <button className="ghost-button" onClick={handleTrackEvent}>
                  <Plus />
                  Track Event ID
                </button>
              </div>
            )}
          </aside>
        </section>
      )}

      {view === "myTickets" && (
        <section className="workspace-grid tickets-layout">
          <div className="main-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Student access</p>
                <h2>My Tickets & Refunds</h2>
              </div>
            </div>
            <div className="ticket-list">
              {myTickets.length === 0 && (
                <div className="empty-state">No tickets yet. Buy from the marketplace.</div>
              )}
              {myTickets.map((ticket) => {
                const eventItem = events.find((event) => event.id === ticket.eventId);
                const refundOpen =
                  refundOpenForEvent(eventItem) && ticket.status === "active";
                const canSimulateRefund =
                  ticket.status === "active" &&
                  Boolean(eventItem) &&
                  eventItem?.status !== "released";
                const refundReason = ticketStatusLabel(ticket, eventItem);
                return (
                  <article className="ticket-row" key={ticket.id}>
                    <div>
                      <span>EVENT #{ticket.eventId}</span>
                      <h3>{eventItem?.name ?? "Tracked event"}</h3>
                      <p>{eventItem?.campus ?? "Campus"} - {refundReason}</p>
                      {ticket.status === "simulated_refund" && (
                        <span className="simulation-badge">
                          Demo only - Stellar balance unchanged
                        </span>
                      )}
                    </div>
                    <strong>PHP/USDC {ticket.amount}</strong>
                    <div className="ticket-actions">
                      <button
                        className="action-button refund"
                        disabled={!refundOpen || busy === `refund-${ticket.id}`}
                        onClick={() => void handleRefund(ticket)}
                      >
                        {busy === `refund-${ticket.id}` ? (
                          <Loader2 className="spin" />
                        ) : (
                          <RotateCcw />
                        )}
                        Refund
                      </button>
                      <button
                        className="ghost-button demo-refund-button"
                        disabled={!canSimulateRefund}
                        onClick={() => handleSimulatedRefund(ticket)}
                      >
                        <RefreshCcw />
                        Demo Refund
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {isAdmin && view === "organizer" && (
        <section className="workspace-grid organizer-layout">
          <section className="create-panel">
            <div className="panel-heading">
              <h2>Create Event</h2>
            </div>
            <form onSubmit={handleCreateEvent}>
              {[
                ["name", "Name"],
                ["campus", "Campus"],
                ["venue", "Venue"],
                ["category", "Category"],
                ["capacity", "Capacity"],
                ["ticketPrice", "Ticket price"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={eventForm[key as keyof typeof eventForm]}
                    onChange={(event) =>
                      setEventForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <label>
                On-chain event ID
                <input
                  inputMode="numeric"
                  min="0"
                  value={eventForm.expectedId}
                  onChange={(event) =>
                    setEventForm((current) => ({
                      ...current,
                      expectedId: event.target.value,
                    }))
                  }
                />
                <small className="field-help">
                  Fresh testnet deployments usually start at 0. Use the next
                  number only after a successful on-chain create.
                </small>
              </label>
              <label>
                Description
                <textarea
                  value={eventForm.description}
                  onChange={(event) =>
                    setEventForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Confirmation deadline
                <input
                  type="datetime-local"
                  value={eventForm.deadline}
                  onChange={(event) =>
                    setEventForm((current) => ({
                      ...current,
                      deadline: event.target.value,
                    }))
                  }
                />
                <small className="field-help">
                  Organizers must release funds before this time. If they do not,
                  refunds open automatically. Cancelled events can be refunded
                  immediately after the updated contract is deployed.
                </small>
              </label>
              <button
                className="primary-button wide"
                disabled={!canUseContract || !isOrganizer(profile) || busy === "create"}
              >
                {busy === "create" ? <Loader2 className="spin" /> : <Plus />}
                Create On-Chain
              </button>
            </form>
          </section>

          <section className="main-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Organizer dashboard</p>
                <h2>Event Operations</h2>
              </div>
            </div>
            <div className="ops-list">
              {organizerEvents.length === 0 && (
                <div className="empty-state">No organizer events yet.</div>
              )}
              {organizerEvents.map((eventItem) => (
                <article className="ops-row" key={eventItem.id}>
                  <div>
                    <span className={`status-badge ${eventItem.status}`}>
                      {statusLabel(eventItem.status)}
                    </span>
                    <h3>{eventItem.name}</h3>
                    <p>
                      {eventItem.sold}/{eventItem.capacity} sold - deadline{" "}
                      {formatDeadline(eventItem.deadline)}
                    </p>
                  </div>
                  <div className="ops-actions">
                    {(eventItem.status === "published" || eventItem.status === "paused") && (
                      <>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            confirmEventUpdate(
                              eventItem,
                              eventItem.status === "paused" ? "published" : "paused",
                              eventItem.status === "paused"
                                ? `Resume ticket sales for ${eventItem.name}?`
                                : `Pause ticket sales for ${eventItem.name}?`,
                            )
                          }
                        >
                          <RotateCcw />
                          {eventItem.status === "paused" ? "Resume" : "Pause"}
                        </button>
                        <button
                          className="ghost-button"
                          disabled={busy === `close-${eventItem.id}`}
                          onClick={() => void handleCloseEvent(eventItem)}
                        >
                          {busy === `close-${eventItem.id}` ? (
                            <Loader2 className="spin" />
                          ) : (
                            <XCircle />
                          )}
                          Close
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            confirmEventUpdate(
                              eventItem,
                              "held",
                              `Mark ${eventItem.name} as held? This enables release after tickets exist.`,
                            )
                          }
                        >
                          <Sparkles />
                          Held
                        </button>
                      </>
                    )}
                    {eventItem.status === "review" && (
                      <span className="helper-chip">Waiting for admin approval</span>
                    )}
                    {eventItem.status === "cancelled" && (
                      <span className="helper-chip">Closed</span>
                    )}
                    <button
                      className="action-button release"
                      disabled={
                        eventItem.organizer !== wallet?.address ||
                        !canReleaseEvent(eventItem) ||
                        busy === `release-${eventItem.id}`
                      }
                      title={
                        canReleaseEvent(eventItem)
                          ? "Release funds"
                          : eventItem.sold <= 0
                            ? "No tickets purchased yet"
                            : "Mark as held before releasing"
                      }
                      onClick={() => void handleReleaseFunds(eventItem)}
                    >
                      {busy === `release-${eventItem.id}` ? (
                        <Loader2 className="spin" />
                      ) : (
                        <CheckCircle2 />
                      )}
                      Release
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}

      {isAdmin && view === "admin" && (
        <section className="workspace-grid admin-layout">
          <aside className="side-panel">
            <div className="panel-heading">
              <h2>Admin Access</h2>
            </div>
            <p className="helper-text">
              Admin access is available after signing in from the Admin Login
              option on the welcome screen.
            </p>
            <div className={isAdmin ? "admin-state ok" : "admin-state warn"}>
              {isAdmin ? "Admin session active" : "Admin session required"}
            </div>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={adminSettings.reviewRequired}
                disabled={!isAdmin}
                onChange={(event) =>
                  saveAdminSettings({
                    ...adminSettings,
                    reviewRequired: event.target.checked,
                  })
                }
              />
              Require admin review
            </label>
          </aside>

          <section className="main-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Admin console</p>
                <h2>Review Queue & Safety Controls</h2>
              </div>
            </div>
            <div className="ops-list">
              {events
                .filter((eventItem) => eventItem.status === "review" || isAdmin)
                .map((eventItem) => (
                  <article className="ops-row" key={eventItem.id}>
                    <div>
                      <span className={`status-badge ${eventItem.status}`}>
                        {statusLabel(eventItem.status)}
                      </span>
                      <h3>{eventItem.name}</h3>
                      <p>
                        {eventItem.organizerName} - {eventItem.campus} - PHP/USDC{" "}
                        {eventItem.ticketPrice}
                      </p>
                    </div>
                    <div className="ops-actions">
                      {eventItem.status === "review" && (
                        <>
                          <button
                            className="ghost-button"
                            disabled={!isAdmin}
                            onClick={() =>
                              confirmEventUpdate(
                                eventItem,
                                "cancelled",
                                `Reject and close ${eventItem.name}? Students will not be able to buy tickets for it.`,
                              )
                            }
                          >
                            <XCircle />
                            Reject
                          </button>
                          <button
                            className="action-button buy"
                            disabled={!isAdmin}
                            onClick={() =>
                              confirmEventUpdate(
                                eventItem,
                                "published",
                                `Approve ${eventItem.name} and open ticket sales?`,
                              )
                            }
                          >
                            <CheckCircle2 />
                            Approve
                          </button>
                        </>
                      )}
                      {(eventItem.status === "published" ||
                        eventItem.status === "paused") && (
                        <>
                          <button
                            className="ghost-button"
                            disabled={!isAdmin}
                            onClick={() =>
                              confirmEventUpdate(
                                eventItem,
                                eventItem.status === "paused" ? "published" : "paused",
                                eventItem.status === "paused"
                                  ? `Resume ticket sales for ${eventItem.name}?`
                                  : `Pause ticket sales for ${eventItem.name}? Students will temporarily be unable to buy tickets.`,
                              )
                            }
                          >
                            <RotateCcw />
                            {eventItem.status === "paused" ? "Resume" : "Pause"}
                          </button>
                          <button
                            className="action-button refund"
                            disabled={!isAdmin || busy === `close-${eventItem.id}`}
                            onClick={() => void handleCloseEvent(eventItem)}
                          >
                            {busy === `close-${eventItem.id}` ? (
                              <Loader2 className="spin" />
                            ) : (
                              <XCircle />
                            )}
                            Close
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
            </div>
          </section>
        </section>
      )}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div className={`toast ${toast.kind}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
