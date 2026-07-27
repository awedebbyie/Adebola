document.addEventListener("DOMContentLoaded", () => {
    const helicopter = document.getElementById("helicopter");
    const multiplierEl = document.querySelector(".multiplier");
    const flightPath = document.getElementById("flightPath");
    const fillArea = document.getElementById("fillArea");

    let x = 55;
    let y = 320;
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

    const MAX_X = 280; // right limit (ground level) - used for the climb-out/late-join math further down, untouched.

    // ✅ FIX: vertical boundaries
    const MIN_Y = 140; // top limit - also only used for the climb-out/late-join math further down.
    const MAX_Y = 320; // bottom limit (ground level)

    // ================= REAL CONTAINER + SPRITE GEOMETRY =================
    // Everything below is computed from actual measured values instead of
    // picked by eye, so the cruise swing always lines up with the real
    // container/sprite regardless of future tweaks to either:
    //   - GRAPH_WIDTH/GRAPH_HEIGHT are the .curve-svg viewBox in
    //     index.html ("0 0 400 320") - the coordinate space the
    //     helicopter's left/bottom and the SVG path both already share.
    //   - HELI_WIDTH matches the `.helicopter { width }` rule in
    //     style.css; HELI_HEIGHT is derived from helicopter.png's own
    //     660x519 pixel dimensions (no CSS height is set, so the browser
    //     scales it to the same aspect ratio).
    const GRAPH_WIDTH = 400;
    const GRAPH_HEIGHT = 320;

    const HELI_WIDTH = 70;
    const HELI_NATURAL_W = 660;
    const HELI_NATURAL_H = 519;
    const HELI_HEIGHT = HELI_WIDTH * (HELI_NATURAL_H / HELI_NATURAL_W);

    // The helicopter div is positioned with `left = x - 55` and
    // `bottom` measured from the container's bottom, which (see
    // getTailPoint() below) works out to the div's BOTTOM edge sitting
    // at y and its top edge at (y - HELI_HEIGHT). So the div's right
    // edge is (x - 55 + HELI_WIDTH), and solving for the anchor that
    // puts that right edge exactly on the container's right edge
    // (GRAPH_WIDTH) gives the true "touching the edge" x. Same for the
    // div's top edge against the container's top edge (0).
    //
    // ⚠️ TUNE THIS SIDE: `.graph-area` is sized responsively in CSS
    // (width:100%, height:50%), so its actual on-screen pixel size isn't
    // guaranteed to be exactly 400x320 (GRAPH_WIDTH x GRAPH_HEIGHT) - the
    // SVG stretches to fit whatever size it actually renders at, but the
    // helicopter's left/bottom are plain pixels assuming that 1:1 match.
    // If the helicopter still pokes outside the container on your
    // screen, increase EDGE_SAFETY_MARGIN below (pulls the touch point
    // further in from the true edge); if there's noticeable empty gap
    // between the helicopter and the edge at the peak of the swing,
    // decrease it. This is the one number to adjust - nothing else in
    // this block needs to change.
    const EDGE_SAFETY_MARGIN = 60;

    const EDGE_TOUCH_X = GRAPH_WIDTH - (HELI_WIDTH - 55) - EDGE_SAFETY_MARGIN;
    const EDGE_TOUCH_Y = HELI_HEIGHT + EDGE_SAFETY_MARGIN;

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
    // The flight-path line used to be drawn straight to (x, y) - the same
    // point used to place the helicopter <img>'s top-left corner via
    // `left`/`bottom`. That point is just the sprite's bounding-box corner,
    // not the actual tail of the helicopter drawn inside helicopter.png, so
    // the line would end up trailing under the tail by a noticeable margin.
    //
    // helicopter.png is 660x519, and the visual center of the tail rotor in
    // that image sits at roughly (645, 310) - i.e. ~97.7% across and ~59.7%
    // down.
    const TAIL_FRACTION_X = 645 / HELI_NATURAL_W;
    const TAIL_FRACTION_Y = 310 / HELI_NATURAL_H;

    // Converts the helicopter's positioning anchor (x, y - same coordinate
    // space as the SVG path) into the exact pixel the tail sits at, so the
    // trail can lock onto it instead of the sprite's bounding box.
    function getTailPoint(anchorX, anchorY) {
        return {
            x: (anchorX - 55) + TAIL_FRACTION_X * HELI_WIDTH,
            y: (anchorY - HELI_HEIGHT) + TAIL_FRACTION_Y * HELI_HEIGHT
        };
    }

    // Draws the trail as a single curve computed fresh every frame from
    // just two points: the fixed origin and the helicopter's current tail
    // position. Nothing about the curve is stored/accumulated from past
    // frames - the origin and the live position are what shape it, every
    // time. That's what actually produces the classic crash-game look:
    // a quadratic Bezier with its control point pinned to (end.x,
    // start.y) stays flat while x grows, then sweeps up sharply near the
    // end - exactly like the accelerating curve real crash games draw,
    // and unlike a literal recording of this game's own point-to-point
    // motion (which is close to a straight line/random walk and doesn't
    // look curved at all).
    function buildCrashCurve(start, end) {
        const controlX = end.x;
        const controlY = start.y;
        return `M ${start.x} ${start.y} Q ${controlX} ${controlY}, ${end.x} ${end.y}`;
    }

    // ================= STATIC OVERLAY ELEMENTS =================
    // These now live directly in index.html and are styled via style.css,
    // so we just grab them instead of creating them dynamically.
    const flewAwayContainer = document.getElementById("flewAwayContainer");
    const preparingText = document.getElementById("preparingText");
    const countdownBarContainer = document.getElementById("countdownBarContainer");
    const countdownBar = document.getElementById("countdownBar");

    // ================= LATE-JOIN POSITIONING =================
    // If a browser starts watching a round that is already flying (e.g. it
    // just refreshed, or just opened the page mid-round), we shouldn't draw
    // the helicopter at the origin - the round didn't just start for
    // everyone else. Instead, estimate a start position/phase from the
    // current server multiplier so the heli visually appears "already in
    // flight" instead of flashing back to the ground.
    function computeStartState(currentMultiplier) {
        const m = Math.max(1, Number(currentMultiplier) || 1);

        // How far along a "typical" round this multiplier represents.
        // Most rounds crash under ~5x (see generateCrashPoint), so use that
        // as a soft ceiling for visual progress - this is only cosmetic.
        const progress = Math.min(1, (m - 1) / 4);

        if (progress <= 0.02) {
            // Effectively a fresh round - behave exactly as before.
            return { x: 55, y: 320, phase: 1 };
        }

        const phase1EndX = 220;

        if (progress < 0.5) {
            // Still within the climb-out portion of the flight.
            const localProgress = progress / 0.5;
            const startX = 55 + localProgress * (phase1EndX - 55);
            const startY = 320 - (startX - 55) * 0.5; // matches phase 1's -1.4/2.8 slope
            return { x: startX, y: startY, phase: 1 };
        }

        // Well into the flight - render already in the cruising phase.
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

        // Cruise hover starts from wherever the round actually begins.
        baseX = x;
        baseY = y;

        multiplierEl.textContent = multiplierValue.toFixed(2) + "x";
        multiplierEl.style.color = "white";
        multiplierEl.style.opacity = "1";

        flightPath.setAttribute("d", "");
        fillArea.setAttribute("d", "");

        // Position the helicopter at its computed start position rather than
        // always snapping to the origin (0px, 0px) - for a fresh round these
        // are the same thing, since x=55,y=320 maps to left:0px, bottom:0px.
        helicopter.style.left = (x - 55) + "px";
        helicopter.style.bottom = (320 - y) + "px";
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

        helicopter.style.left = (MAX_X + 420) + "px";
        helicopter.style.bottom = (320 - y - 140) + "px";
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

                // startNextRound() was never defined anywhere in this
                // project - gameState.js's own 250ms poll already detects
                // the next round and calls window.beginRound() itself, so
                // this was dead code left over from an earlier version.
                // Guarded the same way the rest of the codebase guards
                // optional cross-file calls, instead of deleting it
                // outright, in case a real implementation gets wired in
                // later.
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
                // Cruise picks up exactly where the climb left off, then
                // eases from there toward the top-right corner.
                baseX = x;
                baseY = y;
            }
        } else if (phase === 2) {
            // Keep drifting the touch-point baseline toward the real
            // edge-touch coordinate (EDGE_TOUCH_X/Y, computed above from
            // the actual container + sprite geometry) the longer the
            // round runs, then swing between that point and one
            // diagonally down-left of it. The swing is one-sided (0 at
            // the top, -1 at the bottom) so it always peaks exactly ON
            // the baseline itself - the sprite's real bounding-box edge
            // actually touching the container's real edge - then sweeps
            // diagonally down-left before swinging back, repeating
            // continuously.
            baseX += (EDGE_TOUCH_X - baseX) * BASE_EASE_RATE;
            baseY += (EDGE_TOUCH_Y - baseY) * BASE_EASE_RATE;

            const swing = (Math.sin(timestamp * SWING_SPEED) - 1) / 2; // 0..-1

            x = baseX + swing * SWING_DISTANCE_X;
            y = baseY - swing * SWING_DISTANCE_Y;

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

        helicopter.style.left = (x - 55) + "px";
        helicopter.style.bottom = (320 - y) + "px";

        const origin = { x: 0, y: 320 };
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