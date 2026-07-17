console.log("GAME CONTROLLER STARTED");

console.log("Creating a new round...");

import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

export default {
  fetch: withSupabase({ auth: ["secret"] }, async (req, ctx) => {
    console.log("Game controller started");

    console.log("Reading rounds table...");

const result = await ctx.supabaseAdmin
  .from("rounds")
  .select("round_number")
  .order("round_number", { ascending: false })
  .limit(1)
  .maybeSingle();

console.log("Finished reading rounds table");

console.log(result);

const latestRound = result.data;
    const nextRound = latestRound
      ? latestRound.round_number + 1
      : 1;

    console.log("About to insert round:", nextRound);

    const bettingEnds = new Date(Date.now() + 5000);

    const { data, error } = await ctx.supabaseAdmin
      .from("rounds")
      .insert({
        round_number: nextRound,
        status: "betting",
        betting_ends_at: bettingEnds.toISOString()
      })
      .select()
      .single();
    console.log("Insert result:", data);
    console.log("Insert error:", error);

    if (error) {
      return Response.json({
        success: false,
        error: error.message
      });
    }

    await ctx.supabaseAdmin
      .from("current_round")
      .update({
        round_id: data.id,
        round_number: data.round_number,
        status: data.status,
        updated_at: new Date().toISOString()
      })
      .eq("id", 1);
    console.log("Current round updated");

    return Response.json({
      success: true,
      round: data
    });

  }),
};