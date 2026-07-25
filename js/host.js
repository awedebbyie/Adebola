const myHostId = crypto.randomUUID();

async function claimHost() {

    const { data, error } = await window.supabaseClient
        .from("game_control")
        .select("*")
        .eq("id", 1)
        .single();

    if (error) {
        console.error("Host check error:", {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code
});
        return false;
    }


    if (!data.host_id) {

        const { error: updateError } = await window.supabaseClient
            .from("game_control")
            .update({
                host_id: myHostId,
                last_seen: new Date()
            })
            .eq("id", 1);


        if (updateError) {
            console.error("Host update error:", updateError);
            return false;
        }


        console.log("✅ I am the game host");

        return true;
    }


    console.log("⛔ Another host already exists");

    return false;
}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    