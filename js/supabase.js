const SUPABASE_URL = "https://axojmnizpewbewempaaa.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4b2ptbml6cGV3YmV3ZW1wYWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDk3OTcsImV4cCI6MjA5ODA4NTc5N30._Ib3RhlMpPaUQoUVYDd6dS_gUOiaVsCBPBYEO30A8zc";

window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

console.log("✅ Supabase connected");

// Stores the latest game state from the backend. The actual polling loop
// that keeps this up to date lives in gameState.js (getCurrentGameState).
//
// This file previously ALSO ran its own independent 250ms poll
// (loadCurrentRound) with its own separate status tracking, which called
// window.resetGame() the instant it saw status "betting" - completely
// bypassing aviator.js's own crash/countdown animation timing. Since
// "betting" starts only 3 seconds after a crash (see engine/gameEngine.js),
// that duplicate call landed at almost the exact same moment
// crashInstantly() was trying to SHOW the countdown bar - so the two raced
// every single round, and whichever happened to run last in that instant
// decided whether you saw the countdown or "1.00x" stomping over it. That
// duplicate loop has been removed for good; gameState.js + aviator.js's own
// timers are now the only things that touch resetGame()/beginRound().
window.currentGameState = null;