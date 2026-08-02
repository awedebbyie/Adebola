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

async function updateMultiplier(roundId, crashPoint, serverSeed) {
    let multiplier = 1.00;

    console.log("📈 Multiplier started...");

    while (multiplier < crashPoint) {
        let increment = 0.08;

        if (multiplier >= 2) increment = 0.10;
        if (multiplier >= 5) increment = 0.6;
        if (multiplier >= 10) increment = 1.5;
        if (multiplier >= 20) increment = 4;
        if (multiplier >= 50) increment = 10;

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

    // Reveal the raw server seed now that the round is over. Anyone can
    // now take (serverSeed, client_seed, nonce, server_seed_hash) - all
    // public at this point - and independently confirm:
    //   1. hashing serverSeed reproduces server_seed_hash (nothing was
    //      swapped after the hash was published pre-round)
    //   2. crashLogic.generateCrashPoint(serverSeed, clientSeed, nonce)
    //      reproduces this exact crashPoint
    await safeUpdate(
        "current_round",
        {
            status: "crashed",
            multiplier: crashPoint,
            crashed_at: crashedAt,
            server_seed: serverSeed
        },
        "id",
        1
    );

    console.log("✅ Round crashed.");
    console.log("🔓 Server seed revealed:", serverSeed);

    await safeUpdate(
        "rounds",
        {
            crashed_at: crashedAt,
            server_seed: serverSeed
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

    // ---- Provably fair commit step -------------------------------------
    // Generate + hash the server seed BEFORE betting opens, and pick a
    // public client seed + nonce, all before anyone can bet. Only the
    // hash (never the raw server seed) goes out during betting - that's
    // what makes this a real commitment instead of "trust us": the
    // house can't change its mind about the result after seeing bets,
    // because the hash was already published and can't be un-published.
    // The raw server seed is revealed only after the round crashes (see
    // below), at which point anyone can hash it themselves and confirm
    // it matches, then feed (serverSeed, clientSeed, nonce) into
    // crashLogic.generateCrashPoint() and confirm the same crash point
    // comes out.
    const serverSeed = crashLogic.generateServerSeed();
    const serverSeedHash = crashLogic.hashServerSeed(serverSeed);
    const clientSeed = crashLogic.generateServerSeed().slice(0, 16); // public - doesn't need to stay secret
    const nonce = nextRoundNumber;

    const round = await safeInsert("rounds", {
        round_number: nextRoundNumber,
        started_at: new Date().toISOString(),
        crash_point: null,
        server_seed_hash: serverSeedHash,
        client_seed: clientSeed,
        nonce: nonce,
    });

    console.log("Created round:", round.id);
    console.log("🔒 Server seed hash (published now):", serverSeedHash);

    await safeUpdate(
        "current_round",
        {
            round_id: round.id,
            status: "betting",
            multiplier: 1,
            crash_point: null,
            started_at: round.started_at,
            server_seed_hash: serverSeedHash,
            client_seed: clientSeed,
            nonce: nonce,
            server_seed: null
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

    // Resolve using the SAME seed/clientSeed/nonce that were committed
    // (and hashed, and published) before betting even opened. totalBets
    // is intentionally not passed in anywhere here - the result was
    // already fixed the moment the hash went out, long before this
    // point, regardless of how much action came in during betting.
    const crashPoint = crashLogic.generateCrashPoint(serverSeed, clientSeed, nonce);
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

    await updateMultiplier(round.id, crashPoint, serverSeed);
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