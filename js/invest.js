window.myQueuedBets = window.myQueuedBets || {}; // { [slot]: amount } - bets waiting for the next betting window

document.addEventListener("DOMContentLoaded", () => {

    const rows = document.querySelectorAll(".invest-row");

    rows.forEach((row) => {

        const betSlot = Array.from(rows).indexOf(row) + 1;

        const input = row.querySelector(".amount-input");
        const investBtn = row.querySelector(".invest-btn");
        const priceBtns = row.querySelectorAll(".price-btn");

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

                        input.value = "";
                        // Button updates via the Firestore listener in bets.js.

                    } else if (result && result.reason === "betting_closed") {

                        window.myQueuedBets[betSlot] = value;
                        input.value = "";

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

                input.value = "";

                if (typeof window.refreshAllBetButtons === "function") {
                    window.refreshAllBetButtons();
                }
            }

        });
    });

});