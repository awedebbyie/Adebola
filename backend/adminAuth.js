// adminAuth.js - Hidden admin login: 2-factor gate (email code ->
// passcode) before granting access to the admin panel.
//
// Mounted in server.js as one new, isolated router
// (app.use("/admin/auth", adminAuth.router)) - nothing here touches any
// existing route, table, or logic. Session state lives in its own
// Firestore collections ("admin_sessions" for logins-in-progress,
// "admin_tokens" for completed logins), separate from "users"/"bets"/
// anything else already in your DB.
//
// Required environment variables - add these to your .env:
//   ADMIN_EMAIL          - the only email allowed to start a login
//   ADMIN_PASSCODE_HASH  - bcrypt hash of your passcode (never the plain passcode - see README note at the bottom)
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  - for sending the email code (any SMTP provider)

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin"); // already initialized in server.js

const router = express.Router();
const db = admin.firestore();

const SESSION_TTL_MS = 10 * 60 * 1000;          // 10 minutes to complete both steps
const CODE_TTL_MS = 5 * 60 * 1000;              // the code is valid for 5 minutes
const MAX_ATTEMPTS_PER_STEP = 5;                // wrong-code attempts before the session is killed
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // completed admin session: 12 hours

const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function generateCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0"); // 6-digit numeric
}

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

async function sendEmailCode(code) {
    await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.ADMIN_EMAIL,
        subject: "Admin login code",
        text: `Your admin login code is ${code}. It expires in 5 minutes. If you didn't request this, ignore it.`
    });
}

// Same response shape regardless of whether the submitted email was
// actually correct - so probing this endpoint can't be used to
// discover the real admin email.
function genericStart(res) {
    return res.json({ ok: true, message: "If this is a valid admin login, a code has been sent." });
}

// ---- Step 0: start a login attempt -------------------------------------
router.post("/start", async (req, res) => {
    try {
        const { email } = req.body || {};

        // TEMPORARY DEBUG LOGGING - remove once this is confirmed working.
        console.log("admin/auth/start received email:", JSON.stringify(email));
        console.log("admin/auth/start expected ADMIN_EMAIL:", JSON.stringify(process.env.ADMIN_EMAIL));

        if (!email || email.toLowerCase() !== String(process.env.ADMIN_EMAIL || "").toLowerCase()) {
            console.log("admin/auth/start: email did NOT match - sending nothing.");
            return genericStart(res);
        }

        console.log("admin/auth/start: email matched - sending code now...");

        const sessionToken = generateToken();
        const emailCode = generateCode();
        const now = Date.now();

        await db.collection("admin_sessions").doc(sessionToken).set({
            step: "email",
            emailCode,
            emailCodeExpires: now + CODE_TTL_MS,
            emailAttempts: 0,
            passcodeAttempts: 0,
            createdAt: now,
            expiresAt: now + SESSION_TTL_MS
        });

        await sendEmailCode(emailCode);
        console.log("admin/auth/start: sendEmailCode() completed without throwing.");

        return res.json({ ok: true, sessionToken, message: "Code sent to email." });
    } catch (err) {
        console.error("admin/auth/start error:", err.message, err);
        return genericStart(res);
    }
});

// Shared helper: load + validate a session sitting at a given expected step.
async function loadSession(sessionToken, expectedStep) {
    if (!sessionToken) return { error: "Missing session." };

    const ref = db.collection("admin_sessions").doc(sessionToken);
    const snap = await ref.get();

    if (!snap.exists) return { error: "Session not found. Start again." };

    const session = snap.data();

    if (Date.now() > session.expiresAt) {
        await ref.delete();
        return { error: "Session expired. Start again." };
    }

    if (session.step !== expectedStep) {
        return { error: "Wrong step. Start again." };
    }

    return { ref, session };
}

// ---- Step 1: verify the emailed code, then move to the passcode step --
router.post("/verify-email", async (req, res) => {
    try {
        const { sessionToken, code } = req.body || {};
        const { ref, session, error } = await loadSession(sessionToken, "email");
        if (error) return res.status(400).json({ ok: false, error });

        if (session.emailAttempts >= MAX_ATTEMPTS_PER_STEP) {
            await ref.delete();
            return res.status(400).json({ ok: false, error: "Too many attempts. Start again." });
        }

        if (Date.now() > session.emailCodeExpires || code !== session.emailCode) {
            await ref.update({ emailAttempts: session.emailAttempts + 1 });
            return res.status(400).json({ ok: false, error: "Incorrect or expired code." });
        }

        await ref.update({ step: "passcode" });

        return res.json({ ok: true, message: "Enter your passcode." });
    } catch (err) {
        console.error("admin/auth/verify-email error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});
router.post("/verify-passcode", async (req, res) => {
    try {
        const { sessionToken, passcode } = req.body || {};
        const { ref, session, error } = await loadSession(sessionToken, "passcode");
        if (error) return res.status(400).json({ ok: false, error });

        if (session.passcodeAttempts >= MAX_ATTEMPTS_PER_STEP) {
            await ref.delete();
            return res.status(400).json({ ok: false, error: "Too many attempts. Start again." });
        }

        const matches = passcode && (await bcrypt.compare(passcode, process.env.ADMIN_PASSCODE_HASH || ""));

        if (!matches) {
            await ref.update({ passcodeAttempts: session.passcodeAttempts + 1 });
            return res.status(400).json({ ok: false, error: "Incorrect passcode." });
        }

        // Both factors passed - issue the real admin session token and
        // destroy the login-flow session, its job is done.
        const adminToken = generateToken();
        const now = Date.now();

        await db.collection("admin_tokens").doc(adminToken).set({
            createdAt: now,
            expiresAt: now + ADMIN_TOKEN_TTL_MS
        });

        await ref.delete();

        return res.json({ ok: true, adminToken });
    } catch (err) {
        console.error("admin/auth/verify-passcode error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
});

// ---- Session check - the admin panel page calls this before rendering -
router.get("/session", async (req, res) => {
    try {
        const adminToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

        // TEMPORARY DEBUG LOGGING - remove once this is confirmed working.
        console.log("admin/auth/session called. Authorization header:", JSON.stringify(req.headers.authorization));
        console.log("admin/auth/session extracted token:", JSON.stringify(adminToken));

        if (!adminToken) {
            console.log("admin/auth/session: no token provided - returning invalid.");
            return res.status(401).json({ ok: false, valid: false });
        }

        const snap = await db.collection("admin_tokens").doc(adminToken).get();
        console.log("admin/auth/session: doc exists?", snap.exists);
        if (snap.exists) {
            console.log("admin/auth/session: expiresAt:", snap.data().expiresAt, "now:", Date.now());
        }

        if (!snap.exists || Date.now() > snap.data().expiresAt) {
            console.log("admin/auth/session: returning valid=false.");
            return res.json({ ok: true, valid: false });
        }

        console.log("admin/auth/session: returning valid=true.");
        return res.json({ ok: true, valid: true });
    } catch (err) {
        console.error("admin/auth/session error:", err.message, err);
        return res.status(500).json({ ok: false, valid: false });
    }
});

router.post("/logout", async (req, res) => {
    try {
        const adminToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (adminToken) {
            await db.collection("admin_tokens").doc(adminToken).delete();
        }
        return res.json({ ok: true });
    } catch (err) {
        return res.json({ ok: true }); // logout should never "fail" from the client's perspective
    }
});

// Reusable guard for any FUTURE admin API routes you add (e.g. an
// endpoint to adjust a user's balance, ban a user, etc). Use it like:
//   const adminAuth = require("./adminAuth");
//   app.post("/admin/api/whatever", adminAuth.requireAdmin, (req, res) => { ... });
async function requireAdmin(req, res, next) {
    try {
        const adminToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (!adminToken) return res.status(401).json({ ok: false, error: "Not authenticated." });

        const snap = await db.collection("admin_tokens").doc(adminToken).get();
        if (!snap.exists || Date.now() > snap.data().expiresAt) {
            return res.status(401).json({ ok: false, error: "Session expired." });
        }

        next();
    } catch (err) {
        console.error("requireAdmin error:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong." });
    }
}

module.exports = { router, requireAdmin };

// ---- How to generate ADMIN_PASSCODE_HASH -------------------------------
// Never put your plain passcode in .env. Generate its bcrypt hash once,
// on your own machine, and put ONLY the hash in .env:
//
//   node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "yourPasscodeHere"
//
// Copy the printed hash into ADMIN_PASSCODE_HASH.