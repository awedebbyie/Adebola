// =========================
// GAME STATE POLLING (Supabase)
// =========================

window.myQueuedBets = window.myQueuedBets || {}; // { [slot]: amount } - bets waiting for the next betting window

// Must match the sleep() duration for the betting window in
// engine/gameEngine.js exactly - that file is the real source of truth
// for this timing; this constant only exists so the countdown bar can
// compute how much of the window is ACTUALLY left (in case this poll
// tick first observes "betting" a little after it truly started),
// rather than always assuming the full window remains.
const BETTING_WINDOW_MS = 7000;

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

function updateGameFromServer(state) {

    // Save latest game state globally
    window.currentGameState = state;

    // Re-render every invest button from current round state + Firestore bet state
    refreshAllBetButtons();

    // Update multiplier display
    const multiplierEl = document.querySelector(".multiplier");

    if (multiplierEl) {
        multiplierEl.textContent = Number(state.multiplier).toFixed(2) + "x";
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
        // NOTE: these are placed sequentially (awaited one at a time) -
        // firing them concurrently would let both calls read the same
        // stale balance and race each other on the deduction.
        if (state.status === "betting") {

            // Real countdown, not a guess: compute exactly how much of
            // the window is left (started_at is set by the server) and
            // hand that to aviator.js's window.showBettingCountdown(),
            // which sets the CSS transition duration to match exactly.
            const startedAt = new Date(state.started_at).getTime();
            const elapsed = Date.now() - startedAt;
            const remaining = Math.max(0, BETTING_WINDOW_MS - elapsed);

            if (typeof window.showBettingCountdown === "function") {
                window.showBettingCountdown(remaining);
            }

            const queuedSlots = Object.keys(window.myQueuedBets);

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

                refreshAllBetButtons();

            })();
        }

        console.log("🔄 Switched to Round:", state.round_id);
    }
// Start animation when backend enters flying state
if (
    state.status === "flying" &&
    typeof window.beginRound === "function" &&
    !window.animationRunning
) {
    console.log("🚁 Starting frontend animation...");
    window.beginRound(state.multiplier);
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
    const btn = investButtons[slot - 1];

    if (!btn) return;

    btn.disabled = false;

    switch (uiState) {

        case "INVEST": {
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