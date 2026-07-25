import { serve } from "https://deno.land/std/http/server.ts";
import admin from "npm:firebase-admin";

// Initialize Firebase Admin once (cold start), reused across warm invocations
const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccountJson!))
  });
}

const db = admin.firestore();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

serve(async (req) => {
  try {
    const body = await req.json();
    const { uid, reference } = body;

    if (!uid || !reference) {
      return jsonResponse(
        { success: false, error: "Missing uid or reference" },
        400
      );
    }

    const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET");

    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    const verifyData = await verifyResponse.json();
    const tx = verifyData.data;

    if (!tx || tx.status !== "success") {
      return jsonResponse({ success: false, error: "Payment not completed" });
    }

    // Confirm the payment belongs to this uid
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

      const currentBalance = userSnapInTx.data()!.balance || 0;
      const newBalance = currentBalance + amount;

      transaction.update(userRef, { balance: newBalance });

      transaction.set(txRef, {
        uid,
        email: tx.customer.email,
        amount,
        status: "success",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { status: "credited", newBalance };
    });

    switch (result.status) {
      case "alreadyProcessed":
        return jsonResponse({
          success: true,
          alreadyProcessed: true,
          message: "This payment was already verified and credited."
        });

      case "userNotFound":
        return jsonResponse({ success: false, error: "User not found" });

      case "credited":
        return jsonResponse({
          success: true,
          alreadyProcessed: false,
          amount,
          balance: result.newBalance
        });
    }
  } catch (error: any) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }
});