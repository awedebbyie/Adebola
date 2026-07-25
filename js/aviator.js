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

    const MAX_X = 280; // right limit (ground level)

    // ✅ FIX: vertical boundaries
    const MIN_Y = 140; // top limit
    const MAX_Y = 320; // bottom limit (ground level)

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
                startNextRound();
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
            if (x >= 220) phase = 2;
        } else if (phase === 2) {
            if (x < MAX_X - 35) x += 2.45;
            else x += (Math.random() - 0.5) * 2;

            y += (Math.random() - 0.5) * 6;

            // ✅ FIX: clamp BOTH top and bottom
            y = Math.max(MIN_Y, Math.min(y, MAX_Y));

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

        if (flightPath) {
            flightPath.setAttribute("d", `M 0 320 L ${x} ${y}`);
        }

        if (fillArea) {
            fillArea.setAttribute(
                "d",
                `M 0 320 L ${x} ${y} L ${x} 320 L 0 320 Z`
            );
        }

        requestAnimationFrame(animate);
    }

    //setTimeout(() => startNextRound(), 600);
});