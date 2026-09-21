/**
 * lib/telegram.js — Pengirim notifikasi Telegram via Bot API (Opsi A: axios-only).
 *
 * Notify-only: tidak ada long-polling / koneksi persisten.
 * Cukup HTTPS POST ke https://api.telegram.org/bot<TOKEN>/sendMessage
 * sehingga tetap jalan walaupun koneksi WhatsApp (Baileys) mati.
 *
 * ENV yang dipakai:
 *   TELEGRAM_ENABLED=true|false (default: true jika TOKEN+CHAT_ID ada)
 *   TELEGRAM_BOT_TOKEN=123456:ABC...
 *   TELEGRAM_CHAT_ID=-100xxxxxxxxxx  (ID grup/channel tujuan)
 *   TELEGRAM_TOPIC_ID=123            (opsional, untuk grup forum/topic)
 *   TELEGRAM_PARSE_MODE=HTML         (default HTML; kosongkan untuk plain text)
 *   TELEGRAM_DISABLE_NOTIFICATION=false (default false)
 */

const axios = require("axios");

const API_BASE = "https://api.telegram.org";
const MAX_TEXT_LENGTH = 4096;

function getConfig() {
    const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
    const topicIdRaw = (process.env.TELEGRAM_TOPIC_ID || "").trim();
    const enabledRaw = (process.env.TELEGRAM_ENABLED || "").trim().toLowerCase();
    const parseMode = (process.env.TELEGRAM_PARSE_MODE || "HTML").trim();

    // Default: enabled jika token + chatId tersedia, kecuali eksplisit "false"/"0"/"off"/"no".
    const explicitlyDisabled = ["false", "0", "off", "no", "disabled"].includes(enabledRaw);
    const explicitlyEnabled = ["true", "1", "on", "yes", "enabled"].includes(enabledRaw);
    const enabled = explicitlyDisabled ? false : explicitlyEnabled ? true : Boolean(token && chatId);

    let topicId = null;
    if (topicIdRaw && /^\d+$/.test(topicIdRaw)) topicId = Number(topicIdRaw);

    return { token, chatId, topicId, enabled, parseMode };
}

function isTelegramReady() {
    const cfg = getConfig();
    return Boolean(cfg.enabled && cfg.token && cfg.chatId);
}

function logStatus() {
    const cfg = getConfig();
    if (!cfg.token || !cfg.chatId) {
        console.log("[!] Telegram disabled: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diisi di .env");
        return false;
    }
    if (!cfg.enabled) {
        console.log("[!] Telegram disabled via TELEGRAM_ENABLED=false");
        return false;
    }
    console.log(`[+] Telegram enabled -> chat ${cfg.chatId}${cfg.topicId ? ` (topic ${cfg.topicId})` : ""}`);
    return true;
}

function splitLongText(text, maxLen = MAX_TEXT_LENGTH) {
    if (!text) return [""];
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let rest = text;
    while (rest.length > maxLen) {
        let cut = rest.lastIndexOf("\n", maxLen);
        if (cut <= 0) cut = maxLen;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest) chunks.push(rest);
    return chunks;
}

function describeTelegramError(err) {
    const data = err?.response?.data;
    if (data?.description) return `Telegram API ${data.error_code || ""}: ${data.description}`;
    return err?.message || String(err);
}

/**
 * Kirim pesan ke grup Telegram. Tidak pernah melempar error fatal ke pemanggil
 * dalam arti: melempar Error biasa agar bisa di-catch per-channel via allSettled,
 * tapi tidak mematikan proses.
 */
async function sendTelegram(htmlOrText, opts = {}) {
    const cfg = getConfig();
    if (!cfg.enabled) throw new Error("Telegram disabled (TELEGRAM_ENABLED=false)");
    if (!cfg.token) throw new Error("TELEGRAM_BOT_TOKEN belum dikonfigurasi di .env");
    if (!cfg.chatId) throw new Error("TELEGRAM_CHAT_ID belum dikonfigurasi di .env");

    const retries = opts.retries ?? 3;
    const delay = opts.delay ?? 1500;
    const parseMode = opts.parseMode !== undefined ? opts.parseMode : cfg.parseMode || undefined;
    const disableNotification = opts.disableNotification ?? (process.env.TELEGRAM_DISABLE_NOTIFICATION === "true");

    const chunks = splitLongText(String(htmlOrText || ""));
    const url = `${API_BASE}/bot${cfg.token}/sendMessage`;

    for (let ci = 0; ci < chunks.length; ci++) {
        const text = chunks[ci];
        let lastErr = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const payload = {
                    chat_id: cfg.chatId,
                    text,
                    disable_web_page_preview: true,
                    disable_notification: disableNotification,
                };
                if (parseMode) payload.parse_mode = parseMode;
                if (cfg.topicId) payload.message_thread_id = cfg.topicId;

                await axios.post(url, payload, { timeout: 15000 });
                console.log(`[DEBUG] SUCCESS: Telegram message part ${ci + 1}/${chunks.length} sent (attempt ${attempt}/${retries})`);
                lastErr = null;
                break;
            } catch (err) {
                lastErr = err;
                console.error(`[!] Telegram attempt ${attempt}/${retries} (part ${ci + 1}/${chunks.length}) failed: ${describeTelegramError(err)}`);
                // Token salah / bot di-kick / chat tidak ada -> retry tidak ada gunanya.
                const desc = String(describeTelegramError(err));
                if (/unauthorized|not found|kicked|deactivated/i.test(desc)) break;
                if (attempt < retries) await new Promise((r) => setTimeout(r, delay));
            }
        }
        if (lastErr) throw new Error(describeTelegramError(lastErr));
        if (ci < chunks.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
}

/** Alert ringan status WA ke grup Telegram (best-effort, tidak throw). */
async function notifyTelegramStatus(text) {
    try {
        if (!isTelegramReady()) return false;
        await sendTelegram(text, { retries: 2, delay: 1000 });
        return true;
    } catch (err) {
        console.error("[!] Gagal kirim status WA ke Telegram:", err.message);
        return false;
    }
}

module.exports = {
    getConfig,
    isTelegramReady,
    logStatus,
    sendTelegram,
    notifyTelegramStatus,
    __test: { splitLongText, describeTelegramError },
};
