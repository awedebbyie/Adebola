document.addEventListener("DOMContentLoaded", () => {
    const helicopter = document.getElementById("helicopter");
    const multiplierEl = document.querySelector(".multiplier");
    const flightPath = document.getElementById("flightPath");
    const fillArea = document.getElementById("fillArea");

    let x = 125;
    let y = 310;
    let multiplierValue = 1;
    let phase = 1;
    let lastTime = 0;
    let isRunning = false;
    let previousStatus = null;

    // The "hover" trajectory the cruise phase eases toward - keeps easing
    // closer to the real top-right corner of the container (see
    // EDGE_TOUCH_X/Y below) the longer the round runs, instead of
    // settling at a fixed spot. x/y each frame are this baseline plus a
    // one-sided diagonal swing (see phase 2 in animate()).
    let baseX = x;
    let baseY = y;

    // Set whenever the cruise (phase 2) swing starts, so the sine wave
    // below always begins at swing = 0 - exactly matching baseX/baseY,
    // the point the climb (or late-join) just left off at - instead of
    // wherever the raw page-load-relative timestamp happens to put it.
    // See where phase flips to 2, both in animate() and resetGame().
    let swingPhaseOffset = 0;

    const MAX_X = 280; // right limit (ground level) - used for the climb-out/late-join math further down, untouched.

    // ✅ FIX: vertical boundaries
    const MIN_Y = 140; // top limit - also only used for the climb-out/late-join math further down.
    const MAX_Y = 320; // bottom limit (ground level)

    // ================= REAL CONTAINER + SPRITE GEOMETRY =================
    const GRAPH_WIDTH = 400;
    const GRAPH_HEIGHT = 320;

    const HELI_WIDTH = 150;
    const HELI_NATURAL_W = 198;
    const HELI_NATURAL_H = 86;
    const HELI_HEIGHT = HELI_WIDTH * (HELI_NATURAL_H / HELI_NATURAL_W);

    // The nose sits at this fraction of the sprite's width, measured from
    // its left edge (55/70 was true for the original 70px-wide sprite).
    // Deriving ANCHOR_OFFSET_X from HELI_WIDTH means resizing the plane
    // (changing HELI_WIDTH above) keeps the nose - and therefore the tail
    // point below - correctly aligned automatically, no manual retuning.
    const ANCHOR_OFFSET_X = HELI_WIDTH * (55 / 70);

    const EDGE_SAFETY_MARGIN_X = 60;
    const EDGE_SAFETY_MARGIN_Y = 29;

    const EDGE_TOUCH_X = GRAPH_WIDTH - (HELI_WIDTH - ANCHOR_OFFSET_X) - EDGE_SAFETY_MARGIN_X;
    const EDGE_TOUCH_Y = HELI_HEIGHT + EDGE_SAFETY_MARGIN_Y;

    // How quickly the cruise baseline eases toward that real edge-touch
    // point each frame. Once it's there, that point IS the "touch" -
    // the swing only ever moves away from it diagonally down-left and
    // back, never past it, so the top of every swing actually makes
    // contact with the container's edge instead of hovering near an
    // arbitrary guessed spot. The swing's own reach is sized as a
    // proportion of the real container dimensions (12% of width, 20% of
    // height) rather than picked pixel counts, so it stays proportional
    // if the viewBox itself ever changes.
    const BASE_EASE_RATE = 0.006;
    const SWING_SPEED = 0.0014;
    const SWING_DISTANCE_X = GRAPH_WIDTH * 0.12;
    const SWING_DISTANCE_Y = GRAPH_HEIGHT * 0.2;

    // ================= TAIL ANCHOR =================
    const TAIL_FRACTION_X = 18 / HELI_NATURAL_W; // \~0.09, just inside the tail
const TAIL_FRACTION_Y = 80 / HELI_NATURAL_H; // \~0.56, fuselage centerline
    function getTailPoint(anchorX, anchorY) {
        return {
            x: (anchorX - ANCHOR_OFFSET_X) + TAIL_FRACTION_X * HELI_WIDTH,
            y: (anchorY - HELI_HEIGHT) + TAIL_FRACTION_Y * HELI_HEIGHT
        };
    }

    function buildCrashCurve(start, end) {
        const controlX = end.x;
        const controlY = start.y;
        return `M ${start.x} ${start.y} Q ${controlX} ${controlY}, ${end.x} ${end.y}`;
    }

    // ================= STATIC OVERLAY ELEMENTS =================
    const flewAwayContainer = document.getElementById("flewAwayContainer");
    const preparingText = document.getElementById("preparingText");
    const countdownBarContainer = document.getElementById("countdownBarContainer");
    const countdownBar = document.getElementById("countdownBar");

    // ================= LATE-JOIN POSITIONING =================
    function computeStartState(currentMultiplier) {
        const m = Math.max(1, Number(currentMultiplier) || 1);
        const progress = Math.min(1, (m - 1) / 4);

        if (progress <= 0.02) {
            return { x: 125, y: 310, phase: 1 };
        }

        const phase1EndX = 220;

         if (progress < 0.5) {
    const localProgress = progress / 0.5;
    const startX = 125 + localProgress * (phase1EndX - 125);  // was: 55 + ...(phase1EndX - 55)
    const startY = 310 - (startX - 125) * 0.5;                 // was: 320 - (startX - 55) * 0.5
    return { x: startX, y: startY, phase: 1 };
}
        const localProgress = (progress - 0.5) / 0.5;
        const startX = phase1EndX + localProgress * (MAX_X - phase1EndX);
        const startY = MAX_Y - localProgress * (MAX_Y - MIN_Y) * 0.6;
        return {
            x: startX,
            y: Math.max(MIN_Y, Math.min(startY, MAX_Y)),
            phase: 2
        };
    }

    window.beginRound = function (currentMultiplier) {

    console.trace("beginRound() was called");

    resetGame(currentMultiplier);

    if (typeof playRoundStartSound === "function") {
        playRoundStartSound();
    }

   isRunning = true;
window.animationRunning = true;

lastTime = 0;

requestAnimationFrame(animate);

};
    // ================= RESET =================
    function resetGame(currentMultiplier) {
        const startState = computeStartState(currentMultiplier);

        x = startState.x;
        y = startState.y;
        multiplierValue = Math.max(1, Number(currentMultiplier) || 1);
        phase = startState.phase;

        baseX = x;
        baseY = y;

        if (phase === 2) {
            swingPhaseOffset = Math.PI / 2 - performance.now() * SWING_SPEED;
        }

        multiplierEl.textContent = multiplierValue.toFixed(2) + "x";
        multiplierEl.style.color = "white";
        multiplierEl.style.opacity = "1";

        flightPath.setAttribute("d", "");
        fillArea.setAttribute("d", "");

        helicopter.style.left = ((x - ANCHOR_OFFSET_X) / GRAPH_WIDTH * 100) + "%";
helicopter.style.bottom = ((GRAPH_HEIGHT - y) / GRAPH_HEIGHT * 100) + "%";
helicopter.style.width = (HELI_WIDTH / GRAPH_WIDTH * 100) + "%";
helicopter.style.opacity = "1";
helicopter.style.transition = "none";

        flewAwayContainer.style.opacity = "0";
        countdownBarContainer.style.opacity = "0";
        preparingText.style.opacity = "0";
        countdownBar.style.width = "100%";
    }
    window.resetGame = resetGame;   

    // ================= CRASH =================
    function crashInstantly() {
        isRunning = false;
        window.animationRunning = false;
        phase = 3;

        if (typeof playCrashSound === "function") {
            playCrashSound();
        }

        helicopter.style.transition =
            "left 90ms linear, bottom 90ms linear, opacity 70ms linear";

        helicopter.style.left = ((MAX_X + 420) / GRAPH_WIDTH * 100) + "%";
helicopter.style.bottom = ((GRAPH_HEIGHT - y - 140) / GRAPH_HEIGHT * 100) + "%";
helicopter.style.opacity = "0";

        if (flightPath) flightPath.setAttribute("d", "");
        if (fillArea) fillArea.setAttribute("d", "");

        multiplierEl.style.color = "#ff3333";

        flewAwayContainer.style.opacity = "1";

        setTimeout(() => {
            flewAwayContainer.style.opacity = "0";

            countdownBarContainer.style.opacity = "1";
            preparingText.style.opacity = "1";

            multiplierEl.style.opacity = "0";

            countdownBar.style.width = "100%";
            countdownBar.offsetHeight;
            countdownBar.style.width = "0%";

            setTimeout(() => {
                countdownBarContainer.style.opacity = "0";
                preparingText.style.opacity = "0";

                if (typeof startNextRound === "function") {
                    startNextRound();
                }
            }, 8000);

        }, 3000);
    }

    // ================= ANIMATION =================
    function animate(timestamp) {
        if (!isRunning || phase === 3) return;

        if (!lastTime) lastTime = timestamp;
        const delta = timestamp - lastTime;

        if (delta < 16) {
            requestAnimationFrame(animate);
            return;
        }

        lastTime = timestamp;

        if (phase === 1) {
            x += 2.8;
            y -= 1.4;
            if (x >= 220) {
                phase = 2;
                baseX = x;
                baseY = y;
                swingPhaseOffset = Math.PI / 2 - timestamp * SWING_SPEED;
            }
        } else if (phase === 2) {
            // Ease the baseline toward the real edge-touch point.
            baseX += (EDGE_TOUCH_X - baseX) * BASE_EASE_RATE;
            baseY += (EDGE_TOUCH_Y - baseY) * BASE_EASE_RATE;

            // One-sided swing: sin() drives a factor that is 0 at its peak
            // (sin = 1, by construction of swingPhaseOffset above/below)
            // and 1 at its trough (sin = -1), so the swing only ever pulls
            // x/y away from the baseline toward the down-left, and back -
            // it never pushes past the baseline itself. Since baseX/Y ease
            // all the way to EDGE_TOUCH_X/Y, "swing = 0" is exactly the
            // helicopter touching the container's edge, and the swing then
            // carries it diagonally down-left and back to that same touch
            // point every cycle.
            const swing = Math.sin(timestamp * SWING_SPEED + swingPhaseOffset);
            const swingFactor = (1 - swing) / 2; // 0..1, 0 at the touch point

            x = baseX - swingFactor * SWING_DISTANCE_X;
            y = baseY - swingFactor * SWING_DISTANCE_Y;

            // Clamp against the real container edges themselves - x can
            // never push the div's right edge past GRAPH_WIDTH, y can
            // never push the div's top edge above 0.
            y = Math.max(EDGE_TOUCH_Y, Math.min(y, MAX_Y));
            x = Math.max(220, Math.min(x, EDGE_TOUCH_X));

            // ✅ FIX: guard against calling crashInstantly() more than once
            if (
                window.currentGameState &&
                window.currentGameState.status === "crashed" &&
                phase !== 3
            ) {
                crashInstantly();
                return;
            }
        }

        if (window.currentGameState) {
            multiplierValue = window.currentGameState.multiplier;
            multiplierEl.textContent =
                multiplierValue.toFixed(2) + "x";

            const currentStatus = window.currentGameState.status;

            if (currentStatus !== previousStatus) {
                previousStatus = currentStatus;
                console.log("Game Status:", currentStatus);
            }
        }

       helicopter.style.left = ((x - ANCHOR_OFFSET_X) / GRAPH_WIDTH * 100) + "%";
        helicopter.style.bottom = ((GRAPH_HEIGHT - y) / GRAPH_HEIGHT * 100) + "%";
        helicopter.style.width = (HELI_WIDTH / GRAPH_WIDTH * 100) + "%";

        const origin = { x: 0, y: 310 };
        const tail = getTailPoint(x, y);
        const curve = buildCrashCurve(origin, tail);

        if (flightPath) {
            flightPath.setAttribute("d", curve);
        }

        if (fillArea) {
            fillArea.setAttribute(
                "d",
                `${curve} L ${tail.x} 320 L ${origin.x} 320 Z`
            );
        }

        requestAnimationFrame(animate);
    }

    //setTimeout(() => startNextRound(), 600);
});