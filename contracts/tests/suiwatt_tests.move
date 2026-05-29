#[test_only]
module suiwatt::suiwatt_tests;

use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario as ts;
use suiwatt::suiwatt::{Self, DREvent, RewardVault, SmartMeter};

const UTILITY: address = @0xACE;
const USER: address = @0xBEEF;

// Event runs over [START, END]; clock is parked inside the window unless a test moves it.
const START: u64 = 1_000;
const END: u64 = 5_000;
const REWARD_PER_UNIT: u64 = 10;
const TARGET_REDUCTION: u64 = 100;
const VAULT_FUNDING: u64 = 1_000; // = TARGET_REDUCTION * REWARD_PER_UNIT

// Drive create -> register -> respond -> settle and assert the responder is paid
// min(saved_units, remaining) * reward_per_unit.
#[test]
fun full_lifecycle_pays_responder() {
    let mut scenario = ts::begin(UTILITY);

    // Utility funds and creates the event.
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };

    // User registers a meter.
    scenario.next_tx(USER);
    {
        suiwatt::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    // User responds inside the window.
    scenario.next_tx(USER);
    {
        let event = scenario.take_shared<DREvent>();
        let meter = scenario.take_from_sender<SmartMeter>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(2_000);

        suiwatt::respond(&event, &meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        scenario.return_to_sender(meter);
        ts::return_shared(event);
    };

    // Utility (acting as oracle) settles 30 saved units.
    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault>();
        let event_id = object::id(&event);

        suiwatt::settle(&mut event, &mut vault, USER, event_id, 30, scenario.ctx());

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
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };

    scenario.next_tx(UTILITY);
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault>();

        let event_id = object::id(&event);
        // Ask for 150 units; only 100 remain, so payout is 100 * 10 = 1000.
        suiwatt::settle(&mut event, &mut vault, USER, event_id, 150, scenario.ctx());

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
#[test, expected_failure(abort_code = suiwatt::E_NOT_UTILITY)]
fun settle_rejects_non_utility() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };

    scenario.next_tx(USER); // USER is not the utility
    {
        let mut event = scenario.take_shared<DREvent>();
        let mut vault = scenario.take_shared<RewardVault>();
        let event_id = object::id(&event);
        suiwatt::settle(&mut event, &mut vault, USER, event_id, 10, scenario.ctx());
        ts::return_shared(event);
        ts::return_shared(vault);
    };

    scenario.end();
}

// settle aborts if the vault does not belong to the event.
#[test, expected_failure(abort_code = suiwatt::E_WRONG_VAULT)]
fun settle_rejects_mismatched_vault() {
    let mut scenario = ts::begin(UTILITY);

    // Event A — keep its objects taken out of the shared inventory.
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };
    scenario.next_tx(UTILITY);
    let mut event_a = scenario.take_shared<DREvent>();
    let vault_a = scenario.take_shared<RewardVault>();

    // Event B — with A's objects out, these takes are unambiguous.
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };
    scenario.next_tx(UTILITY);
    let event_b = scenario.take_shared<DREvent>();
    let mut vault_b = scenario.take_shared<RewardVault>();

    // Settle event A against event B's vault -> E_WRONG_VAULT.
    let event_a_id = object::id(&event_a);
    suiwatt::settle(&mut event_a, &mut vault_b, USER, event_a_id, 10, scenario.ctx());

    ts::return_shared(event_a);
    ts::return_shared(vault_a);
    ts::return_shared(event_b);
    ts::return_shared(vault_b);
    scenario.end();
}

// respond aborts if the caller does not own the meter.
#[test, expected_failure(abort_code = suiwatt::E_NOT_METER_OWNER)]
fun respond_rejects_non_owner() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        suiwatt::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    // A different address tries to respond with USER's meter.
    scenario.next_tx(USER);
    let meter = scenario.take_from_sender<SmartMeter>();
    scenario.next_tx(@0xCAFE);
    {
        let event = scenario.take_shared<DREvent>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(2_000);

        suiwatt::respond(&event, &meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        ts::return_shared(event);
    };

    transfer::public_transfer(meter, USER);
    scenario.end();
}

// respond aborts outside the [start, end] window.
#[test, expected_failure(abort_code = suiwatt::E_OUTSIDE_WINDOW)]
fun respond_rejects_outside_window() {
    let mut scenario = ts::begin(UTILITY);
    {
        let coin = coin::mint_for_testing<SUI>(VAULT_FUNDING, scenario.ctx());
        suiwatt::create_event(coin, REWARD_PER_UNIT, TARGET_REDUCTION, START, END, scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        suiwatt::register_meter(b"meter-1".to_string(), scenario.ctx());
    };

    scenario.next_tx(USER);
    {
        let event = scenario.take_shared<DREvent>();
        let meter = scenario.take_from_sender<SmartMeter>();
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(END + 1); // past the window

        suiwatt::respond(&event, &meter, &clock, scenario.ctx());

        clock.destroy_for_testing();
        scenario.return_to_sender(meter);
        ts::return_shared(event);
    };

    scenario.end();
}
