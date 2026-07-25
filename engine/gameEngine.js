const supabase = require("./supabaseClient");
const crashLogic = require("./crashLogic");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const MULTIPLIER_INTERVAL = 0.5;

async function safeUpdate(table, values, column, value) {
    while (true) {
        const { error } = await supabase
            .from(table)
            .update(values)
            .eq(column, value);

        if (!error) {
            return true;
        }

        console.log("⚠️ Connection lost. Retrying in 1 second...");
        console.log(error.message);

        await sleep(1000);
    }
}

async function safeInsert(table, values) {
    while (true) {
        const { data, error } = await supabase
            .from(table)
            .insert(values)
            .select()
            .single();

        if (!error) {
            return data;
        }

        console.log("⚠️ Connection lost. Retrying in 1 second...");
        console.log(error.message);

        await sleep(1000);
    }
}

async function safeSelect(table, selectCols, orderCol, ascending, limit) {
    while (true) {
        const { data, error } = await supabase
            .from(table)
            .select(selectCols)
            .order(orderCol, { ascending })
            .limit(limit)
            .maybeSingle();

        if (!error) {
            return data;
        }

        console.log("⚠️ Connection lost. Retrying in 1 second...");
        console.log(error.message);

        await sleep(1000);
    }
}

async function settleLostBets(roundId) {
    while (true) {
        const { error } = await supabase
            .from("bets")
            .update({ status: "lost" })
            .eq("round_id", roundId)
            .eq("status", "active");

        if (!error) {
            return true;
        }

        console.log("⚠️ Connection lost. Retrying in 1 second...");
        console.log(error.message);

        await sleep(1000);
    }
}

async function updateMultiplier(roundId, crashPoint) {
    let multiplier = 1.00;

    console.log("📈 Multiplier started...");

    while (multiplier < crashPoint) {
        let increment = 0.05;

        if (multiplier >= 2) increment = 0.06;
        if (multiplier >= 5) increment = 0.08;
        if (multiplier >= 10) increment = 0.12;
        if (multiplier >= 20) increment = 0.20;
        if (multiplier >= 50) increment = 0.40;

        multiplier += increment;
        multiplier = Number(multiplier.toFixed(2));

        await safeUpdate(
            "current_round",
            { multiplier: multiplier },
            "id",
            1
        );

        console.log(multiplier + "x");

        await sleep(MULTIPLIER_INTERVAL);
    }

    console.log("💥 CRASH!");

    const crashedAt = new Date().toISOString();

    await safeUpdate(
        "current_round",
        {
            status: "crashed",
            multiplier: crashPoint,
            crashed_at: crashedAt
        },
        "id",
        1
    );

    console.log("✅ Round crashed.");

    await safeUpdate(
        "rounds",
        {
            crashed_at: crashedAt
        },
        "id",
        roundId
    );

    // Server-side safety net: any bet still "active" for this round never
    // cashed out before the crash, so it's a loss. The frontend also marks
    // its own bets "lost" the moment it sees status "crashed", but doing it
    // here too means a bet isn't stuck "active" forever if the player's tab
    // was closed/disconnected before the crash. The extra .eq("status",
    // "active") filter is what keeps this from also clobbering rows that
    // already made it to "cashed_out".
    await settleLostBets(roundId);

    console.log("✅ Losing bets settled.");
}

async function runRound() {
    console.log("Creating new round...");

    const lastRound = await safeSelect("rounds", "round_number", "round_number", false, 1);

    const nextRoundNumber = (lastRound?.round_number || 0) + 1;
    console.log("Next Round Number:", nextRoundNumber);

    // Crash point isn't known yet - it depends on this round's total_bets,
    // which isn't known until betting closes. It's filled in further down.
    const round = await safeInsert("rounds", {
        round_number: nextRoundNumber,
        started_at: new Date().toISOString(),
        crash_point: null,
    });

    console.log("Created round:", round.id);

    await safeUpdate(
        "current_round",
        {
            round_id: round.id,
            status: "betting",
            multiplier: 1,
            crash_point: null,
            started_at: round.started_at
        },
        "id",
        1
    );

    console.log("✅ Game is now in BETTING state.");
    console.log("⏳ Betting open for 7 seconds...");

    await sleep(7000);

    // Fixed lines below
    const { data: bets, error } = await supabase
        .from("bets")
        .select("amount")
        .eq("round_id", round.id);

    if (error) {
        console.error(error);
    }

    const totalBets = (bets || []).reduce(
        (sum, bet) => sum + Number(bet.amount),
        0
    );

    await supabase
        .from("rounds")
        .update({
            total_bets: totalBets
        })
        .eq("id", round.id);

    console.log("💰 Total Bets:", totalBets);

    // Crash multiplier generation lives entirely in crashLogic.js - the
    // engine just hands over total_bets and uses whatever comes back.
    const crashPoint = crashLogic.getCrashMultiplier(totalBets);
    console.log("💥 Crash Point:", crashPoint + "x");

    await safeUpdate(
        "rounds",
        { crash_point: crashPoint },
        "id",
        round.id
    );

    await safeUpdate(
        "current_round",
        { crash_point: crashPoint },
        "id",
        1
    );

    console.log("✈️ Starting flight...");

    await safeUpdate(
        "current_round",
        { status: "flying" },
        "id",
        1
    );

    console.log("✅ Flight started.");

    await updateMultiplier(round.id, crashPoint);
}

async function gameLoop() {
    console.log("🎮 Game Engine Started");

    while (true) {
        try {
            await runRound();
        } catch (err) {
            console.error("Round failed:", err);
        }

        console.log("⏳ Waiting 3 seconds before next round...");
        await sleep(3000);
    }
}

gameLoop();