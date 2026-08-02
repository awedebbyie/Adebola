// fairnessPanel.js - "Provably Fair" live indicator + verify modal.
//
// Live indicator: shows the CURRENT round's committed hash while
// betting/flying, and flips to "seed revealed" once it crashes. Fed
// from gameState.js on every poll tick via window.updateFairnessDisplay
// (state) - kept as a separate hook so gameState.js doesn't need to
// know anything about this panel's internals, same pattern as
// window.recordRoundHistory / window.settleLostBets elsewhere.
//
// Verify modal: shows the current round by default (once crashed) and
// lets anyone look up any past round by round number, independently
// recomputing its crash point client-side via js/verifyFairness.js.

(function () {
    function shortHash(hash) {
        if (!hash) return "";
        return hash.slice(0, 10) + "…" + hash.slice(-6);
    }

    window.updateFairnessDisplay = function (state) {
        const el = document.getElementById("fairnessHashPreview");
        if (!el) return;

        if (state.status === "crashed" && state.server_seed) {
            el.textContent = "Seed revealed — tap to verify";
        } else if (state.server_seed_hash) {
            el.textContent = "Hash: " + shortHash(state.server_seed_hash);
        } else {
            el.textContent = "Provably fair";
        }
    };

    function closeFairnessModal() {
        const modal = document.getElementById("fairnessModal");
        if (modal) modal.remove();
    }

    function row(label, value) {
        const wrap = document.createElement("div");
        wrap.className = "fairness-row";
        const l = document.createElement("span");
        l.className = "fairness-row-label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "fairness-row-value";
        v.textContent = value;
        wrap.appendChild(l);
        wrap.appendChild(v);
        return wrap;
    }

    async function renderRoundResult(container, roundData) {
        container.innerHTML = "";

        if (!roundData) {
            container.appendChild(row("Status", "Round not found."));
            return;
        }

        container.appendChild(row("Round #", roundData.round_number));
        container.appendChild(row("Hash (published pre-round)", shortHash(roundData.server_seed_hash)));
        container.appendChild(row("Client seed", roundData.client_seed || "—"));
        container.appendChild(row("Nonce", roundData.nonce));
        container.appendChild(
            row("Crash point (stored)", roundData.crash_point != null ? roundData.crash_point + "x" : "—")
        );

        if (!roundData.server_seed) {
            container.appendChild(row("Server seed", "Not revealed yet (round still in progress)"));
            return;
        }

        container.appendChild(row("Server seed (revealed)", roundData.server_seed));

        const verifying = row("Verifying…", "");
        container.appendChild(verifying);

        try {
            const result = await window.verifyFairness.verifyRound({
                serverSeed: roundData.server_seed,
                serverSeedHash: roundData.server_seed_hash,
                clientSeed: roundData.client_seed,
                nonce: roundData.nonce,
                crashPoint: roundData.crash_point,
            });

            container.removeChild(verifying);

            const passed = result.hashMatches && result.crashMatches;
            const banner = document.createElement("div");
            banner.className = "fairness-result " + (passed ? "fairness-pass" : "fairness-fail");
            banner.textContent = passed
                ? "✅ Verified — this round was not tampered with."
                : "❌ Mismatch — hash or recomputed crash point does not match.";
            container.appendChild(banner);

            container.appendChild(row("Hash check", result.hashMatches ? "match" : "MISMATCH"));
            container.appendChild(row("Recomputed crash point", result.recomputedValue + "x"));
        } catch (err) {
            container.removeChild(verifying);
            container.appendChild(row("Error", "Verification failed to run."));
            console.error("Fairness verification error:", err);
        }
    }

    async function fetchRoundByNumber(roundNumber) {
        if (!window.supabaseClient) return null;
        const { data, error } = await window.supabaseClient
            .from("rounds")
            .select("round_number, server_seed_hash, client_seed, nonce, crash_point, server_seed")
            .eq("round_number", roundNumber)
            .maybeSingle();
        if (error) {
            console.error("Round lookup failed:", error);
            return null;
        }
        return data;
    }

    async function fetchCurrentRound() {
        if (!window.currentGameState || !window.currentGameState.round_id) return null;
        if (!window.supabaseClient) return null;
        const { data, error } = await window.supabaseClient
            .from("rounds")
            .select("round_number, server_seed_hash, client_seed, nonce, crash_point, server_seed")
            .eq("id", window.currentGameState.round_id)
            .maybeSingle();
        if (error) {
            console.error("Current round lookup failed:", error);
            return null;
        }
        return data;
    }

    function openFairnessModal() {
        closeFairnessModal();

        const overlay = document.createElement("div");
        overlay.id = "fairnessModal";
        overlay.className = "round-history-modal-overlay";
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeFairnessModal();
        });

        const panel = document.createElement("div");
        panel.className = "round-history-modal-panel";

        const header = document.createElement("div");
        header.className = "round-history-modal-header";
        header.innerHTML = "<span>Provably Fair</span>";

        const closeBtn = document.createElement("button");
        closeBtn.className = "round-history-modal-close";
        closeBtn.textContent = "✕";
        closeBtn.addEventListener("click", closeFairnessModal);
        header.appendChild(closeBtn);

        const body = document.createElement("div");
        body.className = "round-history-modal-list fairness-modal-body";

        const lookupBar = document.createElement("div");
        lookupBar.className = "fairness-lookup-bar";

        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.placeholder = "Round #";
        input.className = "fairness-lookup-input";

        const lookupBtn = document.createElement("button");
        lookupBtn.className = "fairness-lookup-btn";
        lookupBtn.textContent = "Check round";

        lookupBar.appendChild(input);
        lookupBar.appendChild(lookupBtn);

        const resultArea = document.createElement("div");
        resultArea.className = "fairness-result-area";

        lookupBtn.addEventListener("click", async () => {
            const num = Number(input.value);
            if (!num) return;
            resultArea.innerHTML = "";
            resultArea.appendChild(row("Status", "Looking up round " + num + "…"));
            const data = await fetchRoundByNumber(num);
            await renderRoundResult(resultArea, data);
        });

        panel.appendChild(header);
        body.appendChild(lookupBar);
        body.appendChild(resultArea);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // Default view on open: the current/most recent round.
        (async () => {
            resultArea.appendChild(row("Status", "Loading current round…"));
            const data = await fetchCurrentRound();
            await renderRoundResult(resultArea, data);
        })();
    }

    document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("fairnessVerifyBtn");
        if (btn) {
            btn.addEventListener("click", openFairnessModal);
        }
    });
})();