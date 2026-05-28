import { Networks } from "@stellar/stellar-sdk";

export const CONTRACT_ID =
  import.meta.env.VITE_TICKETGUARD_CONTRACT_ID ??
  "CA5YGLH5YSBXQWCXUE63NSKGU27HJ35IN7OMOUMRDPZ5Z2RPOOOEMAO2";

export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const NETWORK_NAME = "Testnet";

export const EXPLORER_CONTRACT_URL = `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`;
export const explorerTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;

export const STORAGE_KEY = "ticketguard.events.v1";
export const PROFILES_STORAGE_KEY = "ticketguard.profiles.v1";
export const TICKETS_STORAGE_KEY = "ticketguard.tickets.v1";
export const ADMIN_STORAGE_KEY = "ticketguard.admin.v1";
