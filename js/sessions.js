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
// 2FA ON UNRECOGNIZED DEVICES IS NOT IMPLEMENTED HERE. `recognized:
// false` (returned by registerSession below, the first time a device is
// seen) is the hook point for that, but actually challenging with a
// one-time code needs somewhere to SEND that code (email service, SMS
// provider, or a TOTP secret set up in advance) - none of which exist
// in this codebase yet, so nothing here fakes that step.

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

// Call once, right after a successful login. Returns { recognized,
// deviceId } - recognized is false the very first time this device has
// ever logged into this account.
async function registerSession() {
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
                active: true
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
