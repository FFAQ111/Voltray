/// SuiWatt: on-chain Demand Response (DR) for a hackathon MVP.
/// See docs/ARCHITECTURE.md for object schema, settlement model, and MVP decisions.
module suiwatt::suiwatt;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event::emit;
use sui::sui::SUI;

// ===== Errors =====

const E_NOT_UTILITY: u64 = 0;
const E_NOT_METER_OWNER: u64 = 1;
const E_OUTSIDE_WINDOW: u64 = 2;
const E_WRONG_VAULT: u64 = 3;

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
}

// TODO(post-MVP): consider a shared reward pool across events instead of one vault per event.
public struct RewardVault has key {
    id: UID,
    event_id: ID,
    balance: Balance<SUI>,
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

// ===== Entry functions =====

public fun create_event(
    reward_coin: Coin<SUI>,
    reward_per_unit: u64,
    target_reduction: u64,
    start_time: u64,
    end_time: u64,
    ctx: &mut TxContext,
) {
    let utility = ctx.sender();
    let event = DREvent {
        id: object::new(ctx),
        utility,
        reward_per_unit,
        target_reduction,
        remaining_units: target_reduction,
        start_time,
        end_time,
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
    meter: &SmartMeter,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let responder = ctx.sender();
    assert!(meter.owner == responder, E_NOT_METER_OWNER);

    let ts = clock.timestamp_ms();
    assert!(ts >= event.start_time && ts <= event.end_time, E_OUTSIDE_WINDOW);

    emit(MeterResponded {
        event_id: object::id(event),
        meter_id: object::id(meter),
        responder,
        timestamp: ts,
    });
}

// TODO(post-MVP): replace admin-only check with oracle signature verification or multisig.
// TODO(post-MVP): pro-rata or auction-style allocation instead of FCFS.
public fun settle(
    event: &mut DREvent,
    vault: &mut RewardVault,
    responder: address,
    meter_id: ID,
    saved_units: u64,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == event.utility, E_NOT_UTILITY);
    assert!(vault.event_id == object::id(event), E_WRONG_VAULT);

    let units_paid = if (saved_units < event.remaining_units) saved_units
                     else event.remaining_units;
    if (units_paid == 0) return;

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
