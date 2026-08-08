// =========================
// BOTTOM NAV (Home / Leaderboard / Missions / Rewards)
// =========================
// Lives in normal document flow right after the bet-history panel (see
// index.html), so it's simply the last thing on the page - it only
// comes into view once the user scrolls all the way down to it. No
// JS-driven show/hide here.
//
// Landing pages for the four tabs don't exist yet, so tapping one just
// marks it active and shows a brief "coming soon" toast.

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
