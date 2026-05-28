#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Map, Symbol, Vec};

#[derive(Clone)]
#[contract]
pub struct TicketGuard;

const EVENTS: Symbol = symbol_short!("EVENTS");
const TICKET_PRICE: Symbol = symbol_short!("PRICE");
const DEADLINE: Symbol = symbol_short!("DEADLINE");
const ORGANIZER: Symbol = symbol_short!("ORGANIZER");
const BALANCES: Symbol = symbol_short!("BALANCES");
const RELEASED: Symbol = symbol_short!("RELEASED");
const CANCELLED: Symbol = symbol_short!("CANCELLED");

#[contractimpl]
impl TicketGuard {
    /// Create a new event. The deadline is the organizer confirmation deadline:
    /// funds can be released before it, and refunds open after it.
    pub fn create_event(env: Env, organizer: Address, ticket_price: i128, deadline: u64) {
        organizer.require_auth();
        let events: Vec<u32> = env.storage().instance().get(&EVENTS).unwrap_or(Vec::new(&env));
        let event_id = events.len() as u32;
        let mut new_events = events;
        new_events.push_back(event_id);
        env.storage().instance().set(&EVENTS, &new_events);
        env.storage().instance().set(&(TICKET_PRICE, event_id), &ticket_price);
        env.storage().instance().set(&(DEADLINE, event_id), &deadline);
        env.storage().instance().set(&(ORGANIZER, event_id), &organizer);
        env.storage().instance().set(&(RELEASED, event_id), &false);
        env.storage().instance().set(&(CANCELLED, event_id), &false);
    }

    /// Buy a ticket before the confirmation deadline unless the event is cancelled.
    pub fn buy_ticket(env: Env, event_id: u32, attendee: Address) {
        attendee.require_auth();
        let deadline: u64 = env.storage().instance()
            .get(&(DEADLINE, event_id))
            .expect("Event not found");
        let now = env.ledger().timestamp();
        if now >= deadline {
            panic!("Event deadline passed, no more purchases");
        }
        let cancelled: bool = env.storage().instance().get(&(CANCELLED, event_id)).unwrap_or(false);
        if cancelled {
            panic!("Event cancelled, no more purchases");
        }
        let released: bool = env.storage().instance().get(&(RELEASED, event_id)).unwrap_or(false);
        if released {
            panic!("Funds already released to organizer");
        }
        let price: i128 = env.storage().instance().get(&(TICKET_PRICE, event_id)).unwrap();
        let mut balances: Map<Address, i128> = env.storage().instance()
            .get(&(BALANCES, event_id))
            .unwrap_or(Map::new(&env));
        let prev = balances.get(attendee.clone()).unwrap_or(0);
        balances.set(attendee.clone(), prev + price);
        env.storage().instance().set(&(BALANCES, event_id), &balances);
        env.events().publish((symbol_short!("buy"), event_id, attendee), price);
    }

    /// Organizer releases all funds after the event is held and before refunds open.
    pub fn release_funds(env: Env, event_id: u32) {
        let organizer: Address = env.storage().instance()
            .get(&(ORGANIZER, event_id))
            .expect("Event not found");
        organizer.require_auth();
        let deadline: u64 = env.storage().instance().get(&(DEADLINE, event_id)).unwrap();
        let now = env.ledger().timestamp();
        if now > deadline {
            panic!("Deadline passed, cannot release - use refunds");
        }
        let cancelled: bool = env.storage().instance().get(&(CANCELLED, event_id)).unwrap_or(false);
        if cancelled {
            panic!("Event cancelled, use refunds");
        }
        let released: bool = env.storage().instance().get(&(RELEASED, event_id)).unwrap_or(false);
        if released {
            panic!("Funds already released");
        }
        let balances: Map<Address, i128> = env.storage().instance()
            .get(&(BALANCES, event_id))
            .unwrap_or(Map::new(&env));
        let mut total = 0i128;
        for (_, amount) in balances.iter() {
            total += amount;
        }
        if total == 0 {
            panic!("No funds to release");
        }
        env.storage().instance().set(&(RELEASED, event_id), &true);
        let empty_map: Map<Address, i128> = Map::new(&env);
        env.storage().instance().set(&(BALANCES, event_id), &empty_map);
        env.events().publish((symbol_short!("release"), event_id, organizer), total);
    }

    /// Organizer cancels an event, allowing refunds immediately.
    pub fn cancel_event(env: Env, event_id: u32) {
        let organizer: Address = env.storage().instance()
            .get(&(ORGANIZER, event_id))
            .expect("Event not found");
        organizer.require_auth();
        let released: bool = env.storage().instance().get(&(RELEASED, event_id)).unwrap_or(false);
        if released {
            panic!("Funds already released");
        }
        let cancelled: bool = env.storage().instance().get(&(CANCELLED, event_id)).unwrap_or(false);
        if cancelled {
            panic!("Event already cancelled");
        }
        env.storage().instance().set(&(CANCELLED, event_id), &true);
        env.events().publish((symbol_short!("cancel"), event_id), organizer);
    }

    /// After the confirmation deadline or cancellation, attendee refunds their ticket.
    pub fn refund(env: Env, event_id: u32, attendee: Address) {
        attendee.require_auth();
        let deadline: u64 = env.storage().instance()
            .get(&(DEADLINE, event_id))
            .expect("Event not found");
        let now = env.ledger().timestamp();
        let cancelled: bool = env.storage().instance().get(&(CANCELLED, event_id)).unwrap_or(false);
        if now <= deadline && !cancelled {
            panic!("Cannot refund before deadline unless event is cancelled");
        }
        let released: bool = env.storage().instance().get(&(RELEASED, event_id)).unwrap_or(false);
        if released {
            panic!("Funds already released to organizer - no refunds");
        }
        let mut balances: Map<Address, i128> = env.storage().instance()
            .get(&(BALANCES, event_id))
            .unwrap_or(Map::new(&env));
        let amount = balances.get(attendee.clone()).unwrap_or(0);
        if amount == 0 {
            panic!("No ticket found for attendee");
        }
        balances.remove(attendee.clone());
        env.storage().instance().set(&(BALANCES, event_id), &balances);
        env.events().publish((symbol_short!("refund"), event_id, attendee), amount);
    }

    pub fn get_balance(env: Env, event_id: u32, attendee: Address) -> i128 {
        let balances: Map<Address, i128> = env.storage().instance()
            .get(&(BALANCES, event_id))
            .unwrap_or(Map::new(&env));
        balances.get(attendee).unwrap_or(0)
    }

    pub fn total_collected(env: Env, event_id: u32) -> i128 {
        let balances: Map<Address, i128> = env.storage().instance()
            .get(&(BALANCES, event_id))
            .unwrap_or(Map::new(&env));
        let mut total = 0i128;
        for (_, amount) in balances.iter() {
            total += amount;
        }
        total
    }

    pub fn is_cancelled(env: Env, event_id: u32) -> bool {
        env.storage().instance().get(&(CANCELLED, event_id)).unwrap_or(false)
    }
}
