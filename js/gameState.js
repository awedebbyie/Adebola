async function getCurrentGameState() {

    const { data, error } = await window.supabaseClient
        .from("current_round")
        .select("*")
        .single();

    if (error) {
        console.error("Game state error:", error);
        return;
    }

    console.log("Current round:", data);

    updateGameFromServer(data);
}


setInterval(getCurrentGameState, 250);

function updateGameFromServer(state) {

    const multiplierEl = document.querySelector(".multiplier");

    if (multiplierEl) {
        multiplierEl.textContent =
            Number(state.multiplier).toFixed(2) + "x";
    }


    console.log(
        "Status:",
        state.status,
        "Multiplier:",
        state.multiplier
    );
}