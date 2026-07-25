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

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

app.post("/verify-payment", async (req, res) => {
  try {
    const { uid, reference } = req.body;

    if (!uid || !reference) {
      return res.status(400).json({
        success: false,
        error: "Missing uid or reference"
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const tx = response.data.data;

    if (tx.status !== "success") {
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

    const amount = tx.amount / 100;
    const txRef = db.collection("transactions").doc(reference);

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
app.listen(3000, () => {
  console.log("Server running on port 3000");
});