document.addEventListener("DOMContentLoaded", () => {

    const rows = document.querySelectorAll(".invest-row");

    rows.forEach((row) => {

        const input = row.querySelector(".amount-input");
        const investBtn = row.querySelector(".invest-btn");
        const priceBtns = row.querySelectorAll(".price-btn");

        // =========================
        // ONLY NUMBERS + DECIMALS
        // =========================
        input.addEventListener("input", () => {

            // remove letters automatically (but don't block typing)
            input.value = input.value.replace(/[^0-9.]/g, "");

            let value = Number(input.value);

            if (input.value === "" || isNaN(value)) {
                investBtn.innerHTML = `<span>INVEST</span>`;
                return;
            }

            if (value < 10) {
                investBtn.innerHTML = `
                    <span>INVEST</span>
                    <small>(Minimum ₦10)</small>
                `;
                return;
            }

            investBtn.innerHTML = `
                <span>INVEST</span>
                <small>(₦${value.toFixed(2)})</small>
            `;
        });

        // =========================
        // BLUR FIX (FINAL CLEAN VALUE)
        // =========================
        input.addEventListener("blur", () => {

            let value = Number(input.value);

            if (isNaN(value) || value < 10) {
                value = 10;
            }

            input.value = value.toFixed(2);

            investBtn.innerHTML = `
                <span>INVEST</span>
                <small>(₦${value.toFixed(2)})</small>
            `;
        });

        // =========================
        // QUICK PRICE BUTTONS
        // =========================
        priceBtns.forEach((btn) => {

            btn.addEventListener("click", () => {

                let value = Number(btn.textContent);

                if (value < 10) value = 10;

                input.value = value.toFixed(2);

                investBtn.innerHTML = `
                    <span>INVEST</span>
                    <small>(₦${value.toFixed(2)})</small>
                `;
            });

        });

        // =========================
        // INVEST CLICK
        // =========================
        investBtn.addEventListener("click", () => {

            let value = Number(input.value);
        
            if (isNaN(value)) {
                alert("Enter a valid amount");
                return;
            }
        
            if (value < 10) {
        
                alert("Minimum investment is ₦10");
        
                input.value = "10.00";
        
                investBtn.innerHTML = `
                    <span>INVEST</span>
                    <small>(₦10.00)</small>
                `;
        
                return; // STOP HERE - DO NOT PLACE BET
            }
        
            // Investment placed - No message shown anymore
            // You can add your real investment logic here

        });

    });

});
