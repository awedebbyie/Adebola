// =========================
// GAME STATE POLLING (Supabase)
// =========================

window.myQueuedBets = window.myQueuedBets || {}; // { [slot]: amount } - bets waiting for the next betting window
window.countdownStartedForRoundId = window.countdownStartedForRoundId || null;

// Tracks whether we've received any poll response yet this page load.
// Used to detect "just refreshed mid-round" - see the countdown logic
// further down.
let hasSeenFirstState = false;

// Must match the sleep() duration for the betting window in
// engine/gameEngine.js exactly - that file is the real source of truth
// for this timing. The countdown bar always animates this full duration
// from the moment a betting window is genuinely observed starting -
// deliberately not computed from server vs. browser clocks, since those
// don't reliably agree (see git history / prior fix notes).
const BETTING_WINDOW_MS = 5000;

async function getCurrentGameState() {

    const { data, error } = await window.supabaseClient
        .from("current_round")
        .select("*")
        .single();

    if (error) {
        console.error("Game state error:", error);
        return;
    }

    updateGameFromServer(data);
}

setInterval(getCurrentGameState, 250);

// The moment this tab comes back into focus - after being backgrounded,
// switched away from, minimized, whatever - re-sync immediately instead
// of waiting for the next (possibly delayed) 250ms poll tick. This is
// the "make the game the controller again" fix: don't wait to notice a
// transition, just go ask the server what's true right now and let the
// normal state-handling logic above reconcile everything to that.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        getCurrentGameState();

        if (typeof window.refreshRoundHistoryFromServer === "function") {
            window.refreshRoundHistoryFromServer();
        }
    }
});

function updateGameFromServer(state) {

    // Save latest game state globally
    window.currentGameState = state;

    // Check for a crash on every poll tick, not just when the flight
    // animation loop happens to be running. requestAnimationFrame (which
    // normally drives this check) is fully paused on a hidden tab, so
    // without this, a crash that happens while you're backgrounded never
    // gets processed - see the long comment on checkForCrash() in
    // aviator.js for the full chain of what that used to break.
    if (typeof window.checkForCrash === "function") {
        window.checkForCrash();
    }

    // Re-render every invest button from current round state + Firestore bet state
    refreshAllBetButtons();

    // Update multiplier display
    const multiplierEl = document.querySelector(".multiplier");

    if (multiplierEl) {
        // Never shown during betting/countdown - there's no real
        // multiplier yet (the server just holds it at 1 as a DB default,
        // not a meaningful value). This runs on every poll tick, not just
        // on a round transition, so it also covers landing mid-countdown
        // on a fresh page refresh, not just normal round-to-round flow.
        // aviator.js's resetGame() sets it back to opacity 1 once flying
        // actually starts.
        if (state.status === "betting") {
            multiplierEl.style.opacity = "0";
        } else {
            multiplierEl.textContent = Number(state.multiplier).toFixed(2) + "x";
        }
    }

    // Provably-fair live hash indicator - defined in js/fairnessPanel.js.
    // Kept as an optional hook (typeof check) so this file doesn't break
    // if that script isn't loaded on a given page.
    if (typeof window.updateFairnessDisplay === "function") {
        window.updateFairnessDisplay(state);
    }

    // Detect when a new round starts
    if (window.lastRoundId !== state.round_id) {

        window.lastRoundId = state.round_id;

        if (typeof listenForBets === "function") {
            listenForBets();
        }

        if (typeof listenForMyBets === "function") {
            listenForMyBets();
        }

        // Auto-place any bets that were queued while the previous round
        // was flying/settling, now that a fresh betting window is open.
        // Also auto-places a fresh bet for any slot with auto-bet armed
        // (window.autoBetEnabled, set in js/invest.js) that doesn't
        // already have something queued/pending this round - that's what
        // makes auto-bet keep re-arming itself round after round instead
        // of firing only once.
        // NOTE: these are placed sequentially (awaited one at a time) -
        // firing them concurrently would let both calls read the same
        // stale balance and race each other on the deduction.
        if (state.status === "betting") {

            const queuedSlots = Object.keys(window.myQueuedBets);
            const mySlotState = window.mySlotState || {};
            const autoBetEnabled = window.autoBetEnabled || {};
            const investRows = document.querySelectorAll(".invest-row");

            const autoSlots = Object.keys(autoBetEnabled).filter((slot) => {
                if (!autoBetEnabled[slot]) return false;
                if (queuedSlots.includes(slot)) return false; // already queued above
                const myBet = mySlotState[slot];
                if (myBet && myBet.status === "Pending") return false; // already has a bet this round
                return true;
            });

            (async () => {

                for (const slot of queuedSlots) {

                    const amount = window.myQueuedBets[slot];
                    delete window.myQueuedBets[slot];

                    if (typeof createBet === "function") {
                        try {
                            await createBet(amount, Number(slot));
                        } catch (err) {
                            console.error("Queued bet failed:", err);
                        }
                    }
                }

                for (const slot of autoSlots) {

                    const row = investRows[Number(slot) - 1];
                    const input = row && row.querySelector(".amount-input");
                    const amount = input ? Number(input.value) : NaN;

                    if (isNaN(amount) || amount < 10) {
                        // Row's amount became invalid somehow (e.g. cleared) -
                        // don't silently bet nothing; just skip this round
                        // and leave auto-bet armed for the next one.
                        continue;
                    }

                    if (typeof createBet === "function") {
                        try {
                            await createBet(amount, Number(slot));
                        } catch (err) {
                            console.error("Auto bet failed:", err);
                        }
                    }
                }

                refreshAllBetButtons();

            })();
        }

        console.log("🔄 Switched to Round:", state.round_id);
    }

    // Shows the "preparing for next round" countdown - deliberately
    // OUTSIDE the round-change block above, so it's checked on every
    // single poll tick (every 250ms), not just once at the moment a new
    // round is first detected. That matters: if the flew-away crash
    // message (window.flewAwayActive, set in aviator.js) is still
    // showing when the new betting window opens, this simply doesn't
    // fire yet - it just checks again next tick, and again, until
    // flewAway finishes and clears the flag. The
    // countdownStartedForRoundId guard makes sure it still only actually
    // fires once per round, no matter how many ticks it took to get
    // there.
    if (
        state.status === "betting" &&
        window.countdownStartedForRoundId !== state.round_id
    ) {
        if (!hasSeenFirstState) {
            // This is the very first state this page has ever observed,
            // and it's already mid-betting-window - almost always means
            // the page was refreshed partway through an existing
            // countdown. We have no honest way to know how much real
            // time is actually left without comparing this browser's
            // clock to the server's, which caused a real bug before
            // (they don't reliably agree). Rather than animate a
            // countdown that's likely wrong, skip it for just this one
            // in-progress window - it'll be accurate again starting with
            // the very next round, which this page will genuinely watch
            // begin from zero.
            window.countdownStartedForRoundId = state.round_id;
        } else if (!window.flewAwayActive) {
            window.countdownStartedForRoundId = state.round_id;

            if (typeof window.showBettingCountdown === "function") {
                window.showBettingCountdown(BETTING_WINDOW_MS);
            }
        }
    }

    hasSeenFirstState = true;

// Start animation when backend enters flying state
if (
    state.status === "flying" &&
    typeof window.beginRound === "function" &&
    !window.animationRunning
) {
    console.log("🚁 Starting frontend animation...");
    window.beginRound(state.multiplier);
}

    // Auto cash-out - checked on every poll tick while flying, same as
    // the crash check above. For every slot with a target armed
    // (window.autoCashoutTarget, set in js/invest.js) that still has a
    // pending bet, cash out the instant the live multiplier reaches that
    // target. cashOut() itself guards against duplicate/overlapping calls
    // per slot (window.isProcessingCashOut in js/bets.js), so it's safe
    // to just call it again on every tick until the bet actually settles.
    if (state.status === "flying") {
        const autoCashoutTarget = window.autoCashoutTarget || {};
        const mySlotState = window.mySlotState || {};
        const multiplier = Number(state.multiplier);

        Object.keys(autoCashoutTarget).forEach((slot) => {
            const target = autoCashoutTarget[slot];
            if (target == null) return;

            const myBet = mySlotState[slot];
            if (!myBet || myBet.status !== "Pending") return;

            if (multiplier >= target && typeof cashOut === "function") {
                cashOut(Number(slot));
            }
        });
    }

    // The round just crashed - settle any of my own still-active bets as
    // losses. Guarded by round_id so this only fires once per round even
    // though this function runs on every 250ms poll tick.
   if (
        state.status === "crashed" &&
        window.lastCrashedRoundId !== state.round_id &&
        typeof window.settleLostBets === "function"
    ) {
        window.lastCrashedRoundId = state.round_id;
        window.settleLostBets();

        if (typeof window.recordRoundHistory === "function") {
            window.recordRoundHistory(state.crash_point, state.round_id, state.round_number);
        }
    }

    console.log("Status:", state.status, "Multiplier:", state.multiplier);
}

// =========================
// SINGLE SOURCE OF TRUTH FOR BUTTON UI
// (Every other file should call updateBetButton / refreshAllBetButtons
// instead of writing to button.innerHTML directly.)
// =========================

function updateBetButton(slot, uiState, payload) {

    const investButtons = document.querySelectorAll(".invest-btn");
    const investRows = document.querySelectorAll(".invest-row");
    const btn = investButtons[slot - 1];
    const row = investRows[slot - 1];
    const input = row && row.querySelector(".amount-input");
    const priceBtns = row ? row.querySelectorAll(".price-btn") : [];

    if (!btn) return;

    btn.disabled = false;
    btn.style.opacity = "";
    if (input) input.disabled = false;
    priceBtns.forEach((pBtn) => { pBtn.disabled = false; });

    switch (uiState) {

        case "INVEST": {
            // Auto-bet armed for this slot (js/invest.js) means the slot's
            // next bet gets placed automatically the moment betting opens
            // - manual investing is locked out here so the two can't
            // conflict/double-place. This only applies to the INVEST case:
            // an already-pending bet still shows CASH_OUT/BET_PLACED below
            // and stays fully clickable either way, since cashing out
            // manually is a separate action from placing a new bet.
            if (window.autoBetEnabled && window.autoBetEnabled[slot]) {
                btn.innerHTML = "<span>AUTO BET ON</span>";
                btn.style.backgroundColor = "";
                btn.disabled = true;
                btn.style.opacity = "0.4";
                priceBtns.forEach((pBtn) => { pBtn.disabled = true; });
                break;
            }

            const amount = payload && payload.amount;
            if (amount != null) {
                btn.innerHTML = `
                    <span>INVEST</span>
                    <small>(₦${Number(amount).toFixed(2)})</small>
                `;
            } else {
                btn.innerHTML = "<span>INVEST</span>";
            }
            btn.style.backgroundColor = "";
            break;
        }

        case "BET_PLACED":
            btn.innerHTML = "<span>INVESTED</span>";
            btn.style.backgroundColor = "";
            break;

        case "CASH_OUT": {
            const amount = Number((payload && payload.amount) || 0);
            const multiplier = Number((payload && payload.multiplier) || 1);
            const potential = amount * multiplier;

            btn.innerHTML = `
                <span>CASH OUT</span>
                <small>(₦${potential.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })})</small>
            `;
            btn.style.backgroundColor = "#ff8800";
            break;
        }

        case "QUEUED":
            btn.innerHTML = `
                <span>QUEUED</span>
                <small>(₦${Number((payload && payload.amount) || 0).toFixed(2)})</small>
            `;
            btn.style.backgroundColor = "";
            // Bet is locked in and waiting for the next betting window to
            // auto-place it - disable + dim the whole row so it's obvious
            // nothing here is actionable until it's actually placed.
            btn.disabled = true;
            btn.style.opacity = "0.4";
            if (input) input.disabled = true;
            priceBtns.forEach((pBtn) => { pBtn.disabled = true; });
            break;

        default:
            btn.innerHTML = "<span>INVEST</span>";
            btn.style.backgroundColor = "";
            break;
    }
}

function refreshAllBetButtons() {

    if (!window.currentGameState) return;

    const status = window.currentGameState.status;
    const investButtons = document.querySelectorAll(".invest-btn");
    const investRows = document.querySelectorAll(".invest-row");
    const mySlotState = window.mySlotState || {};
    const myQueuedBets = window.myQueuedBets || {};

    investButtons.forEach((btn, index) => {

        const slot = index + 1;
        const myBet = mySlotState[slot];
        const hasPending = myBet && myBet.status === "Pending";

        if (hasPending) {

            if (status === "flying") {
                updateBetButton(slot, "CASH_OUT", {
                    amount: myBet.amount,
                    multiplier: window.currentGameState.multiplier
                });
            } else {
                updateBetButton(slot, "BET_PLACED");
            }

        } else if (myQueuedBets[slot] != null) {

            updateBetButton(slot, "QUEUED", { amount: myQueuedBets[slot] });

        } else {

            // No active bet, no queued bet - always shows INVEST and is
            // always clickable. invest.js decides whether that click places
            // a bet now or queues it for the next round. Keep showing
            // whatever amount is currently sitting in this row's input (from
            // typing or a quick price button) in brackets, so it doesn't
            // flash away on the next 250ms poll tick - it only clears once
            // the row itself clears the input (bet placed/queued).
            const row = investRows[slot - 1];
            const input = row && row.querySelector(".amount-input");
            const typedValue = input ? Number(input.value) : NaN;
            const amount = !isNaN(typedValue) && typedValue >= 10 ? typedValue : null;

            updateBetButton(slot, "INVEST", { amount });
        }

    });
}

window.updateBetButton = updateBetButton;
window.refreshAllBetButtons = refreshAllBetButtons;