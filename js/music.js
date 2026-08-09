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

let hasStartedSuccessfully = false;
let loadRetries = 0;
const MAX_LOAD_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

backgroundMusic.addEventListener("playing", () => {
    hasStartedSuccessfully = true;
});

// This fires on a genuine load/decode failure (bad network, interrupted
// fetch, etc) - NOT on an autoplay block, which shows up as a rejected
// play() promise instead. On flaky connections the file often just needs
// another attempt rather than being truly unreachable, so retry a few
// times with a short delay instead of leaving the track silently dead.
backgroundMusic.addEventListener("error", () => {
    if (hasStartedSuccessfully || loadRetries >= MAX_LOAD_RETRIES) return;
    loadRetries++;
    setTimeout(() => {
        backgroundMusic.load();
        attemptMusicStart();
    }, RETRY_DELAY_MS);
});

// Browsers refuse to play audio with sound until the user has interacted
// with the page (click/tap/keypress). We attempt to start immediately in
// case the browser allows it (some do once a site's been visited before),
// and otherwise fall back to starting on interaction.
function attemptMusicStart() {
    backgroundMusic.play().then(() => {
        hasStartedSuccessfully = true;
    }).catch(() => {
        const retryOnInteraction = () => {
            if (hasStartedSuccessfully) {
                cleanup();
                return;
            }
            // Could still fail here too (e.g. the earlier attempt was
            // cut off mid-buffer) - unlike before, this listener stays
            // attached and tries again on the *next* interaction instead
            // of giving up for the rest of the page's life.
            backgroundMusic.play().then(() => {
                hasStartedSuccessfully = true;
                cleanup();
            }).catch(() => {});
        };
        function cleanup() {
            document.removeEventListener("click", retryOnInteraction);
            document.removeEventListener("touchstart", retryOnInteraction);
            document.removeEventListener("keydown", retryOnInteraction);
        }
        document.addEventListener("click", retryOnInteraction);
        document.addEventListener("touchstart", retryOnInteraction);
        document.addEventListener("keydown", retryOnInteraction);
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