/* =========================================================
   THEME.JS
   Single job: read/save the user's theme choice and put a
   class on <html> so theme.css can swap the main background.

   This file never sets inline styles, never touches buttons,
   text, fonts, or any element other than <html> itself. Any
   page that wants the background swap just needs to include
   both theme.css and theme.js - nothing else to wire up.
========================================================= */

(function () {

    function computeFinalTheme(mode) {
        if (mode === "dark" || mode === "light") return mode;

        // "system" (or anything unset/unrecognized) follows the OS setting
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        return prefersDark ? "dark" : "light";
    }

    function applyTheme() {
        const mode = localStorage.getItem("themeMode") || "system";
        const finalTheme = computeFinalTheme(mode);

        document.documentElement.classList.remove("theme-dark", "theme-light");
        document.documentElement.classList.add(
            finalTheme === "dark" ? "theme-dark" : "theme-light"
        );
    }

    // Public API - settings.html calls this when the user picks an option
    window.setTheme = function (mode) {
        localStorage.setItem("themeMode", mode);
        applyTheme();
    };

    window.applyTheme = applyTheme;

    // Keep in sync if the user has "System" selected and their OS theme changes
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        const mode = localStorage.getItem("themeMode");
        if (!mode || mode === "system") applyTheme();
    });

    // Apply immediately on load, on every page that includes this file
    applyTheme();

})();