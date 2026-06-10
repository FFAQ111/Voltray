/// Voltray: on-chain Demand Response (DR) for a hackathon MVP.
/// See docs/ARCHITECTURE.md for object schema, settlement model, and MVP decisions.
module voltray::voltray;

use std::string::String;
use sui::address;
use sui::balance::{Self, Balance};
use sui::bcs;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::dynamic_field as df;
use sui::ed25519;
use sui::event::emit;

// ===== Errors =====

const E_NOT_UTILITY: u64 = 0;
const E_NOT_METER_OWNER: u64 = 1;
const E_OUTSIDE_WINDOW: u64 = 2;
const E_WRONG_VAULT: u64 = 3;
const E_ALREADY_RESPONDED: u64 = 4;
const E_ALREADY_SETTLED: u64 = 5;
const E_EVENT_NOT_ENDED: u64 = 6;
const E_UNDERFUNDED: u64 = 7;
const E_INVALID_WINDOW: u64 = 8;
const E_BAD_SIGNATURE: u64 = 9;
const E_BAD_PUBKEY: u64 = 10;

// ===== Objects =====

// TODO(post-MVP): replace free-form `label` with a hardware-signed serial or TEE attestation.
public struct SmartMeter has key, store {
    id: UID,
    owner: address,
    label: String,
}

public struct DREvent has key {
    id: UID,
    utility: address,
    reward_per_unit: u64,
    target_reduction: u64,
    remaining_units: u64,
    start_time: u64,
    end_time: u64,
    // ed25519 public key (32 bytes) of the charger authorised to sign this event's session
    // readings. settle() rejects any saved_units not signed by this key (see docs/TRUST.md §5.1).
    charger_pubkey: vector<u8>,
}

// Generic over the reward coin T so the same package settles in any coin — testnet/mainnet
// USDC for a stable per-kWh price, or SUI. T is supplied by the caller at create_event, so the
// package itself takes no dependency on the USDC package (see docs/ARCHITECTURE.md §1.1, §5).
// TODO(post-MVP): consider a shared reward pool across events instead of one vault per event.
public struct RewardVault<phantom T> has key {
    id: UID,
    event_id: ID,
    balance: Balance<T>,
}

// ===== Events =====

public struct EventCreated has copy, drop {
    event_id: ID,
    utility: address,
    reward_per_unit: u64,
}

public struct MeterRegistered has copy, drop {
    meter_id: ID,
    owner: address,
}

public struct MeterResponded has copy, drop {
    event_id: ID,
    meter_id: ID,
    responder: address,
    timestamp: u64,
}

public struct Settled has copy, drop {
    event_id: ID,
    meter_id: ID,
    responder: address,
    amount: u64,
    units_paid: u64,
}

public struct Reclaimed has copy, drop {
    event_id: ID,
    amount: u64,
}

// ===== Entry functions =====

public fun create_event<T>(
    reward_coin: Coin<T>,
    reward_per_unit: u64,
    target_reduction: u64,
    start_time: u64,
    end_time: u64,
    charger_pubkey: vector<u8>,
    ctx: &mut TxContext,
) {
    // The vault must cover the worst-case payout (reclaim_remaining and settle both rely
    // on this), and respond/reclaim are meaningless on an inverted window. The u64
    // multiplication aborts on overflow, so it cannot be used to bypass the check.
    assert!(reward_coin.value() >= reward_per_unit * target_reduction, E_UNDERFUNDED);
    assert!(start_time < end_time, E_INVALID_WINDOW);
    // An ed25519 public key is exactly 32 bytes; a wrong-length key would make every
    // settle() unverifiable and strand the vault.
    assert!(charger_pubkey.length() == 32, E_BAD_PUBKEY);

    let utility = ctx.sender();
    let event = DREvent {
        id: object::new(ctx),
        utility,
        reward_per_unit,
        target_reduction,
        remaining_units: target_reduction,
        start_time,
        end_time,
        charger_pubkey,
    };
    let event_id = object::id(&event);
    let vault = RewardVault {
        id: object::new(ctx),
        event_id,
        balance: coin::into_balance(reward_coin),
    };

    emit(EventCreated { event_id, utility, reward_per_unit });

    transfer::share_object(event);
    transfer::share_object(vault);
}

// MVP: register_meter transfers the new SmartMeter to the sender directly so the user does
// not need a separate PTB step. Suppressing the self-transfer lint is intentional — we accept
// the loss of PTB composability for a one-step UX.
#[allow(lint(self_transfer))]
public fun register_meter(label: String, ctx: &mut TxContext) {
    let owner = ctx.sender();
    let meter = SmartMeter {
        id: object::new(ctx),
        owner,
        label,
    };
    emit(MeterRegistered { meter_id: object::id(&meter), owner });
    transfer::transfer(meter, owner);
}

public fun respond(
    event: &DREvent,
    meter: &mut SmartMeter,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let responder = ctx.sender();
    assert!(meter.owner == responder, E_NOT_METER_OWNER);

    let ts = clock.timestamp_ms();
    assert!(ts >= event.start_time && ts <= event.end_time, E_OUTSIDE_WINDOW);

    // On-chain dedup lives on the Owned SmartMeter, keyed by event id — never on the
    // Shared DREvent (see docs/ARCHITECTURE.md critical rule). Owned-object writes do not
    // contend on a shared lock, so per-event single-response is enforced without losing
    // the parallelism that keeps `event: &DREvent` an immutable borrow.
    let event_id = object::id(event);
    assert!(!df::exists_with_type<ID, bool>(&meter.id, event_id), E_ALREADY_RESPONDED);
    df::add(&mut meter.id, event_id, true);

    emit(MeterResponded {
        event_id,
        meter_id: object::id(meter),
        responder,
        timestamp: ts,
    });
}

// The utility submits the tx, but it can no longer name an arbitrary saved_units: the reading
// must carry an ed25519 signature from the event's authorised charger key (docs/TRUST.md §5.1).
// TODO(post-MVP): authorise a *set* of charger keys per event; bind a meter to its charger
// (TRUST.md §3.1); M-of-N / multisig settlement (§5.2); pro-rata allocation instead of FCFS.
public fun settle<T>(
    event: &mut DREvent,
    vault: &mut RewardVault<T>,
    responder: address,
    meter_id: ID,
    saved_units: u64,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    // Verify the charger signed exactly this reading. The message must match the TypeScript
    // signer byte-for-byte: event_id ‖ meter_id ‖ responder ‖ saved_units (u64 LE).
    let mut msg = object::id_to_bytes(&object::id(event));
    msg.append(object::id_to_bytes(&meter_id));
    msg.append(address::to_bytes(responder));
    msg.append(bcs::to_bytes(&saved_units));
    assert!(ed25519::ed25519_verify(&signature, &event.charger_pubkey, &msg), E_BAD_SIGNATURE);

    settle_inner(event, vault, responder, meter_id, saved_units, ctx);
}

// Payout body, split out so the signature gate above and the test-only path below share it.
// A valid charger signature over runtime object IDs cannot be precomputed inside a Move unit
// test, so the payout/dedup/cap tests drive this directly via settle_for_testing; the real
// settle() signature path is covered by dedicated signature tests and on testnet (TRUST.md §5.1).
fun settle_inner<T>(
    event: &mut DREvent,
    vault: &mut RewardVault<T>,
    responder: address,
    meter_id: ID,
    saved_units: u64,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == event.utility, E_NOT_UTILITY);
    assert!(vault.event_id == object::id(event), E_WRONG_VAULT);

    // Per-(event, meter) payout dedup. The vault is 1:1 with the event, so a dynamic field
    // keyed by meter_id on the Shared RewardVault enforces a single payout per response
    // without a growing vector in any struct (same pattern as the respond dedup).
    assert!(!df::exists_with_type<ID, bool>(&vault.id, meter_id), E_ALREADY_SETTLED);

    let units_paid = if (saved_units < event.remaining_units) saved_units
                     else event.remaining_units;
    if (units_paid == 0) return;

    df::add(&mut vault.id, meter_id, true);
    let amount = units_paid * event.reward_per_unit;
    event.remaining_units = event.remaining_units - units_paid;

    let payment = coin::from_balance(balance::split(&mut vault.balance, amount), ctx);
    transfer::public_transfer(payment, responder);

    emit(Settled {
        event_id: object::id(event),
        meter_id,
        responder,
        amount,
        units_paid,
    });
}

// Test-only payout path that skips the charger-signature gate, so payout/dedup/cap/auth tests
// don't need a valid ed25519 signature over runtime object IDs (see settle_inner).
#[test_only]
public fun settle_for_testing<T>(
    event: &mut DREvent,
    vault: &mut RewardVault<T>,
    responder: address,
    meter_id: ID,
    saved_units: u64,
    ctx: &mut TxContext,
) {
    settle_inner(event, vault, responder, meter_id, saved_units, ctx);
}

// After the window closes, the utility recovers the unspent vault balance (the worst-case
// funding it pre-deposited but the responders never claimed). Gated on the window being over
// so funds can't be pulled out from under active responders.
//
// TODO(post-MVP): a decentralised settler needs a settlement-finality / grace window before
// reclaim, so leftovers can't be pulled ahead of pledged-but-unsettled payouts. Under the MVP
// admin-only model the utility already controls settle(), so reclaim grants it no new power.
public fun reclaim_remaining<T>(
    event: &DREvent,
    vault: &mut RewardVault<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == event.utility, E_NOT_UTILITY);
    assert!(vault.event_id == object::id(event), E_WRONG_VAULT);
    assert!(clock.timestamp_ms() > event.end_time, E_EVENT_NOT_ENDED);

    let amount = vault.balance.value();
    if (amount == 0) return;

    let payment = coin::from_balance(balance::withdraw_all(&mut vault.balance), ctx);
    transfer::public_transfer(payment, event.utility);
    emit(Reclaimed { event_id: object::id(event), amount });
}
