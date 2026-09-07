// =========================
// WITHDRAWAL WAGERING GATE
// =========================
// New accounts must wager (place bets totalling) at least 75% of their
// FIRST-EVER deposit before withdrawals unlock. Tracked on the user's
// own doc:
//   firstDepositAmount - set once, the very first successful deposit
//   totalWagered       - running total of every bet amount placed
//   withdrawUnlocked   - true forever, the instant totalWagered crosses
//                         75% of firstDepositAmount
//
// Once withdrawUnlocked is true it is NEVER set back to false - a user
// who clears the requirement once never sees the gate page again, even
// after later withdrawals or deposits.
//
// Assumptions flagged here rather than guessed silently elsewhere:
// - The 75% threshold is measured against the FIRST deposit amount,
//   not the user's current (moving) balance.
// - If a user has a balance but firstDepositAmount was never recorded
//   (e.g. their balance came only from a referral reward, never a
//   personal deposit), the gate is treated as not-yet-triggered and
//   withdrawal is allowed - there's no "first deposit" to measure 75%
//   of. Same for accounts that deposited before this feature existed.

const WITHDRAW_WAGER_FRACTION = 0.75;

async function recordFirstDepositIfNeeded(amount) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const userRef = db.collection("users").doc(user.uid);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return;

            const data = snap.data();
            if (data.firstDepositAmount) return; // already recorded

            tx.update(userRef, {
                firstDepositAmount: Number(amount),
                totalWagered: 0,
                withdrawUnlocked: false
            });
        });
    } catch (err) {
        console.error("recordFirstDepositIfNeeded failed:", err);
    }
}
window.recordFirstDepositIfNeeded = recordFirstDepositIfNeeded;

async function recordWagerAmount(amount) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const userRef = db.collection("users").doc(user.uid);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return;

            const data = snap.data();
            if (!data.firstDepositAmount) return; // gate never triggered for this account
            if (data.withdrawUnlocked) return;     // already unlocked - nothing to track anymore

            const newTotal = Number(data.totalWagered || 0) + Number(amount);
            const threshold = Number(data.firstDepositAmount) * WITHDRAW_WAGER_FRACTION;

            const update = { totalWagered: newTotal };
            if (newTotal >= threshold) {
                update.withdrawUnlocked = true;
            }

            tx.update(userRef, update);
        });
    } catch (err) {
        console.error("recordWagerAmount failed:", err);
    }
}
window.recordWagerAmount = recordWagerAmount;

// { locked:false } => never gated, or already cleared - free to withdraw.
// { locked:true, wagered, threshold, firstDeposit } => still gated.
async function getWithdrawGateStatus() {
    const user = auth.currentUser;
    if (!user) return { locked: false };

    const snap = await db.collection("users").doc(user.uid).get();
    if (!snap.exists) return { locked: false };

    const data = snap.data();
    if (!data.firstDepositAmount) return { locked: false };
    if (data.withdrawUnlocked) return { locked: false };

    const wagered = Number(data.totalWagered || 0);
    const threshold = Number(data.firstDepositAmount) * WITHDRAW_WAGER_FRACTION;

    return {
        locked: wagered < threshold,
        wagered,
        threshold,
        firstDeposit: Number(data.firstDepositAmount)
    };
}
window.getWithdrawGateStatus = getWithdrawGateStatus;
