// adminReports.js - lets the admin panel read what users submit via
// report-problem.html (Firestore "reports" collection) and mark them
// read. Mounted in server.js alongside adminStats.js/adminSecurity.js/
// adminUsers.js, same guard pattern (router.use(adminAuth.requireAdmin)
// below) - and the same reason the client-side Firestore rules for this
// collection deny read entirely to normal users: this router, using the
// Admin SDK, is the ONLY way any of these docs are ever read back.
//
// Each report doc (written by report-problem.html) looks like:
//   uid, email, category, description, status ("open"), read (bool),
//   createdAt (Firestore Timestamp)
// "read" is a separate flag from "status" on purpose - status is left
// alone here for whatever workflow you build around it later (e.g.
// "resolved"), read/unread is purely about whether someone on this end
// has looked at it yet.

const express = require("express");
const admin = require("firebase-admin");
const adminAuth = require("./adminAuth");

const router = express.Router();
const db = admin.firestore();

router.use(adminAuth.requireAdmin);

const MAX_REPORTS_RETURNED = 200;

router.get("/reports", async (req, res) => {
    try {
        const snap = await db.collection("reports")
            .orderBy("createdAt", "desc")
            .limit(MAX_REPORTS_RETURNED)
            .get();

        const reports = snap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                uid: data.uid || null,
                email: data.email || null,
                category: data.category || "other",
                description: data.description || "",
                status: data.status || "open",
                read: !!data.read,
                createdAt: data.createdAt && data.createdAt.toDate
                    ? data.createdAt.toDate().toISOString()
                    : null
            };
        });

        res.json({ ok: true, reports });
    } catch (err) {
        console.error("GET /admin/api/reports failed:", err);
        res.status(500).json({ ok: false, error: "Failed to load reports" });
    }
});

// Marks every currently-unread report as read in one go - this is
// "clear the inbox", not "mark THIS one read" (there's no per-report
// route because the panel doesn't need one yet; add one the same way
// if that changes).
router.post("/reports/mark-all-read", async (req, res) => {
    try {
        const snap = await db.collection("reports")
            .where("read", "==", false)
            .get();

        if (snap.empty) {
            return res.json({ ok: true, updated: 0 });
        }

        // Firestore batches cap at 500 writes - chunk just in case a
        // backlog ever exceeds that, rather than assuming it never will.
        const docs = snap.docs;
        let updated = 0;

        for (let i = 0; i < docs.length; i += 500) {
            const batch = db.batch();
            docs.slice(i, i + 500).forEach((doc) => {
                batch.update(doc.ref, { read: true });
                updated++;
            });
            await batch.commit();
        }

        res.json({ ok: true, updated });
    } catch (err) {
        console.error("POST /admin/api/reports/mark-all-read failed:", err);
        res.status(500).json({ ok: false, error: "Failed to mark reports read" });
    }
});

module.exports = router;