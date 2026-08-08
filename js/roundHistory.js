// roundHistory.js - Small chip strip (below the top bar) showing recent
// crash multipliers, newest -> oldest, LEFT to right.
//
// - Call window.recordRoundHistory(crashPoint, roundId) once per finished
//   round (roundId is optional but lets us dedupe - see below).
// - New rounds enter on the LEFT. Every existing chip shifts right to
//   make room (array-wise this just means new values are unshifted to
//   the front, then re-rendered in order).
// - At most 50 rounds are kept. When a new one is added past that limit,
//   the oldest entry (rightmost) is dropped so the new value has room
//   on the left — a sliding window, never a full clear.
// - The strip itself never scrolls. A "..." chip is always shown at the
//   end of the strip (when there is any history). Chips that don't fit
//   are hidden; clicking "..." opens a popup listing every stored round
//   (up to 50, newest first).
//
// gameState.js already detects "a round just crashed" (guarded by
// round_id so it only fires once) - that's where recordRoundHistory
// gets called from.
//
// PERSISTENCE: history used to live only in this in-memory array, so a
// refresh (or a user joining mid-session) saw an empty strip even though
// the game had been running for a while. On load we now pull the most
// recent finished rounds straight from the "rounds" table in Supabase
// (every round's crash_point is already stored there by the engine) and
// seed `history` with them before the first render, so a new/returning
// visitor sees the real recent rounds immediately instead of a blank
// strip that looks like the game just started.

(function () {
    const MAX_ENTRIES = 50;

    let history = []; // index 0 = newest
    let lastRecordedRoundId = null; // guards against double-adding a round

    function colorForMultiplier(value) {
        if (value < 2) return "#4da6ff";   // blue
        if (value < 10) return "#b366ff";  // purple
        return "#ff4dd8";                  // pink/magenta
    }

    // entry = { value, roundNumber }. Chips are clickable whenever
    // roundNumber is known - opens the Provably Fair panel (js/fairnessPanel.js)
    // pre-loaded to that exact round, so anyone (including someone who
    // joined late and missed it happen live) can confirm it wasn't
    // tampered with.
    function makeChip(entry) {
        const chip = document.createElement("span");
        chip.className = "history-chip";
        chip.style.color = colorForMultiplier(entry.value);
        chip.textContent = entry.value.toFixed(2) + "x";

        if (entry.roundNumber != null) {
            chip.classList.add("history-chip-clickable");
            chip.title = "Tap to verify round " + entry.roundNumber;
            chip.addEventListener("click", () => {
                if (typeof window.openFairnessModalForRound === "function") {
                    window.openFairnessModalForRound(entry.roundNumber);
                }
            });
        }

        return chip;
    }

    function makeEllipsisChip() {
        const chip = document.createElement("span");
        chip.className = "history-chip history-chip-more";
        chip.textContent = "...";
        chip.addEventListener("click", openHistoryModal);
        return chip;
    }

    function render() {
        const container = document.getElementById("roundHistory");
        if (!container) return;

        container.innerHTML = "";

        if (history.length === 0) return;

        // Always show "..." at the end so the user can open the full
        // list (up to MAX_ENTRIES) even when every chip already fits.
        const ellipsis = makeEllipsisChip();

        // Render newest-first chips, then the ellipsis, then trim from
        // the oldest end until the strip fits (ellipsis stays fixed).
        const chipEls = history.map(makeChip);
        chipEls.forEach((el) => container.appendChild(el));
        container.appendChild(ellipsis);

        while (
            container.scrollWidth > container.clientWidth &&
            container.childNodes.length > 1 &&
            container.lastChild === ellipsis
        ) {
            // Remove the chip just before the ellipsis (the oldest
            // visible one), not the ellipsis itself.
            container.removeChild(container.childNodes[container.childNodes.length - 2]);
        }
    }

    function closeHistoryModal() {
        const modal = document.getElementById("roundHistoryModal");
        if (modal) modal.remove();
    }

    function openHistoryModal() {
        closeHistoryModal();

        if (typeof window.recordMissionEvent === "function") {
            window.recordMissionEvent("opened_round_history");
        }

        const overlay = document.createElement("div");
        overlay.id = "roundHistoryModal";
        overlay.className = "round-history-modal-overlay";
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeHistoryModal();
        });

        const panel = document.createElement("div");
        panel.className = "round-history-modal-panel";

        const header = document.createElement("div");
        header.className = "round-history-modal-header";
        header.innerHTML = "<span>Round History</span>";

        const closeBtn = document.createElement("button");
        closeBtn.className = "round-history-modal-close";
        closeBtn.textContent = "✕";
        closeBtn.addEventListener("click", closeHistoryModal);
        header.appendChild(closeBtn);

        const list = document.createElement("div");
        list.className = "round-history-modal-list";
        history.forEach((entry) => {
            list.appendChild(makeChip(entry));
        });

        panel.appendChild(header);
        panel.appendChild(list);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    // Adds a finished round's crash multiplier to the strip, entering at
    // the front (left). If the list is already at MAX_ENTRIES (50), the
    // oldest entry is dropped first so the new value has room — the strip
    // stays a sliding window of the most recent rounds.
    //
    // roundId is optional but should be passed whenever the caller has it
    // (gameState.js passes state.round_id). It's used purely to stop the
    // same round being recorded twice - e.g. a page loads while a round is
    // still showing "crashed", the live crash-detection in gameState.js
    // fires for it (since this is a fresh page, it hasn't seen that round
    // crash before), and it's already the newest row the initial
    // DB-backed history load will pick up.
    //
    // roundNumber is also optional, and is what makes the chip clickable
    // for verification (js/fairnessPanel.js looks rounds up by number).
    window.recordRoundHistory = function (crashPoint, roundId, roundNumber) {
        const value = Number(crashPoint);
        if (!Number.isFinite(value)) return;

        if (roundId != null && roundId === lastRecordedRoundId) {
            return; // already recorded this exact round
        }
        if (roundId != null) {
            lastRecordedRoundId = roundId;
        }

        // Sliding window: at 50, drop the oldest (rightmost) so the new
        // crash can enter on the left without wiping the whole strip.
        if (history.length >= MAX_ENTRIES) {
            history.pop();
        }

        history.unshift({
            value,
            roundNumber: roundNumber != null ? roundNumber : null,
            id: roundId != null ? roundId : null
        });
        render();
    };

    // Pulls the latest finished rounds straight from the "rounds" table
    // and reconciles `history` to match - both for the very first page
    // load (when the strip starts empty) AND any time after, to backfill
    // rounds that crashed while this tab was backgrounded and the poll
    // never got a chance to observe that particular round's "crashed"
    // moment (see gameState.js's visibilitychange handler, which calls
    // this the instant the tab comes back into focus).
    //
    // Reconciled by round id, not just concatenated - safe to call this
    // repeatedly without ever producing duplicate chips, unlike the old
    // one-shot version this replaced.
    async function syncHistoryFromServer() {
        if (!window.supabaseClient) return;

        try {
            let currentRoundId = null;

            const { data: current, error: currentError } = await window.supabaseClient
                .from("current_round")
                .select("round_id")
                .eq("id", 1)
                .single();

            if (!currentError && current) {
                currentRoundId = current.round_id;
            }

            const { data: rounds, error: roundsError } = await window.supabaseClient
                .from("rounds")
                .select("id, round_number, crash_point")
                .not("crash_point", "is", null)
                .not("crashed_at", "is", null)
                .order("round_number", { ascending: false })
                .limit(MAX_ENTRIES);

            if (roundsError || !rounds) {
                console.error("Round history sync failed - rounds query returned:", roundsError);
                return;
            }

            const finished = rounds
                .filter((row) => row.id !== currentRoundId)
                .map((row) => ({
                    id: row.id,
                    value: Number(row.crash_point),
                    roundNumber: row.round_number
                }))
                .filter((row) => Number.isFinite(row.value));

            // The DB is authoritative here - merge by round id (keyed in a
            // Map) rather than blindly concatenating, so any round already
            // in `history` (recorded live, or from a previous sync) never
            // ends up duplicated just because this fetch sees it again.
            const byId = new Map();
            history.forEach((entry) => {
                if (entry.id != null) byId.set(entry.id, entry);
            });
            finished.forEach((entry) => byId.set(entry.id, entry));

            history = Array.from(byId.values())
                .sort((a, b) => (b.roundNumber || 0) - (a.roundNumber || 0))
                .slice(0, MAX_ENTRIES);

            if (history.length > 0 && history[0].id != null) {
                lastRecordedRoundId = history[0].id;
            }

            render();
        } catch (err) {
            console.error("Round history sync failed:", err);
        }
    }

    window.refreshRoundHistoryFromServer = syncHistoryFromServer;

    // Re-fit the strip if the window/layout is resized.
    window.addEventListener("resize", render);

    syncHistoryFromServer();
})();