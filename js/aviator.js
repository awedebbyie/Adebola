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

    // Which dot the helicopter is currently travelling toward during the
    // phase-2 bounce loop. false = heading for TARGET_1 (field-dot1),
    // true = heading for TARGET_2 (field-dot2). Flipped every time the
    // tail rotor reaches whichever dot it was heading for - see animate().
    let headingToDot2 = false;

    const MAX_X = 280; // right limit - still used by crashInstantly() below to fly the helicopter off-screen.

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

    // ================= WAYPOINTS =================
    // Calibrated against the .field-dot1 / .field-dot2 markers in
    // style.css (currently field-dot1{left:50%;top:10%},
    // field-dot2{left:92%;top:60%}). Those dots are visual calibration
    // markers only and will be removed from the page for production - if
    // you move/remove them, update the two percentages below to match
    // wherever they were last placed so the flight path stays correct.
    const FIELD_DOT_1 = { x: GRAPH_WIDTH * 0.25, y: GRAPH_HEIGHT * 0.23 }; // virtual coords (100, 73.6)
const FIELD_DOT_2 = { x: GRAPH_WIDTH * 0.67, y: GRAPH_HEIGHT * 0.60 }; // virtual coords (268, 192)
    // Converts a desired TAIL-ROTOR point into the anchor (x,y) that the
    // rest of this file uses for helicopter.style.left/bottom - i.e. the
    // inverse of getTailPoint() above - so the helicopter ends up
    // positioned such that its spinning tail rotor lands exactly on the
    // target dot, not the sprite's nose/anchor corner.
    function anchorForTail(tx, ty) {
        return {
            x: tx + ANCHOR_OFFSET_X - TAIL_FRACTION_X * HELI_WIDTH,
            y: ty + HELI_HEIGHT - TAIL_FRACTION_Y * HELI_HEIGHT
        };
    }

    const TARGET_1 = anchorForTail(FIELD_DOT_1.x, FIELD_DOT_1.y);
    const TARGET_2 = anchorForTail(FIELD_DOT_2.x, FIELD_DOT_2.y);

    const MOVE_SPEED = 2.2; // px/frame (virtual 400x320 coords) travelled along each leg

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
            return { x: 125, y: 310, phase: 1, headingToDot2: false };
        }

        if (progress < 0.5) {
            // Still on the initial climb from the origin up to dot 1 -
            // drop the late-joiner in partway along that straight line.
            const localProgress = progress / 0.5;
            const startX = 125 + localProgress * (TARGET_1.x - 125);
            const startY = 310 + localProgress * (TARGET_1.y - 310);
            return { x: startX, y: startY, phase: 1, headingToDot2: false };
        }

        // Round is already in the dot1<->dot2 bounce - drop the
        // late-joiner in at dot 2, already heading back toward dot 1.
        return { x: TARGET_2.x, y: TARGET_2.y, phase: 2, headingToDot2: false };
    }

    window.beginRound = function (currentMultiplier) {

    console.trace("beginRound() was called");

    resetGame(currentMultiplier);

    if (typeof playRoundStartSound === "function") {
        playRoundStartSound();
    }

   // Motion is about to start - swap in the animated (spinning-rotor) sprite.
   helicopter.src = "helicopter.svg";

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
        headingToDot2 = startState.headingToDot2;

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
        countdownBarContainer.style.transition = "none";
        countdownBarContainer.style.opacity = "0";
        countdownBarContainer.offsetHeight; // force reflow so the instant hide above actually applies before the bar underneath is reset
        preparingText.style.opacity = "0";
        countdownBar.style.transition = "none";
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

        // Only the "flew away" crash message is on a local timer here -
        // it's purely cosmetic and never controls when the next round
        // actually starts. The countdown bar itself is driven entirely
        // by window.showBettingCountdown(), called from gameState.js the
        // moment the REAL server round enters "betting" - see that
        // function below. This used to also run its own independent
        // ~11s timer that animated the same bar and then called a
        // (nonexistent) startNextRound() - that second, fake timer is
        // what caused the countdown to intermittently glitch: it was
        // racing against resetGame() forcibly resetting the same bar the
        // instant the real server round actually went "flying", at
        // whatever unrelated moment that fake timer happened to be at.
        setTimeout(() => {
            flewAwayContainer.style.opacity = "0";

            // Flew-away text just finished disappearing - show the static
            // (idle, no-spin) sprite until the next round's motion begins.
            helicopter.src = "hepicopter.svg";

            multiplierEl.style.opacity = "0";
        }, 3000);
    }

    // Called from gameState.js the moment it observes the real server
    // round enter "betting" - durationMs is the ACTUAL remaining time in
    // that window (computed from the round's real started_at timestamp),
    // not a guess. The CSS transition duration is set inline to match
    // exactly, so this can never drift from the real timing - and
    // resetGame() (called by beginRound() when the real round goes
    // "flying") is now the ONLY other code that ever touches this bar,
    // so there's no more race between two independent timers.
    window.showBettingCountdown = function (durationMs) {
        // Bring the helicopter back into view at its resting/idle spot as
        // soon as the betting window opens, instead of leaving it hidden
        // (from crashInstantly()'s off-screen, opacity:0 state) until the
        // next round actually goes "flying" and resetGame() runs. This is
        // purely cosmetic positioning - resetGame() still runs its own
        // (possibly late-join-adjusted) placement once flying starts.
        helicopter.style.transition = "none";
        helicopter.style.left = ((125 - ANCHOR_OFFSET_X) / GRAPH_WIDTH * 100) + "%";
        helicopter.style.bottom = ((GRAPH_HEIGHT - 310) / GRAPH_HEIGHT * 100) + "%";
        helicopter.style.width = (HELI_WIDTH / GRAPH_WIDTH * 100) + "%";
        helicopter.style.opacity = "1";

        if (!durationMs || durationMs <= 0) {
            countdownBarContainer.style.opacity = "0";
            preparingText.style.opacity = "0";
            return;
        }

        countdownBarContainer.style.transition = "";
        countdownBarContainer.style.opacity = "1";
        preparingText.style.opacity = "1";

        countdownBar.style.transition = "none";
        countdownBar.style.width = "100%";
        countdownBar.offsetHeight; // force reflow so the reset above actually applies before animating
        countdownBar.style.transition = `width ${durationMs}ms linear`;
        countdownBar.style.width = "0%";
    };

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

        // Checked FIRST, every single frame, regardless of which phase
        // the helicopter is currently in. This used to live only inside
        // the phase === 2 branch below, which meant a crash happening
        // during phase 1 (the initial climb, before the first bounce
        // point) was completely ignored until the animation happened to
        // reach that point on its own - the helicopter kept flying for
        // however long that took, well past the real crash moment.
        if (
            window.currentGameState &&
            window.currentGameState.status === "crashed" &&
            phase !== 3
        ) {
            crashInstantly();
            return;
        }

        if (phase === 1) {
            // Climbing straight from the origin up to field-dot1 - once the
            // tail rotor reaches it, switch into the dot1<->dot2 bounce loop.
            const dx = TARGET_1.x - x;
            const dy = TARGET_1.y - y;
            const dist = Math.hypot(dx, dy);

            if (dist <= MOVE_SPEED) {
                x = TARGET_1.x;
                y = TARGET_1.y;
                phase = 2;
                headingToDot2 = true; // tail just touched dot 1 - head for dot 2 next
            } else {
                x += (dx / dist) * MOVE_SPEED;
                y += (dy / dist) * MOVE_SPEED;
            }
        } else if (phase === 2) {
            // Bounce loop: travel in a straight diagonal line toward
            // whichever dot is next: once the tail rotor touches it, flip
            // direction and head for the other one. Repeats until crash.
            const target = headingToDot2 ? TARGET_2 : TARGET_1;
            const dx = target.x - x;
            const dy = target.y - y;
            const dist = Math.hypot(dx, dy);

            if (dist <= MOVE_SPEED) {
                x = target.x;
                y = target.y;
                headingToDot2 = !headingToDot2; // tail touched the dot - bounce to the other one
            } else {
                x += (dx / dist) * MOVE_SPEED;
                y += (dy / dist) * MOVE_SPEED;
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

});