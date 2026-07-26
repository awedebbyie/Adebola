// =========================
// FIRESTORE BETS
// =========================

const betsRef = db.collection("bets");

let unsubscribeBets = null;      // public "all bets" list listener
let unsubscribeMyBets = null;    // this user's own bet-state listener (source of truth for UI)

window.mySlotState = window.mySlotState || {};          // { [slot]: { status, amount, cashOutMultiplier, profit } }
window.isProcessingCashOut = window.isProcessingCashOut || {}; // { [slot]: true } while a cash-out request is in flight

// =========================
// ADD A NEW BET
// =========================
async function createBet(amount, betSlot) {
    if (!window.currentGameState) {
        alert("Game not ready.");
        return;
    }

    if (window.currentGameState.status !== "betting") {
        alert("Betting is closed.");
        return;
    }

    const user = auth.currentUser;

    if (!user) return;

    const userRef = db.collection("users").doc(user.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        alert("User account not found.");
        return;
    }

    const balance = Number(userDoc.data().balance || 0);

    if (balance < amount) {
        alert("Insufficient balance.");
        return;
    }

    // Check if this slot already has an active bet
    const existingBet = await betsRef
        .where("uid", "==", user.uid)
        .where("roundId", "==", window.currentGameState.round_id)
        .where("betSlot", "==", betSlot)
        .where("status", "==", "Pending")
        .get();

    if (!existingBet.empty) {
        alert("You already have an active bet in this slot.");
        return;
    }

    try {

        // Deduct balance
        await userRef.update({
            balance: balance - amount
        });

        // Save the bet
        await betsRef.add({
            uid: user.uid,
            username: user.displayName || user.email,
            betSlot: betSlot,
            amount: Number(amount),
            roundId: window.currentGameState.round_id,
            status: "Pending",
            cashOutMultiplier: null,
            profit: 0,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // UI update happens via listenForMyBets' onSnapshot - not here.

    } catch (error) {

        // Refund balance if saving the bet failed
        await userRef.update({
            balance: balance
        });

        console.error(error);
        alert("Failed to place investment.");
    }
}

// =========================
// CASH OUT AN ACTIVE BET
// =========================
async function cashOut(betSlot) {

    const user = auth.currentUser;

    if (!user) return;

    if (!window.currentGameState) return;

    if (window.currentGameState.status !== "flying") {
        alert("Cannot cash out now.");
        return;
    }

    // Prevent duplicate/overlapping cash-out attempts for this slot
    if (window.isProcessingCashOut[betSlot]) {
        return;
    }

    window.isProcessingCashOut[betSlot] = true;

    try {

        const snapshot = await betsRef
            .where("uid", "==", user.uid)
            .where("roundId", "==", window.currentGameState.round_id)
            .where("status", "==", "Pending")
            .where("betSlot", "==", betSlot)
            .get();

        if (snapshot.empty) {
            // Already cashed out (or no bet). Not an error - just let the
            // Firestore listener's next update reflect the true state.
            return;
        }

        const betDoc = snapshot.docs[0];
        const bet = betDoc.data();

        const multiplier = Number(window.currentGameState.multiplier);
        const winnings = bet.amount * multiplier;

        await betDoc.ref.update({
            status: "Cashed Out",
            cashOutMultiplier: multiplier,
            profit: winnings
        });

        const userRef = db.collection("users").doc(user.uid);

        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(winnings)
        });

        // UI update (button -> "CASHED OUT") happens via listenForMyBets' onSnapshot.
        console.log(`✅ Slot ${betSlot} cashed out at ${multiplier.toFixed(2)}x`);

    } catch (error) {

        console.error("Cash out error:", error);
        alert("Cash out failed. Please try again.");

    } finally {

        window.isProcessingCashOut[betSlot] = false;
    }
}

// =========================
// MY OWN BETS (source of truth for button state)
// =========================
function listenForMyBets() {

    const user = auth.currentUser;

    if (unsubscribeMyBets) {
        unsubscribeMyBets();
        unsubscribeMyBets = null;
    }

    if (!user || !window.currentGameState) {
        window.mySlotState = {};
        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }
        return;
    }

    unsubscribeMyBets = betsRef
        .where("uid", "==", user.uid)
        .where("roundId", "==", window.currentGameState.round_id)
        .onSnapshot((snapshot) => {

            const nextState = {};

            snapshot.forEach((doc) => {
                const bet = doc.data();
                nextState[bet.betSlot] = {
                    status: bet.status,
                    amount: bet.amount,
                    cashOutMultiplier: bet.cashOutMultiplier,
                    profit: bet.profit
                };
            });

            window.mySlotState = nextState;

            if (typeof window.refreshAllBetButtons === "function") {
                window.refreshAllBetButtons();
            }

        }, (error) => {
            console.error("listenForMyBets error:", error);
        });
}

// Re-subscribe to "my bets" whenever auth state changes (covers login, and
// covers page refresh - Firestore is queried fresh, nothing relies on
// in-memory state surviving the reload).
auth.onAuthStateChanged((user) => {

    if (user && window.currentGameState) {
        listenForMyBets();
    } else if (!user) {
        if (unsubscribeMyBets) {
            unsubscribeMyBets();
            unsubscribeMyBets = null;
        }
        window.mySlotState = {};
        if (typeof window.refreshAllBetButtons === "function") {
            window.refreshAllBetButtons();
        }
    }
});

// =========================
// LISTEN FOR ALL BETS (public bet list panel)
// =========================
function listenForBets() {

    if (!window.currentGameState) return;

    if (unsubscribeBets) {
        unsubscribeBets();
    }

    unsubscribeBets = betsRef
        .where("roundId", "==", window.currentGameState.round_id)
        .orderBy("timestamp", "desc")
        .onSnapshot((snapshot) => {

            const list = document.getElementById("all-bets-list");
            if (!list) return;

            list.innerHTML = "";

            snapshot.forEach((doc) => {

                const bet = doc.data();

                const row = document.createElement("div");

                row.className = "bet-item";

                row.innerHTML = `
                    <span>${bet.username}</span>
                    <span>₦${bet.amount}</span>
                    <span>${bet.status}</span>
                `;

                list.appendChild(row);

            });

        });

}

window.createBet = createBet;
window.cashOut = cashOut;
window.listenForBets = listenForBets;
window.listenForMyBets = listenForMyBets;