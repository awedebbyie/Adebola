// supabaseClient.js - backend's own Supabase connection, used only by
// admin routes (admin stats, and anything else admin-side you add later
// that needs to read game/bet data).
//
// Uses the SERVICE ROLE key (bypasses RLS) because admin stats need to
// see every user's bets, not just what a public/anon key's RLS policy
// would allow. This is exactly why it must stay server-side only and
// never get near frontend code - same reasoning as engine/supabaseClient.js.
//
// Required environment variables - add to backend/.env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;