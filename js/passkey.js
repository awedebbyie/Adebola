// =========================
// PASSKEY (2FA on unrecognized devices)
// =========================
// This is a user-chosen secondary passphrase, NOT a WebAuthn/FIDO2
// hardware passkey - "passkey" here just means "the extra thing you're
// asked for," per what was actually asked for: something that gets
// requested when logging in on a device the account hasn't used before.
//
// Only the SHA-256 hash of `${uid}:${passkey}` is ever stored (on the
// user's own doc, field `passkeyHash`) - the plaintext passkey never
// touches Firestore or leaves the browser it was typed into. Salting
// with the user's own uid means two users who happen to pick the same
// passkey don't end up with the same stored hash.
//
// This is a client-side SHA-256 check (Web Crypto's subtle.digest),
// same trust model as the rest of this app - not a substitute for a
// real server-verified 2FA flow, but consistent with everything else
// here already being client+Firestore only.

async function hashPasskey(uid, passkey) {
    const enc = new TextEncoder();
    const data = enc.encode(`${uid}:${passkey}`);
    const digestBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
window.hashPasskey = hashPasskey;

// Returns { hasPasskey: bool } without needing to already know the
// current user's doc contents - used by login.html to decide whether
// an unrecognized device needs to be challenged at all.
async function userHasPasskey(uid) {
    try {
        const snap = await db.collection("users").doc(uid).get();
        return !!(snap.exists && snap.data().passkeyHash);
    } catch (err) {
        console.error("userHasPasskey check failed:", err);
        return false;
    }
}
window.userHasPasskey = userHasPasskey;

async function verifyPasskeyForUser(uid, attempt) {
    try {
        const snap = await db.collection("users").doc(uid).get();
        if (!snap.exists || !snap.data().passkeyHash) return false;

        const attemptHash = await hashPasskey(uid, attempt);
        return attemptHash === snap.data().passkeyHash;
    } catch (err) {
        console.error("verifyPasskeyForUser failed:", err);
        return false;
    }
}
window.verifyPasskeyForUser = verifyPasskeyForUser;
