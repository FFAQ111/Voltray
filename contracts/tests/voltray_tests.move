#[test_only]
module voltray::voltray_tests;

use sui::clock;
use sui::coin::{Self, Coin};
use sui::ed25519;
use sui::sui::SUI;
use sui::test_scenario as ts;
use voltray::voltray::{Self, DREvent, RewardVault, SmartMeter};

const UTILITY: address = @0xACE;
const USER: address = @0xBEEF;

// Event runs over [START, END]; clock is parked inside the window unless a test moves it.
const START: u64 = 1_000;
const END: u64 = 5_000;
const REWARD_PER_UNIT: u64 = 10;
const TARGET_REDUCTION: u64 = 100;
const VAULT_FUNDING: u64 = 1_000; // = TARGET_REDUCTION * REWARD_PER_UNIT
// A syntactically valid 32-byte charger key. The payout/auth tests drive settle_for_testing,
// which skips signature verification, so only the length matters here (create_event checks it).
const CHARGER_PK: vector<u8> = b"01234567890123456789012345678901";

// create_event aborts when the coin does not cover the worst-case payout
// (reward_per_unit * target_reduction).
#[test, expected_failure(abort_code = voltray::E_UNDERFUNDED)]
fun create_event_rejects_underfunded_vault() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING - 1, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };
    scenario.end();
}

// create_event aborts on an inverted or empty window (start >= end).
#[test, expected_failure(abort_code = voltray::E_INVALID_WINDOW)]
fun create_event_rejects_inverted_window() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, END, START, CHARGER_PK, scenario.ctx());
    };
    scenario.end();
}

// create_event aborts when the charger key is not exactly 32 bytes.
#[test, expected_failure(abort_code = voltray::E_BAD_PUBKEY)]
fun create_event_rejects_bad_pubkey() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, b"too-short", scenario.ctx());
    };
    scenario.end();
}

// sui::ed25519::ed25519_verify is the primitive settle() relies on: it accepts a valid
// (pubkey, message, signature) and rejects any tampering. Vector from RFC 8032 §7.1 TEST 2.
#[test]
fun ed25519_verify_accepts_valid_and_rejects_tampered() {
    let pk = x"3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
    let sig =
        x"92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";
    assert!(ed25519::ed25519_verify(&sig, &pk, &x"72"), 0);
    // Flip the message byte -> the signature no longer matches.
    assert!(!ed25519::ed25519_verify(&sig, &pk, &x"73"), 1);
}

// The real settle() rejects a reading whose signature does not verify against the event's
// charger key. A valid signature is over runtime object IDs (unknowable when authoring a unit
// test), so the positive path is covered on testnet per TRUST.md §5.1; here we prove the gate.
#[test, expected_failure(abort_code = voltray::E_BAD_SIGNATURE)]
fun settle_rejects_bad_signature() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let event_id = object::id(&event);
        // 64 zero bytes: well-formed length, but not a valid signature for this key/message.
        let bad_sig =
            x"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        voltray::settle(&mut event, &mut vault, USER, event_id, 30, bad_sig, scenario.ctx());
        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}

// Drive create -> register -> respond -> settle and assert the responder is paid
// min(saved_units, remaining) * reward_per_unit.
#[test]
fun full_lifecycle_pays_responder() {
    let mut scenario = ts::begin(UTILITY);

    // Utility funds and creates the event.
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    // User registers a meter.
    scenario.next_tx(USER);
    {
        voltray::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    // User responds inside the window.
    scenario.next_tx(USER);
    {
        let event = scenario.take_shared<DREvent>();
        let mut meter = scenario.take_from_sender<SmartMeter>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(2_000);

        voltray::respond(&event, &mut meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        scenario.return_to_sender(meter);
        ts::return_shared(event);
    };

    // Utility (acting as oracle) settles 30 saved units.
    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let event_id = object::id(&event);

        voltray::settle_for_testing(&mut event, &mut vault, USER, event_id, 30, scenario.ctx());

        ts::return_shared(event);
        ts::return_shared(vault);
    };

    // User now holds a 30 * 10 = 300 SUI payout.
    scenario.next_tx(USER);
    {
        let payout = scenario.take_from_sender<Coin<SUI>>();
        assert!(payout.value() == 300, 0);
        coin::burn_for_testing(payout);
    };

    scenario.end();
}

// saved_units above remaining_units is capped at remaining_units (FCFS).
#[test]
fun settle_caps_payout_at_remaining_units() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();

        let event_id = object::id(&event);
        // Ask for 150 units; only 100 remain, so payout is 100 * 10 = 1000.
        voltray::settle_for_testing(&mut event, &mut vault, USER, event_id, 150, scenario.ctx());

        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.next_tx(USER);
    {
        let payout = scenario.take_from_sender<Coin<SUI>>();
        assert!(payout.value() == 1_000, 0);
        coin::burn_for_testing(payout);
    };

    scenario.end();
}

// Only event.utility may settle.
#[test, expected_failure(abort_code = voltray::E_NOT_UTILITY)]
fun settle_rejects_non_utility() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(USER); // USER is not the utility
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let event_id = object::id(&event);
        voltray::settle_for_testing(&mut event, &mut vault, USER, event_id, 10, scenario.ctx());
        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}

// settle aborts if the vault does not belong to the event.
#[test, expected_failure(abort_code = voltray::E_WRONG_VAULT)]
fun settle_rejects_mismatched_vault() {
    let mut scenario = ts::begin(UTILITY);

    // Event A — keep its objects taken out of the shared inventory.
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };
    scenario.next_tx(UTILITY);
    let mut event_a = scenario.take_shared<DREvent>();
    let vault_a = scenario.take_shared<RewardVault<SUI>>();

    // Event B — with A's objects out, these takes are unambiguous.
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };
    scenario.next_tx(UTILITY);
    let event_b = scenario.take_shared<DREvent>();
    let mut vault_b = scenario.take_shared<RewardVault<SUI>>();

    // Settle event A against event B's vault -> E_WRONG_VAULT.
    let event_a_id = object::id(&event_a);
    voltray::settle_for_testing(&mut event_a, &mut vault_b, USER, event_a_id, 10, scenario.ctx());

    ts::return_shared(event_a);
    ts::return_shared(vault_a);
    ts::return_shared(event_b);
    ts::return_shared(vault_b);
    scenario.end();
}

// The same meter cannot be settled twice for one event (on-chain payout dedup on the vault).
#[test, expected_failure(abort_code = voltray::E_ALREADY_SETTLED)]
fun settle_rejects_double_settle() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let event_id = object::id(&event);

        voltray::settle_for_testing(&mut event, &mut vault, USER, event_id, 30, scenario.ctx());
        // Second settle for the same meter aborts.
        voltray::settle_for_testing(&mut event, &mut vault, USER, event_id, 30, scenario.ctx());

        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}

// Regression: a pledge settled after FCFS has drained the pool (units_paid == 0) must still be
// recorded — dedup set, Settled emitted — not silently skipped. Otherwise it never lands in the
// Settled log and an automated settler retries it forever. Proven by: the zero-payout settle does
// NOT abort, and repeating it aborts E_ALREADY_SETTLED (so the marker was set the first time).
#[test, expected_failure(abort_code = voltray::E_ALREADY_SETTLED)]
fun settle_zero_payout_is_recorded_not_skipped() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let meter_a = object::id_from_address(@0xA1);
        let meter_b = object::id_from_address(@0xB2);

        // Drain the entire pool on meter_a.
        voltray::settle_for_testing(&mut event, &mut vault, USER, meter_a, TARGET_REDUCTION, scenario.ctx());
        // meter_b: pool now empty -> 0 payout, but must be marked settled (must NOT abort).
        voltray::settle_for_testing(&mut event, &mut vault, USER, meter_b, 30, scenario.ctx());
        // Repeating meter_b proves the marker was set the first time -> E_ALREADY_SETTLED.
        voltray::settle_for_testing(&mut event, &mut vault, USER, meter_b, 30, scenario.ctx());

        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}

// respond aborts if the caller does not own the meter.
#[test, expected_failure(abort_code = voltray::E_NOT_METER_OWNER)]
fun respond_rejects_non_owner() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        voltray::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    // A different address tries to respond with USER's meter.
    scenario.next_tx(USER);
    let mut meter = scenario.take_from_sender<SmartMeter>();
    scenario.next_tx(@0xCAFE);
    {
        let event = scenario.take_shared<DREvent>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(2_000);

        voltray::respond(&event, &mut meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        ts::return_shared(event);
    };

    transfer::public_transfer(meter, USER);
    scenario.end();
}

// respond aborts outside the [start, end] window.
#[test, expected_failure(abort_code = voltray::E_OUTSIDE_WINDOW)]
fun respond_rejects_outside_window() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        voltray::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        let event = scenario.take_shared<DREvent>();
        let mut meter = scenario.take_from_sender<SmartMeter>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(END + 1); // past the window

        voltray::respond(&event, &mut meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        scenario.return_to_sender(meter);
        ts::return_shared(event);
    };

    scenario.end();
}

// The same meter cannot respond twice to the same event (on-chain dedup on the meter).
#[test, expected_failure(abort_code = voltray::E_ALREADY_RESPONDED)]
fun respond_rejects_double_response() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        voltray::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        let event = scenario.take_shared<DREvent>();
        let mut meter = scenario.take_from_sender<SmartMeter>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(2_000);

        voltray::respond(&event, &mut meter, &clock, scenario.ctx());
        // Second response to the same event aborts.
        voltray::respond(&event, &mut meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        scenario.return_to_sender(meter);
        ts::return_shared(event);
    };

    scenario.end();
}

// After the window closes, the utility reclaims the unspent vault balance.
#[test]
fun reclaim_returns_unspent_to_utility() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(END + 1); // window closed

        voltray::reclaim_remaining(&event, &mut vault, &clock, scenario.ctx());

        clock.destroy_for_testing();
        ts::return_shared(event);
        ts::return_shared(vault);
    };

    // Nothing was settled, so the full funding comes back to the utility.
    scenario.next_tx(UTILITY);
    {
        let refund = scenario.take_from_sender<Coin<SUI>>();
        assert!(refund.value() == VAULT_FUNDING, 0);
        coin::burn_for_testing(refund);
    };

    scenario.end();
}

// reclaim aborts while the window is still open (END is inclusive, so now == END is "not ended").
#[test, expected_failure(abort_code = voltray::E_EVENT_NOT_ENDED)]
fun reclaim_rejects_before_end() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(END); // still inside the window

        voltray::reclaim_remaining(&event, &mut vault, &clock, scenario.ctx());

        clock.destroy_for_testing();
        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}

// reclaim is restricted to the event's utility.
#[test, expected_failure(abort_code = voltray::E_NOT_UTILITY)]
fun reclaim_rejects_non_utility() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        voltray::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, CHARGER_PK, scenario.ctx());
    };

    scenario.next_tx(USER); // not the utility
    {
        let event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault<SUI>>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(END + 1);

        voltray::reclaim_remaining(&event, &mut vault, &clock, scenario.ctx());

        clock.destroy_for_testing();
        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}
