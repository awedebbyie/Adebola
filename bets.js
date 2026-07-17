// =========================
// FIRESTORE BETS
// =========================

const betsRef = db.collection("bets");
let currentRoundId = null;
function startNewRound() {

    currentRoundId = Date.now().toString();

}

// Add a new bet
async function createBet(amount) {
    const user = auth.currentUser;

    if (!user) return;

    await betsRef.add({

    uid: user.uid,

    username: user.displayName || user.email,

    amount: Number(amount),

    roundId: currentRoundId,

    status: "Pending",

    cashOutMultiplier: null,

    profit: 0,

    timestamp: firebase.firestore.FieldValue.serverTimestamp()

});
}

// Listen for all bets in real time
function listenForBets() {

    betsRef
.where("roundId", "==", currentRoundId)
.orderBy("timestamp", "desc")
        .onSnapshot((snapshot) => {

            const list = document.getElementById("all-bets-list");

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