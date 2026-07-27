// =========================
// BACKGROUND MUSIC
// =========================
// Drop your music file at assets/sounds/background-music.mp3 (see the
// README.md in that folder). This file just handles playback - it does
// not care what the track actually is.
//
// Mute/unmute lives on the Settings page (Audio > Music), not here - this
// file just reads the "musicMuted" preference from localStorage and plays
// (or stays silent) accordingly.

const MUSIC_SRC = "assets/sounds/background-music.mp3";
const MUSIC_VOLUME = 0.4; // 0.0 - 1.0, kept modest so it sits behind any
                           // sound effects added later and doesn't blast
                           // people the moment the page loads

const backgroundMusic = new Audio(MUSIC_SRC);
backgroundMusic.loop = true;
backgroundMusic.volume = MUSIC_VOLUME;
backgroundMusic.preload = "auto";
backgroundMusic.muted = localStorage.getItem("musicMuted") === "true";

// Browsers refuse to play audio with sound until the user has interacted
// with the page (click/tap/keypress). We attempt to start immediately in
// case the browser allows it (some do once a site's been visited before),
// and otherwise fall back to starting on the very first interaction.
function attemptMusicStart() {
    backgroundMusic.play().catch(() => {
        const startOnce = () => {
            backgroundMusic.play().catch(() => {});
            document.removeEventListener("click", startOnce);
            document.removeEventListener("touchstart", startOnce);
            document.removeEventListener("keydown", startOnce);
        };
        document.addEventListener("click", startOnce);
        document.addEventListener("touchstart", startOnce);
        document.addEventListener("keydown", startOnce);
    });
}

attemptMusicStart();

// If the Settings page is open in another tab and the person flips the
// Music toggle there, pick up the change here immediately rather than
// waiting for a reload.
window.addEventListener("storage", (e) => {
    if (e.key === "musicMuted") {
        backgroundMusic.muted = e.newValue === "true";
    }
});