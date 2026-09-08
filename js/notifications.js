// notifications.js - Central notification dispatcher.
//
// Every call is gated by the user's saved preference from
// notification-settings.html (localStorage keys "notif_roundResults",
// "notif_transactions", "notif_promotions", "notif_missions" - default
// ON unless explicitly set to "false", same convention that page uses).
//
// Uses the browser's native Notification API when permission is granted
// - a real OS-level notification that still shows even if this tab
// isn't focused, as long as the browser itself is open. Falls back to
// an in-page toast when permission isn't granted yet, was denied, or
// the browser doesn't support it - so something still visibly happens
// either way, on the very first call.
//
// SCOPE, worth being clear about: this fires while the app is open in a
// browser tab (foreground or background). It is NOT push-to-a-closed-app
// - that needs a separate stack entirely (Firebase Cloud Messaging, a
// service worker, and a backend trigger for each event). If that's
// wanted later, this file is the natural place to add it.
//
// Usage from anywhere: window.notifyIfEnabled(category, title, body)
// category is one of: "roundResults" | "transactions" | "promotions" | "missions"

(function () {
    function isEnabled(category) {
        return localStorage.getItem("notif_" + category) !== "false";
    }

    let permissionAsked = false;

    async function ensurePermission() {
        if (!("Notification" in window)) return "unsupported";
        if (Notification.permission === "granted") return "granted";
        if (Notification.permission === "denied") return "denied";

        // Only ever prompt once per page load - repeatedly asking after
        // a "not now" is exactly the kind of thing that gets a site's
        // notification permission auto-blocked by the browser.
        if (permissionAsked) return Notification.permission;
        permissionAsked = true;

        try {
            return await Notification.requestPermission();
        } catch (err) {
            return "denied";
        }
    }

    function showToast(title, body) {
        let toast = document.getElementById("appNotifyToast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "appNotifyToast";
            toast.style.cssText =
                "position:fixed;left:50%;top:16px;transform:translateX(-50%);" +
                "background:#1f1f2e;color:#fff;padding:12px 18px;border-radius:10px;" +
                "font-size:13px;font-family:Arial,sans-serif;z-index:9999;" +
                "box-shadow:0 4px 16px rgba(0,0,0,0.4);opacity:0;transition:opacity .25s;" +
                "pointer-events:none;max-width:85vw;text-align:left;";
            document.body.appendChild(toast);
        }

        toast.innerHTML = "<strong>" + title + "</strong><br>" + body;
        toast.style.opacity = "1";

        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.style.opacity = "0";
        }, 3500);
    }

    window.notifyIfEnabled = async function (category, title, body) {
        if (!isEnabled(category)) return;

        const permission = await ensurePermission();

        if (permission === "granted") {
            try {
                new Notification(title, { body, icon: "aviator-logo.png" });
                return;
            } catch (err) {
                // Some environments (e.g. certain mobile browsers) allow
                // permission but throw on construction - fall through to
                // the toast instead of silently failing.
            }
        }

        showToast(title, body);
    };

    // Missions already announces its own completions via this event
    // (see js/missions.js) - listening here means every mission
    // completion respects the "Missions" notification toggle too,
    // without touching missions.js itself at all.
    document.addEventListener("missionCompleted", (e) => {
        const def = window.MISSION_DEFINITIONS &&
            window.MISSION_DEFINITIONS.find((m) => m.id === e.detail.missionId);
        if (def) {
            window.notifyIfEnabled("missions", "Mission complete! 🎯", def.title);
        }
    });
})();