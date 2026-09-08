import { serve } from "https://deno.land/std/http/server.ts";
import admin from "npm:firebase-admin";

// Same pattern as verify-payment/index.ts, deliberately kept as its own
// separate function rather than branching the existing one - a deposit
// and a premium purchase are different things with different failure
// modes, and this way neither can accidentally break the other.

const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccountJson!))
  });
}

const db = admin.firestore();

// Prices live ONLY here - change them here and nowhere else. The
// server independently knows the correct price per plan and verifies
// the actual paid amount matches, rather than trusting whatever plan
// name the client sends - so someone can't pay ₦100 and claim the
// quarterly plan.
const PLANS: Record<string, { amount: number; days: number; label: string }> = {
  monthly:   { amount: 15000, days: 30, label: "Monthly" },
  quarterly: { amount: 40050, days: 90, label: "3 Months" }
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

serve(async (req) => {
  try {
    const body = await req.json();
    const { uid, transaction_id, tx_ref, plan } = body;

    if (!uid || !transaction_id || !tx_ref || !plan) {
      return jsonResponse(
        { success: false, error: "Missing uid, transaction_id, tx_ref, or plan" },
        400
      );
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return jsonResponse({ success: false, error: "Unknown plan" }, 400);
    }

    const FLW_SECRET_KEY = Deno.env.get("FLW_SECRET_KEY");

    const verifyResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` }
      }
    );

    const verifyData = await verifyResponse.json();
    const tx = verifyData.data;

    if (!tx || tx.status !== "successful" || tx.tx_ref !== tx_ref) {
      return jsonResponse({ success: false, error: "Payment not completed" });
    }

    // The actual amount paid must match this plan's real price - not
    // just "greater than zero". Small tolerance for currency rounding.
    if (Math.abs(tx.amount - planConfig.amount) > 1) {
      return jsonResponse({ success: false, error: "Paid amount does not match plan price" });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return jsonResponse({ success: false, error: "User not found" });
    }

    if (tx.customer.email !== userSnap.data()!.email) {
      return jsonResponse({
        success: false,
        error: "Payment email does not match account"
      });
    }

    const txRef = db.collection("premium_transactions").doc(tx_ref);

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

      const now = Date.now();
      const currentPremiumUntil = userSnapInTx.data()!.premiumUntil
        ? new Date(userSnapInTx.data()!.premiumUntil).getTime()
        : 0;

      // Extends from whichever is later - "now", or their existing
      // expiry if they still have active time left. Renewing early
      // never wastes remaining days.
      const startFrom = Math.max(now, currentPremiumUntil);
      const newPremiumUntil = new Date(startFrom + planConfig.days * 24 * 60 * 60 * 1000).toISOString();

      transaction.update(userRef, { premiumUntil: newPremiumUntil });

      transaction.set(txRef, {
        uid,
        email: tx.customer.email,
        plan,
        amount: tx.amount,
        newPremiumUntil,
        status: "success",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { status: "credited", newPremiumUntil };
    });

    switch (result.status) {
      case "alreadyProcessed":
        return jsonResponse({
          success: true,
          alreadyProcessed: true,
          message: "This payment was already verified."
        });

      case "userNotFound":
        return jsonResponse({ success: false, error: "User not found" });

      case "credited":
        return jsonResponse({
          success: true,
          alreadyProcessed: false,
          premiumUntil: result.newPremiumUntil
        });
    }
  } catch (error: any) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }
});