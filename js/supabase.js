const SUPABASE_URL = "https://axojmnizpewbewempaaa.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4b2ptbml6cGV3YmV3ZW1wYWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDk3OTcsImV4cCI6MjA5ODA4NTc5N30._Ib3RhlMpPaUQoUVYDd6dS_gUOiaVsCBPBYEO30A8zc";

window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

console.log("✅ Supabase connected");

// Stores the latest game state from the backend
window.currentGameState = null;

window.currentGameState = null;
let previousStatus = null;

async function loadCurrentRound() {

    const { data, error } = await window.supabaseClient
        .from("current_round")
        .select("*")
        .eq("id", 1)
        .single();

    if (error) {
        console.error("Polling error:", error);
        return;
    }

    window.currentGameState = data;

    // Detect status changes
    if (previousStatus !== data.status) {

    console.log("Game Status:", data.status);

    if (data.status === "betting") {

        if (window.resetGame) {
            window.resetGame();
        }

    }

    if (data.status === "flying") {

        if (window.beginRound) {
            window.beginRound();
        }

    }

    previousStatus = data.status;
}
}

// Load immediately
loadCurrentRound();

// Check for updates every 250ms
setInterval(loadCurrentRound, 250);