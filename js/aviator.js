document.addEventListener("DOMContentLoaded", () => {
    const helicopter = document.getElementById("helicopter");
    const multiplierEl = document.querySelector(".multiplier");
    const flightPath = document.getElementById("flightPath");
    const fillArea = document.getElementById("fillArea");

    let x = 55;
    let y = 320;
    let multiplierValue = 1;
    let phase = 1;
    let crashPoint = 0;
    let lastTime = 0;
    let isRunning = false;

    const MAX_X = 280; // right limit (ground level)

    // ✅ FIX: vertical boundaries
    const MIN_Y = 140; // top limit
    const MAX_Y = 320; // bottom limit (ground level)

    let flewAwayContainer = document.getElementById("flewAwayContainer");
    let countdownBarContainer = document.getElementById("countdownBarContainer");
    let countdownBar;
    let preparingText;

    const gameContainer =
        document.querySelector(".game-container") ||
        document.querySelector("#game") ||
        helicopter.parentElement;

    // ================= FLEW AWAY =================
    if (!flewAwayContainer) {
        flewAwayContainer = document.createElement("div");
        flewAwayContainer.id = "flewAwayContainer";
        flewAwayContainer.style.cssText = `
            position: absolute;
            top: 29%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 100;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.4s ease;
        `;

        const flewText = document.createElement("div");
        flewText.textContent = "FLEW AWAY!";
        flewText.style.cssText = `
            font-size: 23px;
            font-weight: 900;
            color: red;
            letter-spacing: 2px;
        `;

        flewAwayContainer.appendChild(flewText);
        gameContainer.appendChild(flewAwayContainer);
    }

    // ================= COUNTDOWN =================
    if (!countdownBarContainer) {
        countdownBarContainer = document.createElement("div");
        countdownBarContainer.id = "countdownBarContainer";
        countdownBarContainer.style.cssText = `
            position: absolute;
            bottom: 60%;
            left: 50%;
            transform: translateX(-50%);
            width: 280px;
            height: 8px;
            background: rgba(255,255,255,0.2);
            border-radius: 4px;
            overflow: visible;
            z-index: 95;
            opacity: 0;
            transition: opacity 0.4s;
        `;

        gameContainer.appendChild(countdownBarContainer);
    }

    countdownBar = document.getElementById("countdownBar");

    if (!countdownBar) {
        countdownBar = document.createElement("div");
        countdownBar.id = "countdownBar";
        countdownBar.style.cssText = `
            width: 100%;
            height: 100%;
            background: red;
            transition: width 5s linear;
        `;
        countdownBarContainer.appendChild(countdownBar);
    }

    // ================= PREPARING TEXT =================
    preparingText = document.getElementById("preparingText");

    if (!preparingText) {
        preparingText = document.createElement("div");
        preparingText.id = "preparingText";
        preparingText.textContent = "PREPARING FOR NEXT ROUND";

        gameContainer.appendChild(preparingText);

        preparingText.style.cssText = `
            position: absolute;
            bottom: 62%;
            left: 50%;
            transform: translateX(-50%);
            color: #ffffff;
            font-size:14px;
            font-weight: 900;
            letter-spacing: 2px;
            text-transform: uppercase;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 999;
        `;
    }

    // ================= RESET =================
    function resetGame() {
        x = 55;
        y = 320;
        multiplierValue = 1;
        phase = 1;

        crashPoint = window.generateCrashPoint
            ? window.generateCrashPoint()
            : 1 + Math.random() * 20;

        multiplierEl.textContent = "1.00x";
        multiplierEl.style.color = "";
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
        countdownBar.style.width = "100%";
    }

    // ================= CRASH =================
    function crashInstantly() {
        isRunning = false;
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
            }, 5000);

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

            if (multiplierValue >= crashPoint) {
                crashInstantly();
                return;
            }
        }

        multiplierValue += 0.018;
        multiplierEl.textContent = multiplierValue.toFixed(2) + "x";

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

    function startNextRound() {

    // Create a brand-new multiplayer round
    startNewRound();

    resetGame();

    isRunning = true;

    lastTime = 0;

    requestAnimationFrame(animate);
}

    setTimeout(() => startNextRound(), 600);
});