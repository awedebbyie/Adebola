// roundHistory.js - Small chip strip (below the top bar) showing recent
// crash multipliers, newest -> oldest, LEFT to right.
//
// - Call window.recordRoundHistory(crashPoint) once per finished round.
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

(function () {
    const MAX_ENTRIES = 50;

    let history = []; // index 0 = newest

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
    window.recordRoundHistory = function (crashPoint) {
        const value = Number(crashPoint);
        if (!Number.isFinite(value)) return;

        if (history.length >= MAX_ENTRIES) {
            history = [];
        }

        history.unshift(value);
        render();
    };

    // Re-fit the strip if the window/layout is resized.
    window.addEventListener("resize", render);
})();