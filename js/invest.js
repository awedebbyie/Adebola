window.myQueuedBets = window.myQueuedBets || {}; // { [slot]: amount } - bets waiting for the next betting window

// Auto-bet: when true for a slot, gameState.js re-queues a bet for that
// slot every single betting window automatically (using whatever amount
// is currently in that row's input), until turned off here.
window.autoBetEnabled = window.autoBetEnabled || {}; // { [slot]: boolean }

// Auto cash-out: when set for a slot, gameState.js watches the live
// multiplier while that slot has a pending bet and calls cashOut() the
// moment it reaches this target - independent of whether the bet was
// placed manually or via auto-bet.
window.autoCashoutTarget = window.autoCashoutTarget || {}; // { [slot]: number|null }

const MIN_AUTO_BET_AMOUNT = 10;
const MIN_AUTO_CASHOUT_MULTIPLIER = 1.01;

document.addEventListener("DOMContentLoaded", () => {

    const rows = document.querySelectorAll(".invest-row");

    rows.forEach((row) => {

        const betSlot = Array.from(rows).indexOf(row) + 1;

        const input = row.querySelector(".amount-input");
        const investBtn = row.querySelector(".invest-btn");
        const priceBtns = row.querySelectorAll(".price-btn");

        const modeTabs = row.querySelectorAll(".mode-tab");
        const autoBetToggle = row.querySelector(".auto-bet-toggle");
        const autoCashoutToggle = row.querySelector(".auto-cashout-toggle");
        const autoCashoutValue = row.querySelector(".auto-cashout-value");
        const autoCashoutClear = row.querySelector(".auto-cashout-clear");

        // =========================
        // BET / AUTO TABS
        // (Purely a display switch - which controls are visible. Doesn't
        // itself arm/disarm anything; the toggles below do that.)
        // =========================
        modeTabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                modeTabs.forEach((t) => t.classList.remove("active"));
                tab.classList.add("active");
                row.classList.toggle("mode-auto", tab.dataset.mode === "auto");
            });
        });

        // =========================
        // AUTO BET TOGGLE
        // =========================
        if (autoBetToggle) {
            autoBetToggle.addEventListener("change", () => {

                if (!autoBetToggle.checked) {
                    window.autoBetEnabled[betSlot] = false;
                    if (typeof window.refreshAllBetButtons === "function") {
                        window.refreshAllBetButtons();
                    }
                    return;
                }

                const value = Number(input.value);

                if (isNaN(value) || value < MIN_AUTO_BET_AMOUNT) {
                    alert(`Minimum auto bet amount is ₦${MIN_AUTO_BET_AMOUNT}`);
                    autoBetToggle.checked = false;
                    return;
                }

                input.value = value.toFixed(2);
                window.autoBetEnabled[betSlot] = true;

                // If a betting window is open right now and this slot has
                // nothing pending/queued yet, place this round's bet
                // immediately too - otherwise turning auto-bet on mid-window
                // would silently skip the round already in progress.
                // placeOrQueueBet() -> createBet()/queueing already calls
                // refreshAllBetButtons() on success, but only on success -
                // refresh here too so the manual controls lock immediately
                // regardless of which path that takes.
                const status = window.currentGameState && window.currentGameState.status;
                const myBet = (window.mySlotState || {})[betSlot];
                const hasPending = myBet && myBet.status === "Pending";

                if (status === "betting" && !hasPending && window.myQueuedBets[betSlot] == null) {
                    if (typeof placeOrQueueBet === "function") {
                        placeOrQueueBet(betSlot, value, input);
                    }
                }

                if (typeof window.refreshAllBetButtons === "function") {
                    window.refreshAllBetButtons();
                }
            });
        }

        // =========================
        // AUTO CASH OUT TOGGLE + TARGET
        // =========================
        if (autoCashoutValue) {
            autoCashoutValue.addEventListener("input", () => {
                autoCashoutValue.value = autoCashoutValue.value.replace(/[^0-9.]/g, "");
            });

            autoCashoutValue.addEventListener("blur", () => {
                let value = Number(autoCashoutValue.value);
                if (isNaN(value) || value < MIN_AUTO_CASHOUT_MULTIPLIER) {
                    value = MIN_AUTO_CASHOUT_MULTIPLIER;
                }
                autoCashoutValue.value = value.toFixed(2);

                // If auto cash-out is already armed, keep the armed target
                // in sync with whatever the user just edited it to.
                if (autoCashoutToggle && autoCashoutToggle.checked) {
                    window.autoCashoutTarget[betSlot] = value;
                }
            });
        }

        if (autoCashoutToggle) {
            autoCashoutToggle.addEventListener("change", () => {

                if (!autoCashoutToggle.checked) {
                    window.autoCashoutTarget[betSlot] = null;
                    return;
                }

                let value = Number(autoCashoutValue.value);

                if (isNaN(value) || value < MIN_AUTO_CASHOUT_MULTIPLIER) {
                    alert(`Minimum auto cash out is ${MIN_AUTO_CASHOUT_MULTIPLIER.toFixed(2)}x`);
                    autoCashoutToggle.checked = false;
                    return;
                }

                autoCashoutValue.value = value.toFixed(2);
                window.autoCashoutTarget[betSlot] = value;
            });
        }

        if (autoCashoutClear) {
            autoCashoutClear.addEventListener("click", () => {
                autoCashoutValue.value = MIN_AUTO_CASHOUT_MULTIPLIER.toFixed(2);
                if (autoCashoutToggle) autoCashoutToggle.checked = false;
                window.autoCashoutTarget[betSlot] = null;
            });
        }

        // =========================
        // ONLY NUMBERS + DECIMALS
        // (Amount preview - only meaningful while the button is showing
        // INVEST. refreshAllBetButtons() will overwrite this once a bet
        // is placed or queued.)
        // =========================
        input.addEventListener("input", () => {

            input.value = input.value.replace(/[^0-9.]/g, "");

            let value = Number(input.value);

            if (input.value === "" || isNaN(value)) {
                investBtn.innerHTML = `<span>INVEST</span>`;
                return;
            }

            if (value < 10) {
                investBtn.innerHTML = `
                    <span>INVEST</span>
                    <small>(Minimum ₦10)</small>
                `;
                return;
            }

            investBtn.innerHTML = `
                <span>INVEST</span>
                <small>(₦${value.toFixed(2)})</small>
            `;
        });

        // =========================
        // BLUR FIX (FINAL CLEAN VALUE)
        // =========================
        input.addEventListener("blur", () => {

            let value = Number(input.value);

            if (isNaN(value) || value < 10) {
                value = 10;
            }

            input.value = value.toFixed(2);

            investBtn.innerHTML = `
                <span>INVEST</span>
                <small>(₦${value.toFixed(2)})</small>
            `;
        });

        // =========================
        // QUICK PRICE BUTTONS
        // =========================
        priceBtns.forEach((btn) => {

            btn.addEventListener("click", () => {

                let value = Number(btn.textContent);

                if (value < 10) value = 10;

                input.value = value.toFixed(2);

                investBtn.innerHTML = `
                    <span>INVEST</span>
                    <small>(₦${value.toFixed(2)})</small>
                `;
            });

        });

        // =========================
        // INVEST / CASH OUT / QUEUE CLICK
        // =========================
        investBtn.addEventListener("click", async () => {

            const status = window.currentGameState && window.currentGameState.status;
            const myBet = (window.mySlotState || {})[betSlot];
            const hasPending = myBet && myBet.status === "Pending";

            // CASH OUT: round is flying and I have a pending bet in this slot
            if (status === "flying" && hasPending) {

                try {
                    await cashOut(betSlot);
                    // Button updates via the Firestore listener in bets.js.
                } catch (err) {
                    console.error(err);
                    alert("Cash out failed.");
                }

                return;
            }

            // Already have a pending bet this round that isn't cash-out-able
            // right now (e.g. betting phase, or settling) - ignore the click.
            if (hasPending) {
                return;
            }

            // Already queued for next round - ignore repeat clicks.
            if (window.myQueuedBets[betSlot] != null) {
                return;
            }

            let value = Number(input.value);

            if (isNaN(value)) {
                alert("Enter a valid amount");
                return;
            }

            if (value < 10) {

                alert("Minimum investment is ₦10");

                input.value = "10.00";

                investBtn.innerHTML = `
                    <span>INVEST</span>
                    <small>(₦10.00)</small>
                `;

                return;
            }

            await placeOrQueueBet(betSlot, value, input);
        });
    });

});

// =========================
// SHARED BET-PLACEMENT LOGIC
// (Used by the manual INVEST click above, and by the auto-bet toggle to
// place this round's bet immediately when armed mid-window - and by
// gameState.js every subsequent round while auto-bet stays on.)
// =========================
async function placeOrQueueBet(betSlot, value, input) {

    const status = window.currentGameState && window.currentGameState.status;

    if (status === "betting") {

        // Betting window is open - place the bet now. Suppress
        // createBet()'s own "Betting is closed" alert: if the
        // window closes in the brief moment between this click and
        // the request landing, that's a timing race, not a mistake
        // by the player - fall back to queuing it for the next
        // round instead of alerting and throwing the bet away.
        try {

            const result = await createBet(value, betSlot, { suppressClosedAlert: true });

            if (result && result.ok) {

                if (input) input.value = "";
                // Button updates via the Firestore listener in bets.js.

            } else if (result && result.reason === "betting_closed") {

                window.myQueuedBets[betSlot] = value;
                if (input) input.value = "";

                if (typeof window.refreshAllBetButtons === "function") {
                    window.refreshAllBetButtons();
                }
            }
            // Any other failure reason already alerted inside createBet().

        } catch (error) {

            console.error(error);
            alert("Failed to place investment.");

        }

    } else {

        // Not in betting phase (flying/settling) - queue it for
        // the next round instead of placing it immediately, but
        // first make sure the balance can actually cover it
        // alongside anything else already pending or queued.
        const user = auth.currentUser;

        if (!user) {
            alert("You need to be logged in to invest.");
            return;
        }

        try {

            const userDoc = await db.collection("users").doc(user.uid).get();

            if (!userDoc.exists) {
                alert("User account not found.");
                return;
            }

            const balance = Number(userDoc.data().balance || 0);

            const mySlotState = window.mySlotState || {};
            const myQueuedBets = window.myQueuedBets || {};

            let committed = 0;

            Object.keys(mySlotState).forEach((s) => {
                if (mySlotState[s].status === "Pending") {
                    committed += Number(mySlotState[s].amount || 0);
                }
            });

            Object.keys(myQueuedBets).forEach((s) => {
                if (Number(s) !== betSlot) {
                    committed += Number(myQueuedBets[s] || 0);
                }
            });

            if (committed + value > balance) {
                alert("Insufficient balance to queue this bet.");
                return;
            }

        } catch (err) {
            console.error(err);
            alert("Could not verify balance. Please try again.");
            return;
        }

        window.myQueuedBets[betSlot] = value;

        if (input) input.value = "";

        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }
    }
}