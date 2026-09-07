// =========================
// REFERRAL PROGRAM
// =========================
// A user's referral link is just their own uid: register.html?ref=<uid>.
// register.html reads that param at signup and stores it on the NEW
// user's own doc as `referredBy: <uid>`, plus a fresh progress object:
//   referralProgress: { deposited:false, roundsPlayed:0, shared:false, rewardGiven:false }
//
// As the referred user hits each milestone, the relevant page calls one
// of the two functions below (both exposed on window so any page can use
// them once this file - and Firebase - are loaded):
//   window.markReferralProgress("deposited" | "shared")
//   window.incrementReferralRounds()
//
// Once deposited + roundsPlayed >= 5 + shared are ALL true (and the
// reward hasn't already been paid), the REFERRER's balance is credited
// REFERRAL_REWARD_AMOUNT, exactly once - guarded by rewardGiven and by
// running the whole check+pay as a single Firestore transaction, so two
// milestone updates landing at the same moment can't double-pay it.
//
// NOTE: REFERRAL_REWARD_AMOUNT below is a placeholder (₦4,000, guessed
// from "4N" in the spec) - change this one constant if the real amount
// is different.

const REFERRAL_REWARD_AMOUNT = 4000;
const REFERRAL_ROUNDS_REQUIRED = 5;

function referralLinkForUser(uid) {
    return `${window.location.origin}/register.html?ref=${uid}`;
}
window.referralLinkForUser = referralLinkForUser;

async function checkAndPayReferralReward(uid) {
    if (!uid) return;

    try {
        await db.runTransaction(async (tx) => {
            const userRef = db.collection("users").doc(uid);
            const userSnap = await tx.get(userRef);
            if (!userSnap.exists) return;

            const data = userSnap.data();
            const progress = data.referralProgress || {};
            const referredBy = data.referredBy;

            if (!referredBy) return;
            if (progress.rewardGiven) return;
            if (!progress.deposited) return;
            if (!progress.shared) return;
            if (Number(progress.roundsPlayed || 0) < REFERRAL_ROUNDS_REQUIRED) return;

            const referrerRef = db.collection("users").doc(referredBy);
            const referrerSnap = await tx.get(referrerRef);
            if (!referrerSnap.exists) return;

            tx.update(referrerRef, {
                balance: firebase.firestore.FieldValue.increment(REFERRAL_REWARD_AMOUNT)
            });

            tx.update(userRef, {
                "referralProgress.rewardGiven": true
            });

            tx.set(db.collection("referralRewards").doc(), {
                referrerUid: referredBy,
                referredUid: uid,
                amount: REFERRAL_REWARD_AMOUNT,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
    } catch (err) {
        console.error("Referral reward check failed:", err);
    }
}

window.markReferralProgress = async function (field) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        await db.collection("users").doc(user.uid).update({
            [`referralProgress.${field}`]: true
        });
        await checkAndPayReferralReward(user.uid);
    } catch (err) {
        console.error("markReferralProgress failed:", err);
    }
};

window.incrementReferralRounds = async function () {
    const user = auth.currentUser;
    if (!user) return;

    try {
        await db.collection("users").doc(user.uid).update({
            "referralProgress.roundsPlayed": firebase.firestore.FieldValue.increment(1)
        });
        await checkAndPayReferralReward(user.uid);
    } catch (err) {
        console.error("incrementReferralRounds failed:", err);
    }
};
