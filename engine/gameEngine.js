const supabase = require("./supabaseClient");

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

function generateCrashPoint() {
    const crashPoint = (1 + Math.random() * 9).toFixed(2);
    return Number(crashPoint);
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
    } // <-- while loop now properly closed here

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
}

async function runRound() {
    console.log("Creating new round...");

    const lastRound = await safeSelect("rounds", "round_number", "round_number", false, 1);

    const nextRoundNumber = (lastRound?.round_number || 0) + 1;
    console.log("Next Round Number:", nextRoundNumber);

    const crashPoint = generateCrashPoint();
    console.log("💥 Crash Point:", crashPoint + "x");

    const round = await safeInsert("rounds", {
        round_number: nextRoundNumber,
        started_at: new Date().toISOString(),
        crash_point: crashPoint,
    });

    console.log("Created round:", round.id);

    await safeUpdate(
        "current_round",
        {
            round_id: round.id,
            status: "betting",
            multiplier: 1,
            crash_point: crashPoint,
            started_at: round.started_at
        },
        "id",
        1
    );

    console.log("✅ Game is now in BETTING state.");
    console.log("⏳ Betting open for 10 seconds...");

    await sleep(4000);

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

        console.log("⏳ Waiting 5 seconds before next round...");
        await sleep(3000);
    }
}

gameLoop();