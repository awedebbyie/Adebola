// =========================
// SESSIONS / KNOWN DEVICES
// =========================
// Each browser/device gets a random ID (crypto.randomUUID, persisted in
// localStorage - not tied to anything personal). At every login, that
// device's doc at users/{uid}/sessions/{deviceId} is created (first time
// seen) or refreshed (lastSeen bumped, and "active" reset to true).
//
// sessions.html lists every doc in that subcollection so a user can see
// every device that's ever logged into their account and "log out" any
// of them (sets active:false). enforceSessionRevocation(), called
// periodically from pages that stay open a while, checks THIS device's
// own doc and force-signs-out locally if it's been set to active:false
// elsewhere - that's the actual "log out of other devices" mechanism.
//
// This is a client-only implementation - same trust model as the rest
// of this app (balances, bets, etc. are already all client-Firestore
// writes) - not a hard server-side session revocation. A modified/
// malicious client could ignore the check. Treat it as "the honest
// client respects being logged out," not airtight security.
//
// 2FA ON NON-CREATION DEVICES: isCurrentDeviceCreationDevice() (below)
// is what login.html now uses to decide whether to challenge for a
// passkey (see js/passkey.js and the passkey step in login.html) -
// EVERY login from any device other than the one the account was
// created on gets challenged, every time, not just the first time
// that device is seen. If the account has no passkey set, a
// non-creation device still gets in - there's nothing to challenge it
// with.

function getOrCreateDeviceId() {
    let id = localStorage.getItem("deviceId");
    if (!id) {
        id = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem("deviceId", id);
    }
    return id;
}
window.getOrCreateDeviceId = getOrCreateDeviceId;

function describeDevice() {
    const ua = navigator.userAgent;

    let browser = "Unknown browser";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\//.test(ua)) browser = "Opera";
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";

    let os = "Unknown device";
    if (/Windows/.test(ua)) os = "Windows";
    else if (/Mac OS X/.test(ua)) os = "Mac";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Linux/.test(ua)) os = "Linux";

    return `${browser} on ${os}`;
}
window.describeDevice = describeDevice;

// Read-only check: has this device ever logged into this account
// before? Does NOT create or modify anything - safe to call before
// deciding whether a passkey challenge is even needed. This is the
// piece that was missing before: the old registerSession() created the
// session doc the moment it ran, which happened BEFORE the passkey
// challenge - so a device that failed or abandoned that challenge was
// already marked "recognized" for its next attempt, skipping the
// challenge entirely the second time. Checking first, and only
// registering the device once it's actually been let in (further down
// in this file, and in login.html), closes that gap.
async function isDeviceRecognized() {
    const user = auth.currentUser;
    if (!user) return true;

    const deviceId = getOrCreateDeviceId();

    try {
        const snap = await db.collection("users").doc(user.uid)
            .collection("sessions").doc(deviceId).get();
        return snap.exists;
    } catch (err) {
        console.error("isDeviceRecognized failed:", err);
        return true; // fail open - a network blip here shouldn't lock someone out
    }
}
window.isDeviceRecognized = isDeviceRecognized;

// Read-only check: is THIS device the one the account was created on?
// login.html uses this (instead of isDeviceRecognized()) to decide
// whether to require a passkey - unlike isDeviceRecognized(), this
// stays false forever for a non-creation device, so it keeps
// challenging that device on every login, not just its first one.
//
// Mirrors the fallback sessions.html already uses for listing: a
// session doc's own isCreationDevice field is authoritative when
// present, but accounts created before that field existed won't have
// it set on any doc, so in that case whichever session has the
// earliest firstSeen is treated as the creation device instead.
async function isCurrentDeviceCreationDevice() {
    const user = auth.currentUser;
    if (!user) return true; // fail open - consistent with the rest of this file

    const deviceId = getOrCreateDeviceId();

    try {
        const snap = await db.collection("users").doc(user.uid)
            .collection("sessions").doc(deviceId).get();

        // A device that has never logged into this account before can't
        // be the creation device - no need for the fallback query below.
        if (!snap.exists) return false;

        if (snap.data().isCreationDevice) return true;

        const allSnap = await db.collection("users").doc(user.uid)
            .collection("sessions").get();

        let anyFlagged = false;
        let earliestId = null;
        let earliestTime = null;

        allSnap.forEach((doc) => {
            const data = doc.data();
            if (data.isCreationDevice) anyFlagged = true;

            const firstSeenMs = data.firstSeen && data.firstSeen.toDate
                ? data.firstSeen.toDate().getTime()
                : null;

            if (firstSeenMs != null && (earliestTime == null || firstSeenMs < earliestTime)) {
                earliestTime = firstSeenMs;
                earliestId = doc.id;
            }
        });

        // If some other doc genuinely holds the flag, this one isn't it -
        // only fall back to "earliest firstSeen" when nothing is flagged.
        if (anyFlagged) return false;
        return earliestId === deviceId;
    } catch (err) {
        console.error("isCurrentDeviceCreationDevice failed:", err);
        return true; // fail open - a network blip here shouldn't lock someone out
    }
}
window.isCurrentDeviceCreationDevice = isCurrentDeviceCreationDevice;

// Call once a device's login is actually being let through: it was
// already recognized, OR it just passed its passkey challenge, OR there
// was nothing to challenge it with. Creates the session doc (first
// time) or refreshes lastSeen/active (every time after). Pass
// isCreation=true from register.html specifically - that flags this
// device as the account's creation device (isCreationDevice), which
// sessions.html then refuses to ever let get logged out remotely.
// Without that guarantee, someone could revoke every session including
// the one device you know for certain still works, and lock themselves
// out for good with no way back in.
// Returns { recognized, deviceId } - recognized reflects whether this
// device already had a session doc BEFORE this call.
async function registerSession(isCreation) {
    const user = auth.currentUser;
    if (!user) return { recognized: true };

    const deviceId = getOrCreateDeviceId();
    const sessionRef = db.collection("users").doc(user.uid)
        .collection("sessions").doc(deviceId);

    try {
        const snap = await sessionRef.get();
        const recognized = snap.exists;

        if (!recognized) {
            await sessionRef.set({
                deviceName: describeDevice(),
                firstSeen: firebase.firestore.FieldValue.serverTimestamp(),
                lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                active: true,
                isCreationDevice: !!isCreation
            });
        } else {
            await sessionRef.update({
                lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                active: true
            });
        }

        return { recognized, deviceId };
    } catch (err) {
        console.error("registerSession failed:", err);
        return { recognized: true, deviceId };
    }
}
window.registerSession = registerSession;

// Call periodically from any page that stays open a while. Signs this
// device out locally if its own session doc has been marked inactive
// (i.e. someone hit "Log out" on it from sessions.html, on any device).
async function enforceSessionRevocation() {
    const user = auth.currentUser;
    if (!user) return;

    const deviceId = getOrCreateDeviceId();

    try {
        const snap = await db.collection("users").doc(user.uid)
            .collection("sessions").doc(deviceId).get();

        if (snap.exists && snap.data().active === false) {
            await auth.signOut();
            localStorage.removeItem("userData");
            window.location.replace("login.html");
        }
    } catch (err) {
        console.error("enforceSessionRevocation failed:", err);
    }
}
window.enforceSessionRevocation = enforceSessionRevocation;