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

    //await loadBetHistory();
});