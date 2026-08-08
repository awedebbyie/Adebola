// =========================
// BOTTOM NAV (Home / Leaderboard / Missions / Rewards)
// =========================
// Lives in normal document flow right after the bet-history panel (see
// index.html), so it's simply the last thing on the page - it only
// comes into view once the user scrolls all the way down to it. No
// JS-driven show/hide here.
//
// Home is this page itself (index.html), so tapping it just
// re-highlights it and scrolls back to the top - it does NOT show the
// "coming soon" toast, unlike Missions/Rewards which have no page yet.
// Leaderboard has a real destination (data-href="leaderboard.html" in
// the markup) and navigates there directly.

document.addEventListener("DOMContentLoaded", () => {

    const nav = document.getElementById("bottomNav");

    if (!nav) return;

    const tabs = nav.querySelectorAll(".bottom-nav-item");
    const toast = document.getElementById("bottomNavToast");
    let toastTimer = null;

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {

            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");

            const href = tab.dataset.href;

            if (href) {
                window.location.href = href;
                return;
            }

            // Home - already on this page, just scroll back to the top
            // instead of showing a "coming soon" toast.
            if (tab.dataset.label === "Home") {
                const scrollEl = document.querySelector(".game-container");
                if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
                return;
            }

            // No landing page yet (Missions/Rewards) - brief toast instead.
            if (toast) {
                toast.textContent = `${tab.dataset.label} - coming soon`;
                toast.classList.add("visible");

                clearTimeout(toastTimer);
                toastTimer = setTimeout(() => {
                    toast.classList.remove("visible");
                }, 1500);
            }
        });
    });

});
