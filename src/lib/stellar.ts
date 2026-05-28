import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { contract } from "@stellar/stellar-sdk";
import { CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from "../config";
import type { WalletState } from "../types";

type TicketGuardClient = contract.Client & {
  create_event: (
    args: { organizer: string; ticket_price: bigint; deadline: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<void>>;
  buy_ticket: (
    args: { event_id: number; attendee: string },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<void>>;
  release_funds: (
    args: { event_id: number },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<void>>;
  cancel_event?: (
    args: { event_id: number },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<void>>;
  refund: (
    args: { event_id: number; attendee: string },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<void>>;
  get_balance: (
    args: { event_id: number; attendee: string },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
  total_collected: (
    args: { event_id: number },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<bigint>>;
};

const signAuthEntryForSdk: contract.SignAuthEntry = async (entryXdr, options) => {
  const response = await signAuthEntry(entryXdr, options);
  if (response.error || !response.signedAuthEntry) {
    throw new Error(response.error?.message ?? "Freighter auth signing failed.");
  }

  return {
    signedAuthEntry: response.signedAuthEntry,
    signerAddress: response.signerAddress,
  };
};

const normalizeError = (value: unknown) => {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "The Stellar request failed.";

  if (message.includes("buy_ticket") && message.includes("InvalidAction")) {
    return "Ticket purchase could not be completed. Please check that this event was created on-chain, is still open, and matches the event ID shown in the app.";
  }

  if (message.includes("release_funds") && message.includes("InvalidAction")) {
    return "Funds could not be released. Make sure you are using the organizer wallet, the event has ticket purchases, and the release is allowed before the refund deadline.";
  }

  if (message.includes("refund") && message.includes("InvalidAction")) {
    return "Refund could not be completed yet. Refunds are only available after the event deadline and before funds are released.";
  }

  if (message.includes("cancel_event") && message.includes("InvalidAction")) {
    return "Cancellation could not be recorded on-chain. Make sure you are using the organizer wallet and funds have not been released.";
  }

  if (message.includes("create_event") && message.includes("InvalidAction")) {
    return "Event setup could not be completed on-chain. Please check the ticket price, deadline, and connected wallet.";
  }

  if (message.includes("HostError") || message.includes("UnreachableCodeReached")) {
    return "The contract rejected this request. Please review the event status, deadline, and connected wallet, then try again.";
  }

  if (message.length > 240) {
    return `${message.slice(0, 237)}...`;
  }

  return message;
};

export async function connectWallet(): Promise<WalletState> {
  const connected = await isConnected();
  if (connected.error || !connected.isConnected) {
    throw new Error("Freighter is not available in this browser.");
  }

  const access = await requestAccess();
  if (access.error || !access.address) {
    throw new Error(access.error?.message ?? "Wallet access was not granted.");
  }

  const network = await getNetworkDetails();
  if (network.error) {
    throw new Error(network.error.message);
  }

  return {
    address: access.address,
    network: network.network,
    networkPassphrase: network.networkPassphrase,
    connected: true,
  };
}

export async function loadWalletState(): Promise<WalletState | null> {
  const connected = await isConnected();
  if (connected.error || !connected.isConnected) return null;

  const network = await getNetworkDetails();
  if (network.error) return null;

  return {
    address: "",
    network: network.network,
    networkPassphrase: network.networkPassphrase,
    connected: true,
  };
}

export function isTestnet(wallet: WalletState | null) {
  return wallet?.networkPassphrase === NETWORK_PASSPHRASE;
}

export async function getClient(publicKey?: string): Promise<TicketGuardClient> {
  return contract.Client.from({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey,
    rpcUrl: RPC_URL,
    signAuthEntry: signAuthEntryForSdk,
    signTransaction,
  }) as Promise<TicketGuardClient>;
}

export async function submitTransaction<T>(
  assembled: contract.AssembledTransaction<T>,
): Promise<{ hash: string; result: T }> {
  try {
    const sent = await assembled.signAndSend();
    return {
      hash:
        sent.sendTransactionResponse?.hash ??
        sent.getTransactionResponse?.txHash ??
        "",
      result: sent.result,
    };
  } catch (error) {
    throw new Error(normalizeError(error));
  }
}
