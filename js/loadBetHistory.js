document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("betHistoryContainer");
    const response = await fetch("bet-history-panel.html");
    container.innerHTML = await response.text();

    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        });
    });

    // The panel markup (all-bets-list, my-bets-list, betCount, etc.) only
    // exists in the DOM from this point on, so kick off the live renderers
    // here rather than relying on gameState.js's round-change trigger,
    // which may have already fired before this fetch finished.
    if (typeof window.listenForBets === "function") {
        window.listenForBets();
    }

    if (typeof window.listenForMyBetHistory === "function") {
        window.listenForMyBetHistory();
    }

    if (typeof window.listenForTopWins === "function") {
        window.listenForTopWins();
    }
});