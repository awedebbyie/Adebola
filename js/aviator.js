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

    window.beginRound = function () {

    console.trace("beginRound() was called");

    resetGame();

   isRunning = true;
window.animationRunning = true;

lastTime = 0;

requestAnimationFrame(animate);

};
    // ================= RESET =================
    function resetGame() {
        x = 55;
        y = 320;
        multiplierValue = 1;
        phase = 1;

        multiplierEl.textContent = "1.00x";
        multiplierEl.style.color = "white";
        multiplierEl.style.opacity = "1";

        flightPath.setAttribute("d", "");
        fillArea.setAttribute("d", "");

        helicopter.style.left = "0px";
        helicopter.style.bottom = "0px";
        helicopter.style.opacity = "1";
        helicopter.style.transition = "none";

        flewAwayContainer.style.opacity = "0";
        countdownBarContainer.style.opacity = "0";
        preparingText.style.opacity = "0";

        countdownBar.style.transition = "none";
        countdownBar.style.width = "100%";
        countdownBar.offsetHeight; // force reflow
        countdownBar.style.transition = "width 4s linear"; // matches the real 4s betting window in engine/gameEngine.js
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

            // Snap the bar back to full width with the transition
            // temporarily off - otherwise the CSS's permanent
            // "transition: width Ns linear" animates THIS reset too, so by
            // the time we set width to 0% a moment later, the bar never
            // actually reached 100% and the countdown looks like it skips/
            // interrupts itself instead of running a clean countdown.
            countdownBar.style.transition = "none";
            countdownBar.style.width = "100%";

            countdownBar.offsetHeight; // force reflow

            // 4s, not 5s - this MUST match the actual betting-window length
            // in engine/gameEngine.js (await sleep(4000) before it flips
            // status to "flying"). Rounds are driven by that server-side
            // engine, not by this local timer: gameState.js calls
            // beginRound()/resetGame() the instant it polls status ===
            // "flying", regardless of what this countdown is doing. If this
            // duration is longer than the real betting window, the real
            // round starts flying - and 1.00x reappears - before this
            // countdown visually finishes, so the two MUST stay in sync.
            countdownBar.style.transition = "width 4s linear";
            countdownBar.style.width = "0%";

            setTimeout(() => {
                countdownBarContainer.style.opacity = "0";
                preparingText.style.opacity = "0";
                // Round restarts are driven by the host client in
                // gameController.js (claimHost() + startRound()), so there's
                // nothing to do here. This used to call an undefined
                // startNextRound(), throwing a ReferenceError every round.
            }, 4000); // matches the real betting-window length above

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