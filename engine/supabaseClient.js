const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://axojmnizpewbewempaaa.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4b2ptbml6cGV3YmV3ZW1wYWFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwOTc5NywiZXhwIjoyMDk4MDg1Nzk3fQ.Ft09H2qB98zQ57SGNuaGbNSRbJAQbjo-Pmevd3DBvl4";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY
);

module.exports = supabase;