// =========================
// REPORT SUBMISSION QUOTA
// =========================
// report-problem.html submissions are capped per calendar month:
// normal accounts get 1, premium accounts get 3. "Premium" is the same
// check verify-premium-payment/index.ts uses to grant premium in the
// first place - users/{uid}.premiumUntil (an ISO string) is in the
// future.
//
// Tracked on the user's own doc (same document the rest of the app
// already reads/writes owner-only, so no new Firestore rule is needed
// for the tracking itself - only for the reports collection, see the
// updated rules block):
//   reportQuota: { periodKey: "YYYY-MM", count: N }
// periodKey is the calendar month (UTC) the count applies to - the
// very first check/submit in a new month resets count back to 0
// before anything else happens, so nobody has to run a reset job.
//
// The check-and-increment below is one atomic transaction so two
// submissions racing each other (e.g. a double-click) can't both slip
// through when only one slot is left.

const REPORT_LIMIT_NORMAL = 1;
const REPORT_LIMIT_PREMIUM = 3;

function currentPeriodKey() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isPremiumFromUserData(data) {
    if (!data || !data.premiumUntil) return false;
    return new Date(data.premiumUntil).getTime() > Date.now();
}

// First moment (UTC) of next month - used only to tell the user when
// their quota resets, never for the count logic itself.
function startOfNextMonthUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// Read-only - safe to call just to render "x of y left this month"
// without affecting the count.
async function getReportQuotaStatus() {
    const user = auth.currentUser;
    if (!user) return { remaining: 0, limit: REPORT_LIMIT_NORMAL, used: 0, resetsAt: startOfNextMonthUTC().toISOString() };

    try {
        const snap = await db.collection("users").doc(user.uid).get();
        const data = snap.exists ? snap.data() : {};

        const limit = isPremiumFromUserData(data) ? REPORT_LIMIT_PREMIUM : REPORT_LIMIT_NORMAL;
        const quota = data.reportQuota;
        const used = (quota && quota.periodKey === currentPeriodKey()) ? Number(quota.count || 0) : 0;

        return {
            remaining: Math.max(0, limit - used),
            limit,
            used,
            resetsAt: startOfNextMonthUTC().toISOString()
        };
    } catch (err) {
        console.error("getReportQuotaStatus failed:", err);
        return { remaining: 0, limit: REPORT_LIMIT_NORMAL, used: 0, resetsAt: startOfNextMonthUTC().toISOString() };
    }
}
window.getReportQuotaStatus = getReportQuotaStatus;

// Atomically checks the limit and, if there's room, records the use -
// report-problem.html calls this INSTEAD OF a separate "check then
// write" pair, and only writes the actual report doc if allowed:true
// comes back. Returns:
//   { allowed: true,  remaining }                    - go ahead and submit
//   { allowed: false, limit, used, resetsAt }         - out of reports this month
async function recordReportSubmissionIfAllowed() {
    const user = auth.currentUser;
    if (!user) return { allowed: false, limit: REPORT_LIMIT_NORMAL, used: 0, resetsAt: startOfNextMonthUTC().toISOString() };

    const userRef = db.collection("users").doc(user.uid);
    const periodKey = currentPeriodKey();

    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.exists ? snap.data() : {};

            const limit = isPremiumFromUserData(data) ? REPORT_LIMIT_PREMIUM : REPORT_LIMIT_NORMAL;
            const quota = data.reportQuota;
            const sameMonth = quota && quota.periodKey === periodKey;
            const used = sameMonth ? Number(quota.count || 0) : 0;

            if (used >= limit) {
                return { allowed: false, limit, used, resetsAt: startOfNextMonthUTC().toISOString() };
            }

            tx.update(userRef, {
                reportQuota: { periodKey, count: used + 1 }
            });

            return { allowed: true, remaining: limit - (used + 1) };
        });
    } catch (err) {
        console.error("recordReportSubmissionIfAllowed failed:", err);
        return { allowed: false, limit: REPORT_LIMIT_NORMAL, used: 0, resetsAt: startOfNextMonthUTC().toISOString() };
    }
}
window.recordReportSubmissionIfAllowed = recordReportSubmissionIfAllowed;