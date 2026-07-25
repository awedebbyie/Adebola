let gameRunning = false;

async function updateGameState(updates) {

    const { data, error } = await window.supabaseClient
        .from("current_round")
        .update(updates)
        .eq("id", 1)
        .select()
        .single();

    if (error) {
        console.error("Update failed:", error);
        return;
    }

    console.log("Game updated:", data);
}


async function startRound() {

    if (gameRunning) return;

    gameRunning = true;

    const roundId = Date.now();


    await updateGameState({
        round_id: roundId,
        status: "betting",
        multiplier: 1.00,
        crash_point: null,
        started_at: new Date()
    });


    console.log("Betting started");


    setTimeout(() => {
        flyRound(roundId);
    }, 10000);
}


async function flyRound(roundId) {

    console.log("Flight started");


    await updateGameState({
        status: "flying"
    });


    let multiplier = 1;


    const interval = setInterval(async () => {

        multiplier += 0.05;


        await updateGameState({
            multiplier: multiplier.toFixed(2)
        });


        if (multiplier >= 5) {

            clearInterval(interval);

            await crashRound(multiplier);

        }

    }, 500);

}



async function crashRound(multiplier) {


    await updateGameState({

        status: "crashed",

        crash_point: multiplier.toFixed(2)

    });


    console.log("Crashed at:", multiplier);


    gameRunning = false;


    setTimeout(() => {

        startRound();

    }, 5000);

}

claimHost().then(isHost=>{

    if(isHost){
        startRound();
    }

});