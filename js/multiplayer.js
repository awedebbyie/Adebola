const betsRef = db.collection("bets");
const gameStateRef = db.collection("gameState").doc("currentRound");
const hostRef = db.collection("gameControl").doc("host");

let isHost = false;

hostRef.onSnapshot(doc => {

    if (!doc.exists) return;

    isHost = doc.data().enabled === true;

    console.log("Host:", isHost);

});

let currentRoundId = null;

// Listen for the current round shared by everyone
gameStateRef.onSnapshot(doc => {

    if (!doc.exists) return;

    const data = doc.data();

    if (currentRoundId !== data.roundId) {

        currentRoundId = data.roundId;

        listenForBets();

        // Start the animation for everyone
    }
});

// Creates a new round by updating Firestore
// (We'll later move this to a server/admin so only one source controls it.)
async function startNewRound() {

    const newRoundId = Date.now().toString();

    await gameStateRef.set({
        roundId: newRoundId,
        status: "betting",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

}

async function createBet(amount) {

    const user = auth.currentUser;

    if (!user || !currentRoundId) return;

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

function listenForBets() {

    if (!currentRoundId) return;

    betsRef
        .where("roundId", "==", currentRoundId)
        .orderBy("timestamp", "desc")
        .onSnapshot(snapshot => {

            const list = document.getElementById("all-bets-list");
            const betCount = document.getElementById("betCount");
            const playerCount = document.getElementById("playerCount");
            const totalWin = document.getElementById("totalWin");

            if (!list) return;

            list.innerHTML = "";

            let players = new Set();
            let total = 0;

            snapshot.forEach(doc => {

                const bet = doc.data();

                players.add(bet.uid);

                total += Number(bet.profit || 0);

                const row = document.createElement("div");
                row.className = "bet-row";

                const multiplier =
                    bet.cashOutMultiplier != null
                        ? bet.cashOutMultiplier.toFixed(2) + "x"
                        : "";

                const win =
                    bet.profit > 0
                        ? "₦" + Number(bet.profit).toLocaleString(undefined,{
                              minimumFractionDigits:2,
                              maximumFractionDigits:2
                          })
                        : "";

                row.innerHTML = `
                    <div class="avatar">👤</div>

                    <div class="player-name">
                        ${bet.username}
                    </div>

                    <div class="bet-amount">
                        ₦${Number(bet.amount).toLocaleString(undefined,{
                            minimumFractionDigits:2,
                            maximumFractionDigits:2
                        })}
                    </div>

                    <div class="multiplier">
                        ${multiplier}
                    </div>

                    <div class="win-amount">
                        ${win}
                    </div>
                `;

                list.appendChild(row);

            });

            if (betCount)
                betCount.textContent = snapshot.size;

            if (playerCount)
                playerCount.textContent = players.size;

            if (totalWin)
                totalWin.textContent = total.toLocaleString(undefined,{
                    minimumFractionDigits:2,
                    maximumFractionDigits:2
                });

        });

}
window.startNewRound = startNewRound;
window.createBet = createBet;
window.listenForBets = listenForBets;