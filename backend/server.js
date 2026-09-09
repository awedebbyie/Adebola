const admin = require("firebase-admin");
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const serviceAccount = require("./firebase-service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();

app.use(cors());
app.use(express.json());

// Hidden admin login (email code -> passcode). Fully isolated in its
// own file - see backend/adminAuth.js.
const adminAuth = require("./adminAuth");
app.use("/admin/auth", adminAuth.router);

// Admin stats (profit numbers, later charts). Every route in here is
// guarded by adminAuth.requireAdmin - see backend/adminStats.js.
const adminStats = require("./adminStats");
app.use("/admin/api", adminStats);

// Balance reconciliation / anomaly detection - flags unexplained balance
// increases. Every route guarded the same way - see backend/adminSecurity.js.
const adminSecurity = require("./adminSecurity");
app.use("/admin/api", adminSecurity);

// User overview, retention, inactivity buckets, bet participation, live
// round, recent activity, growth trends, takeover watch. Every route
// guarded the same way - see backend/adminUsers.js.
const adminUsers = require("./adminUsers");
app.use("/admin/api", adminUsers);

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;

app.post("/verify-payment", async (req, res) => {
  try {
    const { uid, transaction_id, tx_ref } = req.body;

    if (!uid || !transaction_id || !tx_ref) {
      return res.status(400).json({
        success: false,
        error: "Missing uid, transaction_id or tx_ref"
      });
    }

    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`
        }
      }
    );

    const tx = response.data.data;

    if (tx.status !== "successful" || tx.tx_ref !== tx_ref) {
      return res.json({ success: false, error: "Payment not successful" });
    }

    // Confirm the payment actually belongs to this uid before touching balances
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.json({
        success: false,
        error: "User not found"
      });
    }

    if (tx.customer.email !== userSnap.data().email) {
      return res.json({
        success: false,
        error: "Payment email does not match account"
      });
    }

    const amount = tx.amount;
    const txRef = db.collection("transactions").doc(tx_ref);

    const result = await db.runTransaction(async (transaction) => {
      const [txSnap, userSnapInTx] = await Promise.all([
        transaction.get(txRef),
        transaction.get(userRef)
      ]);

      if (txSnap.exists) {
        return { status: "alreadyProcessed" };
      }

      if (!userSnapInTx.exists) {
        return { status: "userNotFound" };
      }

      const currentBalance = userSnapInTx.data().balance || 0;

      transaction.update(userRef, {
        balance: currentBalance + amount
      });

      transaction.set(txRef, {
        uid,
        amount,
        status: "success",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { status: "credited" };
    });

    switch (result.status) {
      case "alreadyProcessed":
        return res.json({
          success: true,
          alreadyProcessed: true,
          message: "This payment was already verified and credited."
        });

      case "userNotFound":
        return res.json({
          success: false,
          error: "User not found"
        });

      case "credited":
        return res.json({
          success: true,
          alreadyProcessed: false,
          amount
        });
    }

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Verification failed" });
  }
});
// ================= WITHDRAW =================
// The 75%-of-first-deposit wagering gate (js/withdrawGate.js) was only
// ever checked client-side in withdraw.html - a page redirect, not an
// actual block. Anyone calling this endpoint directly (or with the
// client-side check patched/skipped) could withdraw before meeting it.
// This mirrors the same fields/threshold read there (firstDepositAmount,
// totalWagered, withdrawUnlocked), but as the actual, unbypassable gate.
const WITHDRAW_WAGER_FRACTION = 0.75;

app.post("/withdraw", async (req, res) => {

  try {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const idToken = authHeader.split("Bearer ")[1];

    const decodedToken =
      await admin.auth().verifyIdToken(idToken);

    const uid = decodedToken.uid;

    const { amount } = req.body;

    if (!amount || amount < 1000) {
      return res.json({
        success: false,
        error: "Minimum withdrawal is ₦1000"
      });
    }

    const userRef =
      db.collection("users").doc(uid);

    const withdrawalRef =
      db.collection("withdrawals").doc();

    const result =
      await db.runTransaction(async (transaction) => {

        const userSnap =
          await transaction.get(userRef);

        if (!userSnap.exists) {
          return {
            status: "userNotFound"
          };
        }

        const userData = userSnap.data();

        // Same logic as js/withdrawGate.js's getWithdrawGateStatus():
        // no first deposit on record -> gate never triggered, allow.
        // withdrawUnlocked once true -> allow forever. Otherwise, block
        // until 75% of that first deposit has been wagered.
        if (userData.firstDepositAmount && !userData.withdrawUnlocked) {
          const wagered = Number(userData.totalWagered || 0);
          const threshold = Number(userData.firstDepositAmount) * WITHDRAW_WAGER_FRACTION;

          if (wagered < threshold) {
            return {
              status: "wagerRequirementNotMet",
              wagered,
              threshold
            };
          }
        }

        const currentBalance =
          Number(userSnap.data().balance || 0);

        if (currentBalance < amount) {
          return {
            status: "insufficientFunds"
          };
        }

        const newBalance =
          currentBalance - amount;

        transaction.update(userRef, {
          balance: newBalance
        });

        transaction.set(withdrawalRef, {
          uid,
          amount,
          status: "pending",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

        return {
          status: "success",
          balance: newBalance
        };

      });

    switch (result.status) {

      case "userNotFound":
        return res.json({
          success: false,
          error: "User not found"
        });

      case "wagerRequirementNotMet":
        return res.json({
          success: false,
          error: "You need to wager more before you can withdraw",
          wagerRequirement: {
            wagered: result.wagered,
            threshold: result.threshold
          }
        });

      case "insufficientFunds":
        return res.json({
          success: false,
          error: "Insufficient balance"
        });

      case "success":
        return res.json({
          success: true,
          balance: result.balance,
          message: "Withdrawal request submitted"
        });

    }

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: "Withdrawal failed"
    });

  }

});
// ================= CHECK EMAIL =================
// Used by login.html (and could be reused by register.html) to reliably
// tell whether an email already has an account, and if so which sign-in
// provider(s) it has. This has to be a backend call using the Admin SDK -
// the client-side fetchSignInMethodsForEmail() is unreliable for this on
// most current Firebase projects: with Email Enumeration Protection
// enabled (the default for newer projects), it always returns an empty
// array regardless of whether the email is registered, specifically so a
// client can't fingerprint which emails exist. The Admin SDK isn't
// subject to that restriction.
//
// NOTE: this endpoint intentionally answers "does this email exist" for
// an unauthenticated caller, which is inherently a (mild) email
// enumeration surface - that's a deliberate tradeoff to support "tell the
// user to sign in with Google" / "offer to create an account" instead of
// a generic failure. It only ever returns exists + provider IDs, nothing
// else about the account.
app.post("/auth/check-email", async (req, res) => {

  try {

    const email = String(req.body.email || "").trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    try {

      const userRecord = await admin.auth().getUserByEmail(email);

      return res.json({
        exists: true,
        providers: userRecord.providerData.map((p) => p.providerId)
      });

    } catch (err) {

      if (err.code === "auth/user-not-found") {
        return res.json({ exists: false, providers: [] });
      }

      throw err;
    }

  } catch (error) {

    console.error("check-email error:", error);

    res.status(500).json({ error: "Something went wrong" });

  }

});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});