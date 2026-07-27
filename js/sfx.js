// =========================
// SOUND EFFECTS (round-start + crash)
// =========================
// This is separate from js/music.js (background music) - it has its own
// mute switch ("soundMuted" in localStorage), toggled from Settings >
// Audio > Sound, independently of the Music toggle. This file is only
// loaded on index.html since these effects are tied to the flight
// animation, which only runs there.

const roundStartSound = new Audio("assets/sounds/round-start.mp3");
const crashSound = new Audio("assets/sounds/crash.mp3");

roundStartSound.volume = 0.7;
crashSound.volume = 0.7;

function isSoundMuted() {
    return localStorage.getItem("soundMuted") === "true";
}

// currentTime is reset before every play() so the effect can fire again
// immediately (e.g. back-to-back rounds) without waiting for a previous
// playthrough to finish first.
function playRoundStartSound() {
    if (isSoundMuted()) return;
    roundStartSound.currentTime = 0;
    roundStartSound.play().catch(() => {});
}

function playCrashSound() {
    if (isSoundMuted()) return;
    crashSound.currentTime = 0;
    crashSound.play().catch(() => {});
}