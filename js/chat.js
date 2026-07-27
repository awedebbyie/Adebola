// chat.js - Player chat.
//
// UI shape: a small message icon (top-right of the round-history strip).
// Clicking it opens a floating dropdown (position:absolute in CSS) that
// overlays the page - it's never part of normal document flow, so no
// matter how many messages there are, it can never push the graph or
// anything below it down. A red dot appears on the icon when a new
// message arrives while the dropdown is closed, and clears the moment
// it's opened.
//
// Numbers are NOT allowed in chat messages - neither as digits (0-9, or
// any other script's digits) nor spelled out in words ("one", "twenty",
// "hundred", etc). That's enforced here on the client (so people get
// instant feedback and nothing bad is ever sent), and again server-side
// by a Postgres trigger on the chat_messages table (see
// supabase/migrations/20260727000000_create_chat_messages.sql) so the
// rule holds even against a client that skips this file entirely.
//
// Messages are stored in Supabase's chat_messages table and picked up by
// polling, the same pattern gameState.js uses for round state - this
// codebase deliberately avoids relying on Supabase realtime subscriptions
// elsewhere, so chat follows suit rather than introducing a new pattern.
//
// Identity (who's sending) reuses the exact same source bets.js uses:
// Firebase Auth (auth.currentUser) for the logged-in user, and the
// Firestore "users" collection for their display username.

(function () {
    const MAX_RENDERED_MESSAGES = 50;
    const POLL_INTERVAL_MS = 2000;
    const MESSAGE_MAX_LEN = 300;
    const SEND_COOLDOWN_MS = 1500;

    let lastSeenId = 0;
    let lastSentAt = 0;
    let currentUsername = null;
    let currentUserId = null;
    let isOpen = false;

    // ---- Number filter ----------------------------------------------

    // Spelled-out number words (cardinals, ordinals, and scale words).
    // Deliberately broad - the goal is to block numbers, not to be lenient
    // toward edge-case English usage.
    const NUMBER_WORDS = [
        "zero", "nought", "naught", "nil",
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
        "twenty", "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety",
        "hundred", "thousand", "million", "billion", "trillion", "grand",
        "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
        "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
        "twentieth", "thirtieth", "fortieth", "fourtieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth",
        "hundredth", "thousandth", "millionth", "billionth", "trillionth"
    ];
    const numberWordPattern = new RegExp("\\b(" + NUMBER_WORDS.join("|") + ")\\b", "i");

    function hasDigit(text) {
        // \p{Nd} covers digits from any script (Arabic-Indic, fullwidth, etc),
        // not just ASCII 0-9.
        return /[0-9]|\p{Nd}/u.test(text);
    }

    function hasNumberWord(text) {
        // Normalize hyphens/underscores to spaces first so hyphenated forms
        // like "twenty-one" still match word-by-word.
        const normalized = text.replace(/[-_]/g, " ");
        return numberWordPattern.test(normalized);
    }

    function containsRestrictedNumber(text) {
        return hasDigit(text) || hasNumberWord(text);
    }

    // ---- UI helpers ----------------------------------------------------

    let errorHideTimer = null;
    function showError(message) {
        const el = document.getElementById("chatError");
        if (!el) return;

        el.textContent = message || "";
        el.style.display = message ? "block" : "none";

        clearTimeout(errorHideTimer);
        if (message) {
            errorHideTimer = setTimeout(() => {
                el.style.display = "none";
                el.textContent = "";
            }, 4000);
        }
    }

    function setChatEnabled(enabled, placeholderText) {
        const input = document.getElementById("chatInput");
        const sendBtn = document.getElementById("chatSendBtn");

        if (input) {
            input.disabled = !enabled;
            if (placeholderText) input.placeholder = placeholderText;
        }
        if (sendBtn) sendBtn.disabled = !enabled;
    }

    function setUnread(hasUnread) {
        const iconBtn = document.getElementById("chatIconBtn");
        if (!iconBtn) return;
        iconBtn.classList.toggle("has-unread", !!hasUnread);
    }

    function renderMessage(row) {
        const container = document.getElementById("chatMessages");
        if (!container) return;

        const wrap = document.createElement("div");
        wrap.className = "chat-message";

        const nameEl = document.createElement("span");
        nameEl.className = "chat-message-user";
        nameEl.textContent = (row.username || "Player") + ":";

        const bodyEl = document.createElement("span");
        bodyEl.className = "chat-message-text";
        // textContent (not innerHTML) - never render a message as markup.
        bodyEl.textContent = row.message;

        wrap.appendChild(nameEl);
        wrap.appendChild(bodyEl);
        container.appendChild(wrap);

        while (container.children.length > MAX_RENDERED_MESSAGES) {
            container.removeChild(container.firstChild);
        }
    }

    function isScrolledNearBottom(container) {
        return container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    }

    // ---- Open / close dropdown -----------------------------------------

    function openChat() {
        const dropdown = document.getElementById("chatDropdown");
        const backdrop = document.getElementById("chatBackdrop");
        if (!dropdown) return;

        isOpen = true;
        dropdown.classList.add("chat-dropdown-open");
        if (backdrop) backdrop.classList.add("chat-open");

        setUnread(false);

        const container = document.getElementById("chatMessages");
        if (container) container.scrollTop = container.scrollHeight;
    }

    function closeChat() {
        const dropdown = document.getElementById("chatDropdown");
        const backdrop = document.getElementById("chatBackdrop");
        if (!dropdown) return;

        isOpen = false;
        dropdown.classList.remove("chat-dropdown-open");
        if (backdrop) backdrop.classList.remove("chat-open");
    }

    function toggleChat() {
        if (isOpen) {
            closeChat();
        } else {
            openChat();
        }
    }

    // ---- Loading / polling ---------------------------------------------

    async function loadInitialMessages() {
        if (!window.supabaseClient) return;

        try {
            const { data, error } = await window.supabaseClient
                .from("chat_messages")
                .select("id, username, message, created_at")
                .order("id", { ascending: false })
                .limit(MAX_RENDERED_MESSAGES);

            if (error) {
                console.error("Chat: initial load failed:", error);
                return;
            }
            if (!data || data.length === 0) return;

            const oldestFirst = data.slice().reverse();
            oldestFirst.forEach((row) => {
                renderMessage(row);
                if (row.id > lastSeenId) lastSeenId = row.id;
            });

            const container = document.getElementById("chatMessages");
            if (container) container.scrollTop = container.scrollHeight;
        } catch (err) {
            console.error("Chat: initial load error:", err);
        }
    }

    async function pollNewMessages() {
        if (!window.supabaseClient) return;

        try {
            const { data, error } = await window.supabaseClient
                .from("chat_messages")
                .select("id, username, message, created_at")
                .order("id", { ascending: true })
                .gt("id", lastSeenId)
                .limit(50);

            if (error) {
                console.error("Chat: poll failed:", error);
                return;
            }
            if (!data || data.length === 0) return;

            const container = document.getElementById("chatMessages");
            const wasNearBottom = container ? isScrolledNearBottom(container) : false;

            let gotMessageFromSomeoneElse = false;

            data.forEach((row) => {
                renderMessage(row);
                if (row.id > lastSeenId) lastSeenId = row.id;
                if (row.user_id !== currentUserId) gotMessageFromSomeoneElse = true;
            });

            if (container && wasNearBottom) {
                container.scrollTop = container.scrollHeight;
            }

            // Only badge the icon for messages we didn't just send ourselves,
            // and only if the dropdown isn't already open (open = already seen).
            if (!isOpen && gotMessageFromSomeoneElse) {
                setUnread(true);
            }
        } catch (err) {
            console.error("Chat: poll error:", err);
        }
    }

    // ---- Sending ---------------------------------------------------------

    async function sendMessage(rawText) {
        const trimmed = (rawText || "").trim();
        if (!trimmed) return;

        if (!currentUsername) {
            showError("You need to be logged in to chat.");
            return;
        }

        if (trimmed.length > MESSAGE_MAX_LEN) {
            showError("Message is too long.");
            return;
        }

        if (containsRestrictedNumber(trimmed)) {
            showError("Numbers aren't allowed in chat - not as digits, not spelled out.");
            return;
        }

        const now = Date.now();
        if (now - lastSentAt < SEND_COOLDOWN_MS) {
            return; // quietly ignore accidental double-sends
        }
        lastSentAt = now;

        const input = document.getElementById("chatInput");
        const sendBtn = document.getElementById("chatSendBtn");
        if (sendBtn) sendBtn.disabled = true;

        try {
            const { error } = await window.supabaseClient
                .from("chat_messages")
                .insert({
                    user_id: currentUserId,
                    username: currentUsername,
                    message: trimmed
                });

            if (error) {
                console.error("Chat: send failed:", error);
                // The server-side trigger also blocks numbers - if this ever
                // fires for that reason (client filter was bypassed somehow),
                // show the same message so it doesn't look like a random error.
                if (/number/i.test(error.message || "")) {
                    showError("Numbers aren't allowed in chat - not as digits, not spelled out.");
                } else {
                    showError("Message couldn't be sent. Please try again.");
                }
                return;
            }

            if (input) input.value = "";
            pollNewMessages();
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    // ---- Wiring ------------------------------------------------------

    function initForm() {
        const form = document.getElementById("chatForm");
        const input = document.getElementById("chatInput");
        if (!form) return;

        form.addEventListener("submit", (e) => {
            e.preventDefault();
            if (!input) return;
            sendMessage(input.value);
        });

        // Live feedback while typing, so people see the problem before they
        // even try to hit send.
        if (input) {
            input.addEventListener("input", () => {
                if (containsRestrictedNumber(input.value)) {
                    showError("Numbers aren't allowed in chat.");
                } else {
                    showError("");
                }
            });
        }
    }

    function initOpenClose() {
        const iconBtn = document.getElementById("chatIconBtn");
        const closeBtn = document.getElementById("chatCloseBtn");
        const backdrop = document.getElementById("chatBackdrop");

        if (iconBtn) iconBtn.addEventListener("click", toggleChat);
        if (closeBtn) closeBtn.addEventListener("click", closeChat);
        if (backdrop) backdrop.addEventListener("click", closeChat);

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && isOpen) closeChat();
        });
    }

    function initAuthWatch() {
        if (typeof auth === "undefined" || !auth.onAuthStateChanged) return;

        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                currentUsername = null;
                currentUserId = null;
                setChatEnabled(false, "Login to chat");
                return;
            }

            currentUserId = user.uid;

            try {
                const userDoc = await db.collection("users").doc(user.uid).get();
                const data = userDoc.exists ? userDoc.data() : null;
                currentUsername = (data && data.username) || user.displayName ||
                    (user.email ? user.email.split("@")[0] : "Player");
            } catch (err) {
                console.error("Chat: failed to load username:", err);
                currentUsername = user.displayName || (user.email ? user.email.split("@")[0] : "Player");
            }

            setChatEnabled(true, "Say something... (no numbers)");
        });
    }

    initOpenClose();
    initForm();
    initAuthWatch();
    loadInitialMessages();
    setInterval(pollNewMessages, POLL_INTERVAL_MS);
})();