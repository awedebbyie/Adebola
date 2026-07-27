// roundHistory.js - Small chip strip (below the top bar) showing recent
// crash multipliers, newest -> oldest, LEFT to right.
//
// - Call window.recordRoundHistory(crashPoint, roundId) once per finished
//   round (roundId is optional but lets us dedupe - see below).
// - New rounds enter on the LEFT. Every existing chip shifts right to
//   make room (array-wise this just means new values are unshifted to
//   the front, then re-rendered in order).
// - Once 50 rounds have been recorded, history clears and starts over
//   from empty.
// - The strip itself never scrolls. Once the chips no longer fit in the
//   available width, the ones that don't fit are hidden and a "..."
//   chip is shown at the end instead. Clicking "..." opens a popup
//   listing every stored round (newest first).
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

    function makeChip(value) {
        const chip = document.createElement("span");
        chip.className = "history-chip";
        chip.style.color = colorForMultiplier(value);
        chip.textContent = value.toFixed(2) + "x";
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

        // Render every stored round first (newest already at the front
        // since history is newest-first), then trim from the end until
        // it fits, leaving room for the "..." chip if anything was cut.
        const chipEls = history.map(makeChip);
        chipEls.forEach((el) => container.appendChild(el));

        if (container.scrollWidth <= container.clientWidth) {
            return; // everything fits, no "..." needed
        }

        const ellipsis = makeEllipsisChip();
        container.appendChild(ellipsis);

        while (
            container.scrollWidth > container.clientWidth &&
            container.lastChild &&
            container.lastChild !== ellipsis
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
        history.forEach((value) => {
            const item = document.createElement("span");
            item.className = "history-chip";
            item.style.color = colorForMultiplier(value);
            item.textContent = value.toFixed(2) + "x";
            list.appendChild(item);
        });

        panel.appendChild(header);
        panel.appendChild(list);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    // Adds a finished round's crash multiplier to the strip, entering at
    // the front (left). Once more than MAX_ENTRIES have been recorded,
    // history clears and starts over from empty.
    //
    // roundId is optional but should be passed whenever the caller has it
    // (gameState.js passes state.round_id). It's used purely to stop the
    // same round being recorded twice - e.g. a page loads while a round is
    // still showing "crashed", the live crash-detection in gameState.js
    // fires for it (since this is a fresh page, it hasn't seen that round
    // crash before), and it's already the newest row the initial
    // DB-backed history load will pick up.
    window.recordRoundHistory = function (crashPoint, roundId) {
        const value = Number(crashPoint);
        if (!Number.isFinite(value)) return;

        if (roundId != null && roundId === lastRecordedRoundId) {
            return; // already recorded this exact round
        }
        if (roundId != null) {
            lastRecordedRoundId = roundId;
        }

        if (history.length >= MAX_ENTRIES) {
            history = [];
        }

        history.unshift(value);
        render();
    };

    // Seeds `history` from the "rounds" table so a fresh page load (or a
    // user joining partway through a session) sees the real recent rounds
    // instead of an empty strip. Excludes whatever round is currently
    // "live" in current_round - that round gets added the normal way via
    // recordRoundHistory the moment it actually crashes, so excluding it
    // here avoids ever double-counting it.
    async function loadInitialHistory() {
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
                .select("id, crash_point")
                .not("crash_point", "is", null)
                .not("crashed_at", "is", null)
                .order("round_number", { ascending: false })
                .limit(MAX_ENTRIES);

            if (roundsError || !rounds) return;

            history = rounds
                .filter((row) => row.id !== currentRoundId)
                .map((row) => Number(row.crash_point))
                .filter((value) => Number.isFinite(value))
                .slice(0, MAX_ENTRIES);

            render();
        } catch (err) {
            console.error("Round history load failed:", err);
        }
    }

    // Re-fit the strip if the window/layout is resized.
    window.addEventListener("resize", render);

    loadInitialHistory();
})();