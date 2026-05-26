# TicketGuard

**Trustless escrow for paid campus events.**

---

## Problem

A university student in Manila pays ₱200 for a concert ticket via GCash. The organizer cancels the event and disappears with ₱30,000 – no refund possible. Students have no protection.

## Solution

Ticket payments are locked in a Stellar Soroban escrow contract. Funds are only released to the organizer if the event is held. If the event is cancelled, every attendee can withdraw a full refund automatically after the deadline.

---

## Timeline

Built during a 4‑hour Stellar bootcamp (Stellar Philippines UniTour).

## Stellar Features Used

* **Soroban Smart Contract:** Handles escrow management and deadline enforcement.
* **USDC Transfers:** Facilitates ticket payments and attendee refunds.
* **XLM:** Utilized for network gas fees.

## Vision & Purpose

Eliminate ticket fraud on campuses by replacing “trust me” with “trust code”. Any student can verify exactly how much was collected and whether funds were released.

---

## Prerequisites

* **Rust:** Latest stable version.
* **Stellar CLI:** Installed via `cargo install --locked stellar-cli`.

## How to Build

```bash
cargo build --target wasm32-unknown-unknown --release

```

---

## Deployment Info

| Attribute | Details |
| --- | --- |
| **Contract ID** | `CA5YGLH5YSBXQWCXUE63NSKGU27HJ35IN7OMOUMRDPZ5Z2RPOOOEMAO2` |
| **Explorer Link** | [Stellar.expert Testnet Explorer](https://stellar.expert/explorer/testnet/contract/CA5YGLH5YSBXQWCXUE63NSKGU27HJ35IN7OMOUMRDPZ5Z2RPOOOEMAO2) |