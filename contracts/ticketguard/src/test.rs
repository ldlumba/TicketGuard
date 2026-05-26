#![cfg(test)]
extern crate std;

use soroban_sdk::{testutils::{Address as _, Ledger, LedgerInfo}, Address, Env, IntoVal};
use crate::{TicketGuard, TicketGuardClient};

#[test]
fn test_happy_path_buy_and_release() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TicketGuard);
    let client = TicketGuardClient::new(&env, &contract_id);

    let organizer = Address::random(&env);
    let attendee = Address::random(&env);
    let price = 200_000_000_i128; // 200 USDC in stroops
    let deadline = env.ledger().timestamp() + 3600;

    client.create_event(&organizer, &price, &deadline);
    client.buy_ticket(&0_u32, &attendee);
    assert_eq!(client.get_balance(&0_u32, &attendee), price);
    assert_eq!(client.total_collected(&0_u32), price);

    client.release_funds(&0_u32);
    assert_eq!(client.get_balance(&0_u32, &attendee), 0);
    assert_eq!(client.total_collected(&0_u32), 0);
}

#[test]
fn test_edge_case_refund_after_deadline() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TicketGuard);
    let client = TicketGuardClient::new(&env, &contract_id);

    let organizer = Address::random(&env);
    let attendee = Address::random(&env);
    let price = 200_000_000_i128;
    let deadline = env.ledger().timestamp() + 100;

    client.create_event(&organizer, &price, &deadline);
    client.buy_ticket(&0_u32, &attendee);
    // Advance ledger past deadline
    env.ledger().with_mut(|li| li.timestamp = deadline + 1);
    client.refund(&0_u32, &attendee);
    assert_eq!(client.get_balance(&0_u32, &attendee), 0);
    assert_eq!(client.total_collected(&0_u32), 0);
}

#[test]
fn test_state_verification_after_release() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TicketGuard);
    let client = TicketGuardClient::new(&env, &contract_id);

    let organizer = Address::random(&env);
    let attendee = Address::random(&env);
    let price = 100_000_000_i128;
    let deadline = env.ledger().timestamp() + 3600;

    client.create_event(&organizer, &price, &deadline);
    client.buy_ticket(&0_u32, &attendee);
    client.release_funds(&0_u32);
    // State: released flag should be true, balances empty
    assert_eq!(client.get_balance(&0_u32, &attendee), 0);
    // Attempting another release should panic
    let result = std::panic::catch_unwind(|| client.release_funds(&0_u32));
    assert!(result.is_err());
}

#[test]
fn test_unauthorized_release() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TicketGuard);
    let client = TicketGuardClient::new(&env, &contract_id);

    let organizer = Address::random(&env);
    let fake_organizer = Address::random(&env);
    let price = 200_000_000_i128;
    let deadline = env.ledger().timestamp() + 3600;

    client.create_event(&organizer, &price, &deadline);
    // Try to release with fake_organizer
    let result = std::panic::catch_unwind(|| {
        let client2 = TicketGuardClient::new(&env, &contract_id);
        client2.release_funds(&0_u32);
    });
    assert!(result.is_err());
}

#[test]
fn test_buy_after_deadline_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TicketGuard);
    let client = TicketGuardClient::new(&env, &contract_id);

    let organizer = Address::random(&env);
    let attendee = Address::random(&env);
    let price = 200_000_000_i128;
    let deadline = env.ledger().timestamp() + 10;

    client.create_event(&organizer, &price, &deadline);
    env.ledger().with_mut(|li| li.timestamp = deadline + 1);
    let result = std::panic::catch_unwind(|| client.buy_ticket(&0_u32, &attendee));
    assert!(result.is_err());
}