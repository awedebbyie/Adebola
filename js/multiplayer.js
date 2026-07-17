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

        console.log("Current round:", currentRoundId);

        listenForBets();

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

            if (!list) return;

            list.innerHTML = "";

            snapshot.forEach(doc => {

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

window.startNewRound = startNewRound;
window.createBet = createBet;
window.listenForBets = listenForBets;