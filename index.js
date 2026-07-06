/**
 * noxarianet store - WhatsApp Bot v5.0 (AUTO PAYMENT FLOW)
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { createClient } = require("@supabase/supabase-js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const pino = require("pino");
const WebSocket = require("ws");
const os = require("os");
const fs = require("fs");
require("dotenv").config();

function cleanSessionFiles(forceFullClean = false) {
    const authDir = "auth_info_baileys";
    if (fs.existsSync(authDir)) {
        try {
            const files = fs.readdirSync(authDir);
            for (const file of files) {
                if (forceFullClean || file !== "creds.json") {
                    const filePath = authDir + "/" + file;
                    fs.rmSync(filePath, { force: true, recursive: true });
                    console.log("[+] Menghapus file sesi:", file);
                }
            }
            if (forceFullClean) {
                console.log("[+] Berhasil menghapus SEMUA file sesi (termasuk creds.json).");
            } else {
                console.log("[+] Berhasil menghapus file sesi korup (kecuali creds.json).");
            }
        } catch (e) {
            console.error("[!] Gagal membersihkan file sesi:", e.message);
        }
    }
}

process.on("unhandledRejection", (reason) => {
    const errMsg = reason?.message || String(reason);
    console.error("[!] Unhandled Rejection:", errMsg);
    if (errMsg.includes("Bad MAC")) {
        console.log("[!] Mendeteksi Bad MAC error di background. Mengabaikan agar bot tetap berjalan...");
    }
});

process.on("uncaughtException", (err) => {
    const errMsg = err?.message || String(err);
    console.error("[!] Uncaught Exception:", errMsg);
    if (errMsg.includes("Bad MAC")) {
        console.log("[!] Mendeteksi Bad MAC error di background. Mengabaikan agar bot tetap berjalan...");
    }
});

let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        realtime: { transport: WebSocket },
    });
    console.log("[+] Supabase configured");
} else {
    console.warn("[!] SUPABASE belum dikonfigurasi di .env");
}

const GROUP_NAME_KEYWORD = "BUKTI TRANSAKSI | noxarianet store";
const ADMIN_NUMBER = "6285936603517";

// ======================== SUDAH DIGANTI DENGAN ID BENAR ========================
// ID grup "BUKTI TRANSAKSI | noxarianet store" dari log console
const targetGroupId = "120363428192718440@g.us";
// ===================================================================

let supabaseSubscribed = false;
let pollingStarted = false;
let currentSock = null;
let cachedGroupId = null;
let orderNotificationsReady = false;
let botActivationTime = null;
const notifiedOrderIds = new Set();

function setOrderNotificationsReady(isReady, reason = "") {
    orderNotificationsReady = isReady;
    const label = isReady ? "READY" : "BLOCKED";
    const suffix = reason ? " - " + reason : "";
    console.log(`[DEBUG] Order notifications: ${label}${suffix}`);
}

function isOrderNotificationReady() {
    return Boolean(orderNotificationsReady && currentSock?.user);
}

function setBotActivationTime(now = new Date()) {
    if (botActivationTime) return botActivationTime;
    const activationDate = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(activationDate.getTime())) {
        throw new Error("Invalid bot activation time");
    }
    botActivationTime = activationDate.toISOString();
    console.log(`[DEBUG] Bot activation cutoff set: ${botActivationTime}`);
    return botActivationTime;
}

function getOrderTimestamp(order) {
    const rawTimestamp =
        order?.timestamp ||
        order?.created_at ||
        order?.createdAt ||
        order?.order_timestamp ||
        null;

    if (!rawTimestamp) return null;
    const parsed = new Date(rawTimestamp);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function isOrderEligibleForCurrentRun(order, activationTime = botActivationTime) {
    if (!activationTime) return false;

    const orderTimestamp = getOrderTimestamp(order);
    if (!orderTimestamp) return false;

    const activationDate = activationTime instanceof Date ? activationTime : new Date(activationTime);
    if (Number.isNaN(activationDate.getTime())) return false;

    return orderTimestamp.getTime() > activationDate.getTime();
}

function isOrderEligibleForUpdate(order) {
    const orderTimestamp = getOrderTimestamp(order);
    if (!orderTimestamp) return false;

    // Izinkan order yang dibuat dalam 24 jam terakhir untuk update realtime
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return orderTimestamp.getTime() > oneDayAgo;
}

function formatWaJid(waNumber) {
    let num = (waNumber || "").toString().replace(/\D/g, "");
    if (!num) return null;

    // Bersihkan potensi double country code prefix (misal: 62628... -> 628...)
    if (num.startsWith("6262")) {
        num = num.slice(2);
    }

    if (num.startsWith("0")) {
        num = "62" + num.slice(1);
    } else if (num.startsWith("620")) {
        num = "62" + num.slice(3);
    } else if (!num.startsWith("62")) {
        num = "62" + num;
    }

    // Validasi panjang nomor telepon minimal (9 digit) untuk menghindari JID sampah
    if (num.length < 9) return null;

    return num + "@s.whatsapp.net";
}

async function resolveRealJid(waNumber) {
    const basicJid = formatWaJid(waNumber);
    if (!basicJid || !currentSock?.user) return basicJid;
    try {
        // Implementasi timeout 3 detik untuk mencegah bot menggantung jika WA server lambat
        const resolvePromise = currentSock.onWhatsApp(basicJid);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("onWhatsApp timeout")), 3000)
        );

        const [result] = await Promise.race([resolvePromise, timeoutPromise]);
        if (result?.exists && result?.jid) {
            console.log(`[DEBUG] onWhatsApp resolved: ${waNumber} -> ${result.jid}`);
            return result.jid;
        }
        console.log(`[DEBUG] onWhatsApp: ${waNumber} tidak ditemukan di WA, menggunakan JID dasar: ${basicJid}`);
    } catch (e) {
        console.error(`[DEBUG] onWhatsApp error/timeout untuk ${waNumber}:`, e.message);
    }
    return basicJid;
}

function maskEmail(email) {
    if (!email || !email.includes("@")) return "-";
    const [name, domain] = email.split("@");
    if (name.length <= 2) {
        return name[0] + "***@" + domain;
    }
    return name.slice(0, 2) + "***" + name.slice(-1) + "@" + domain;
}

function maskPhone(phone) {
    if (!phone) return "-";
    const cleaned = phone.toString().replace(/\D/g, "");
    if (cleaned.length < 8) return cleaned.slice(0, 3) + "****";
    return cleaned.slice(0, 4) + "****" + cleaned.slice(-4);
}

function formatLicenses(licenses) {
    if (!licenses || licenses.length === 0)
        return "_Detail akun tidak tersedia. Hubungi admin._";
    return licenses
        .map((lic, i) => {
            if (typeof lic === "string") return i + 1 + ". " + lic;
            const lines = Object.entries(lic)
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => "   - " + k + ": *" + v + "*");
            return "*Akun " + (i + 1) + ":*\n" + lines.join("\n");
        })
        .join("\n\n");
}

function parseTargetNote(noteVal) {
    if (!noteVal) return "-";
    if (typeof noteVal !== "string") return String(noteVal);

    const trimmed = noteVal.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
            const parsed = JSON.parse(trimmed);
            return parsed.target || parsed.customer_id || trimmed;
        } catch (e) {
            // Not valid JSON
        }
    }
    return noteVal;
}

function formatFulfillmentDetails(order) {
    const details = order.account_details || {};
    const rawItems = details.raw_items || [];

    const h2hItems = rawItems.filter(item => item.order_process === "h2h");
    const smmItems = rawItems.filter(item => item.order_process === "smm");

    if (h2hItems.length > 0) {
        return h2hItems.map((item, i) => {
            let snList = "-";
            if (item.h2h_results) {
                if (Array.isArray(item.h2h_results)) {
                    snList = item.h2h_results.map(res => res.sn).filter(Boolean).join(", ") || "-";
                } else if (typeof item.h2h_results === "object") {
                    snList = item.h2h_results.sn || "-";
                } else if (typeof item.h2h_results === "string") {
                    snList = item.h2h_results;
                }
            }
            const target = parseTargetNote(item.note || item.target);
            return `*Item ${i + 1}:* ${item.product_name} - ${item.variant_name}\n` +
                `   - Target: *${target}*\n` +
                `   - SN/Ref: *${snList}*\n` +
                `   - Status: *Sukses*`;
        }).join("\n\n");
    } else if (smmItems.length > 0) {
        return smmItems.map((item, i) => {
            const target = parseTargetNote(item.note || item.target);
            return `*Item ${i + 1}:* ${item.product_name} - ${item.variant_name}\n` +
                `   - Target: *${target}*\n` +
                `   - Status: *Sukses*`;
        }).join("\n\n");
    } else {
        const licenses = details.licenses || [];
        if (licenses.length > 0) {
            return formatLicenses(licenses);
        }
    }

    if (rawItems.length > 0) {
        return rawItems.map((item, i) => {
            const target = parseTargetNote(item.note || item.target);
            return `*Item ${i + 1}:* ${item.variant_name || item.product_name || "Produk Digital"}\n` +
                `   - Detail: *${target}*\n` +
                `   - Status: *Sukses*`;
        }).join("\n\n");
    }

    return "_Detail akun tidak tersedia. Hubungi admin._";
}

// ======================== FUNGSI RESOLVE GROUP ID ========================
// Langsung pakai hardcode, tidak deteksi grup
async function resolveGroupId(sock) {
    console.log(`[DEBUG] Sending to target group: ${targetGroupId}`);
    cachedGroupId = targetGroupId;
    return targetGroupId;
}
// ===================================================================

async function sendViaCurrent(jid, text, retries = 3, delay = 1500) {
    console.log(`[DEBUG] Attempting to send message to: ${jid}`);
    if (!currentSock?.user) {
        const errMsg = "Connection not ready";
        console.error(`[DEBUG] ${errMsg}`);
        throw new Error(errMsg);
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await currentSock.sendMessage(jid, { text });
            console.log(`[DEBUG] SUCCESS: Message sent to ${jid} on attempt ${attempt}/${retries}`);
            return;
        } catch (err) {
            console.error(`[!] Attempt ${attempt}/${retries} failed to send message to ${jid}: ${err.message}`);
            if (attempt === retries) {
                throw err;
            }
            console.log(`[DEBUG] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function startBot() {
    try {
        setOrderNotificationsReady(false, "initializing socket");
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            auth: state,
            browser: ["noxarianet Bot", "Safari", "5.0"],
            syncFullHistory: false,
        });
        currentSock = sock;
        sock.ev.on("creds.update", saveCreds);

        const getSendOptions = (quotedMsg) => {
            if (!quotedMsg) return {};
            const participant = quotedMsg.key.participant || quotedMsg.key.remoteJid || "";
            if (participant.includes("@lid")) return { ephemeralExpiration: 86400 };
            return { quoted: quotedMsg };
        };

        const sendText = async (jid, text, quotedMsg = null) => {
            try {
                await sock.sendMessage(jid, { text }, getSendOptions(quotedMsg));
            } catch (err) { console.error("[!] Error kirim pesan:", err.message); }
        };

        const sendMessage = async (jid, text, imageUrl = null, quotedMsg = null) => {
            try {
                if (imageUrl) {
                    try {
                        const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 10000 });
                        await sock.sendMessage(jid, { image: Buffer.from(res.data), caption: text }, getSendOptions(quotedMsg));
                    } catch { await sendText(jid, text, quotedMsg); }
                } else { await sendText(jid, text, quotedMsg); }
            } catch (err) { console.error("[!] Error sendMessage:", err.message); }
        };

        const startTime = Date.now();

        const sendInteractiveMenu = async (jid, quotedMsg = null) => {
            const uptime = Date.now() - startTime;
            const uh = Math.floor(uptime / 3600000);
            const um = Math.floor((uptime % 3600000) / 60000);
            const menuTeks =
                "*[NOXARIANET STORE]*\n" +
                "*Digital Assistant Menu*\n" +
                "--------------------\n\n" +
                "*Noxarianet Virtual Assistant*\n" +
                "> Layanan Otomatis Aktif 24/7\n\n" +
                "  - Bot    : noxarianet Bot v5.0\n" +
                "  - Status : Online & Public\n" +
                "  - Uptime : " + uh + "j " + um + "m\n\n" +
                "*[LAYANAN]*\n" +
                "*.order*  -- Cara Order\n" +
                "*.owner*  -- Kontak Owner\n" +
                "*.lapor*  -- Kirim Laporan\n\n" +
                "*[SISTEM]*\n" +
                "*.ping*     -- Status Bot\n" +
                "*.runtime*  -- Uptime\n" +
                "*.cekdb*    -- Statistik DB\n" +
                "*.panel*    -- Status Server\n\n" +
                "--------------------\n" +
                "_Ketik perintah di atas untuk memulai_\n" +
                "*© 2026 www.noxarianet.web.id*";
            try {
                await sock.sendMessage(jid, { text: menuTeks }, getSendOptions(quotedMsg));
            } catch (err) { console.error("[!] Gagal kirim menu:", err.message); }
        };

        const handleMenuAction = async (btnId, remoteJid, senderNum, m = null) => {
            switch (btnId) {
                case "btn_order":
                    await sendText(remoteJid,
                        "*CARA PEMESANAN DI NOXARIANET*\n" +
                        "1. Kunjungi: *www.noxarianet.web.id*\n" +
                        "2. Pilih produk & varian\n" +
                        "3. Isi data pribadi\n" +
                        "4. Selesaikan pembayaran\n" +
                        "5. Terima notifikasi otomatis\n" +
                        "6. Produk dikirim 1-5 menit\n" +
                        "Mudah, cepat, & terpercaya!", m); break;
                case "btn_owner":
                    await sendText(remoteJid,
                        "*OWNER NOXARIANET*\nWhatsApp: https://wa.me/" + ADMIN_NUMBER + "\nHubungi untuk penawaran spesial!", m); break;
                case "btn_ping":
                    await sendText(remoteJid, "*PONG!*\nBot noxarianet aktif & berjalan normal!", m); break;
                case "btn_runtime": {
                    const up = Date.now() - startTime;
                    const h = Math.floor(up / 3600000);
                    const mt = Math.floor((up % 3600000) / 60000);
                    const s = Math.floor((up % 60000) / 1000);
                    await sendText(remoteJid, "*BOT RUNTIME*\nAktif: *" + h + "h " + mt + "m " + s + "s*", m); break;
                }
                case "btn_cekdb":
                    try {
                        if (!supabase) throw new Error("Supabase tidak dikonfigurasi");
                        const { data: orders, error } = await supabase.from("orders").select("*");
                        if (error) throw error;
                        const total = orders?.length || 0;
                        const pending = orders?.filter((o) => o.status === "PENDING").length || 0;
                        const processing = orders?.filter((o) => o.status === "PROCESSING").length || 0;
                        const done = orders?.filter((o) => o.status === "COMPLETED").length || 0;
                        const failed = orders?.filter((o) => o.status === "FAILED").length || 0;
                        const today = orders?.filter((o) => new Date(o.timestamp).toDateString() === new Date().toDateString()).length || 0;
                        await sendText(remoteJid,
                            "*STATISTIK DATABASE*\n" +
                            "Total: *" + total + "*\nPending: *" + pending + "*\nProcessing: *" + processing + "*\n" +
                            "Selesai: *" + done + "*\nGagal: *" + failed + "*\nHari Ini: *" + today + "*", m);
                    } catch (err) { await sendText(remoteJid, "Error DB: " + err.message, m); }
                    break;
                case "btn_panel": {
                    const tot = os.totalmem(), free = os.freemem(), used = tot - free;
                    const pct = ((used / tot) * 100).toFixed(2);
                    const up2 = os.uptime();
                    await sendText(remoteJid,
                        "*STATUS SERVER*\n" +
                        "RAM Total: " + (tot / 1024 / 1024 / 1024).toFixed(2) + " GB\n" +
                        "Terpakai: " + (used / 1024 / 1024 / 1024).toFixed(2) + " GB (" + pct + "%)\n" +
                        "Bebas: " + (free / 1024 / 1024 / 1024).toFixed(2) + " GB\n" +
                        "CPU: " + os.cpus().length + " cores\n" +
                        "Uptime: " + Math.floor(up2 / 3600) + "h " + Math.floor((up2 % 3600) / 60) + "m\n*ONLINE & STABIL*", m); break;
                }
                case "btn_lapor":
                    await sendText(remoteJid,
                        "*KIRIM LAPORAN*\nKetik: *.lapor <pesan Anda>*\nContoh: *.lapor Pesanan saya belum diproses*", m); break;
                default:
                    await sendInteractiveMenu(remoteJid, m);
            }
        };

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log("\n=== SCAN QR CODE WHATSAPP ANDA ===\n");
                qrcode.generate(qr, { small: true });
            }
            if (connection === "close") {
                setOrderNotificationsReady(false, "connection closed");
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMsg = lastDisconnect?.error?.message || 'Unknown error';
                console.log("\n[-] Koneksi terputus!");
                console.log("    Status Code:", statusCode);
                console.log("    Error:", errorMsg);

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log("    [!] Terdeteksi logout, menghapus semua file auth!");
                    cleanSessionFiles(true);
                    console.log("    [!] Silakan restart bot dan scan QR ulang.");
                    return;
                }

                console.log("    [*] Reconnecting in 3 seconds...");
                setTimeout(() => startBot(), 3000);
            } else if (connection === "open") {
                console.log("\n=== BOT NOXARIANET AKTIF v5.0 ===\n");
                
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    console.log("📋 DAFTAR GRUP YANG DIJOIN BOT:");
                    Object.values(groups).forEach((g, i) => {
                        const isTarget = g.id === targetGroupId;
                        const marker = isTarget ? " ✅ TARGET" : "";
                        console.log(`   ${i+1}. ${g.subject} (ID: ${g.id})${marker}`);
                    });
                    console.log(`[+] Target group ID: ${targetGroupId}`);
                } catch (e) { 
                    console.log("[!] Error fetch grup: " + e.message); 
                }
                
                console.log("\n[*] Bot siap menerima pesan!\n");
                setBotActivationTime();
                setOrderNotificationsReady(true, "connection open");
            }
        });

        sock.ev.on("group-participants.update", async (anu) => {
            try {
                if (anu.action === "add") {
                    const meta = await sock.groupMetadata(anu.id);
                    if (anu.id === targetGroupId) {
                        for (let num of anu.participants) {
                            try {
                                await sock.sendMessage(anu.id, {
                                    text: "Halo @" + num.split("@")[0] + "\n\nSelamat datang di *" + meta.subject + "*!\nKetik *.noxa* untuk lihat layanan kami.",
                                    mentions: [num],
                                }, { timeout: 5000 });
                            } catch (e) { console.error("[!] Gagal greeting:", e.message); }
                        }
                    }
                }
            } catch (err) { console.error("[!] Error group-participants:", err.message); }
        });

        sock.ev.on("messages.upsert", async (chatUpdate) => {
            try {
                const m = chatUpdate.messages[0];
                if (!m.message || m.key.fromMe) return;
                const remoteJid = m.key.remoteJid;
                const isGroup = remoteJid.endsWith("@g.us");
                const senderNum = isGroup ? m.key.participant : remoteJid;
                let msgData = m.message;
                if (msgData?.ephemeralMessage) msgData = msgData.ephemeralMessage.message;
                if (msgData?.viewOnceMessageV2) msgData = msgData.viewOnceMessageV2.message;

                const nativeFlow = msgData?.interactiveResponseMessage?.nativeFlowResponseMessage;
                if (nativeFlow) {
                    const params = JSON.parse(nativeFlow.paramsJson || "{}");
                    await handleMenuAction(params.id, remoteJid, senderNum, m); return;
                }
                const listRowId = msgData?.listResponseMessage?.singleSelectReply?.selectedRowId;
                if (listRowId) { await handleMenuAction(listRowId, remoteJid, senderNum, m); return; }

                const messageContent = msgData?.conversation || msgData?.extendedTextMessage?.text || msgData?.imageMessage?.caption || msgData?.videoMessage?.caption || "";
                if (!messageContent) return;
                const msg = messageContent.toLowerCase().trim();
                console.log("[<] " + (isGroup ? "[GRUP]" : "[JAPRI]") + " " + senderNum);

                if (msg.includes("@noxarianet")) { await sendInteractiveMenu(remoteJid, m); return; }
                if (!msg.startsWith(".")) return;
                const command = msg.slice(1).trim().split(" ")[0];

                switch (command) {
                    case "noxa": await sendInteractiveMenu(remoteJid, m); break;
                    case "ping": await sendText(remoteJid, "*PONG!* Bot aktif!", m); break;
                    case "owner": await handleMenuAction("btn_owner", remoteJid, senderNum, m); break;
                    case "order": await handleMenuAction("btn_order", remoteJid, senderNum, m); break;
                    case "runtime": await handleMenuAction("btn_runtime", remoteJid, senderNum, m); break;
                    case "cekdb": await handleMenuAction("btn_cekdb", remoteJid, senderNum, m); break;
                    case "panel": await handleMenuAction("btn_panel", remoteJid, senderNum, m); break;
                    case "lapor": await handleMenuAction("btn_lapor", remoteJid, senderNum, m); break;
                    default: break;
                }
            } catch (err) { console.error("[!] Error handler:", err.message); }
        });

        // SUPABASE REALTIME
        if (!supabaseSubscribed && supabase) {
            supabaseSubscribed = true;
            console.log("[*] Subscribing Supabase Realtime...");

            supabase
                .channel("public:orders:insert")
                .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, async (payload) => {
                    const s = currentSock;
                    if (!isOrderNotificationReady()) {
                        console.log("[DEBUG] Skipping INSERT notification because bot is not fully active yet");
                        return;
                    }
                    const orderPayload = payload.new;
                    console.log("\n[+] ORDER BARU (INSERT): " + orderPayload.id);

                    const { data: order, error: fetchErr } = await supabase
                        .from("orders")
                        .select("*")
                        .eq("id", orderPayload.id)
                        .single();

                    if (fetchErr || !order) {
                        console.error("[!] Gagal mengambil detail lengkap order untuk INSERT:", fetchErr?.message);
                        return;
                    }

                    if (!isOrderEligibleForCurrentRun(order)) {
                        console.log("[DEBUG] Skipping INSERT notification for old order:", order.id);
                        return;
                    }
                    console.log("[DEBUG] Order baru diterima via realtime:", order.id, "- notifikasi grup akan dihandle oleh polling");
                })
                .subscribe((status) => console.log("[*] Realtime [INSERT]: " + status));

            supabase
                .channel("public:orders:update")
                .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, async (payload) => {
                    const s = currentSock;
                    if (!isOrderNotificationReady()) {
                        console.log("[DEBUG] Skipping UPDATE notification because bot is not fully active yet");
                        return;
                    }

                    const orderPayload = payload.new;
                    const newStatus = orderPayload.status;
                    const notifKey = orderPayload.id + ":" + newStatus;
                    if (notifiedOrderIds.has(notifKey)) return;

                    const { data: order, error: fetchErr } = await supabase
                        .from("orders")
                        .select("*")
                        .eq("id", orderPayload.id)
                        .single();

                    if (fetchErr || !order) {
                        console.error("[!] Gagal mengambil detail lengkap order untuk UPDATE:", fetchErr?.message);
                        return;
                    }

                    if (!isOrderEligibleForUpdate(order)) {
                        console.log("[DEBUG] Skipping UPDATE notification for very old order (created > 24h ago):", order.id);
                        return;
                    }

                    notifiedOrderIds.add(notifKey);
                    console.log("\n[~] ORDER UPDATE [Realtime]: " + order.id + " -> " + newStatus);

                    console.log("[DEBUG] wa_number from order:", order.wa_number);
                    const waJid = await resolveRealJid(order.wa_number);
                    console.log("[DEBUG] Resolved waJid:", waJid);
                    try {
                        let dmFailed = null;
                        if (newStatus === "PROCESSING") {
                            if (waJid) {
                                try {
                                    console.log("[DEBUG] Sending PROCESSING message to user...");
                                    await sendViaCurrent(waJid,
                                        "*PEMBAYARAN BERHASIL - SEDANG DIPROSES!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "Halo Kak!\n\nPembayaran order *" + order.id + "* sudah kami terima!\n" +
                                        "Produk: *" + order.product + "*\nVarian: " + (order.variant || "-") + "\n\n" +
                                        "Akun sedang disiapkan secara otomatis...\nEstimasi: *1-5 menit*\n\n" +
                                        "Kami akan langsung kirim detail akun ke sini ya Kak!"
                                    );
                                } catch (e) {
                                    console.error(`[!] Gagal DM PROCESSING ke user:`, e.message);
                                    dmFailed = e;
                                }
                            } else {
                                console.log("[DEBUG] waJid is null, skipping PROCESSING message to user");
                            }
                            if (dmFailed) throw dmFailed;
                            return;
                        }
                        if (newStatus === "COMPLETED") {
                            const details = order.account_details || {};
                            const rawItems = details.raw_items || [];
                            const isH2H = rawItems.some(item => item.order_process === "h2h" || item.order_process === "smm");
                            const fulfillmentText = formatFulfillmentDetails(order);
                            const labelDetail = isH2H ? "*DETAIL TRANSAKSI:*" : "*DETAIL AKUN ANDA:*";
                            const footerMsg = isH2H
                                ? "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                "Terima kasih sudah berbelanja di *noxarianet store*!\n" +
                                "Tinggalkan ulasan positif ya Kak!"
                                : "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                "_Jangan share akun ini ke orang lain!_\n" +
                                "Terima kasih sudah berbelanja di *noxarianet store*!\n" +
                                "Tinggalkan ulasan positif ya Kak!";

                            if (waJid) {
                                try {
                                    console.log("[DEBUG] Sending COMPLETED message to user...");
                                    await sendViaCurrent(waJid,
                                        "*PESANAN SELESAI!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "Order: *" + order.id + "*\nProduk: *" + order.product + "*\n" +
                                        "Varian: " + (order.variant || "-") + "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        labelDetail + "\n\n" + fulfillmentText + "\n\n" +
                                        footerMsg
                                    );
                                } catch (e) {
                                    console.error(`[!] Gagal DM COMPLETED ke user:`, e.message);
                                    dmFailed = e;
                                }
                            } else {
                                console.log("[DEBUG] waJid is null, skipping COMPLETED message to user");
                            }

                            try {
                                const gid = await resolveGroupId(s);
                                console.log("[DEBUG] Sending COMPLETED message to group:", gid);
                                await sendViaCurrent(gid, "ORDER COMPLETED: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number));
                            } catch (e) { console.error("[!] Error notif grup COMPLETED:", e.message); }

                            if (dmFailed) throw dmFailed;
                            return;
                        }
                        if (newStatus === "FAILED") {
                            try {
                                const gid = await resolveGroupId(s);
                                console.log("[DEBUG] Sending FAILED message to group:", gid);
                                await sendViaCurrent(gid,
                                    "*ORDER GAGAL!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    "ID: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number) + "\n" +
                                    "Error: _" + (order.error_message || "Unknown") + "_\n*Perlu pengecekan manual!*"
                                );
                            } catch (e) { console.error("[!] Error notif grup FAILED:", e.message); }

                            if (waJid) {
                                try {
                                    console.log("[DEBUG] Sending FAILED message to user...");
                                    let failedText = "*MAAF, PESANAN GAGAL DIPROSES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "Halo Kak, ada kendala pada pesanan *" + order.id + "*.\n\n" +
                                        "Tim kami segera menangani masalah ini.\n" +
                                        "Hubungi admin: https://wa.me/" + ADMIN_NUMBER + "\n" +
                                        "Mohon maaf atas ketidaknyamanannya";
                                    if (order.error_message?.toLowerCase().includes("nomor tujuan salah") || order.error_message?.toLowerCase().includes("refund")) {
                                        failedText = "*MAAF, PESANAN GAGAL (REFUND)*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                            "Halo Kak, pesanan Anda dengan ID *" + order.id + "* gagal karena *nomor tujuan salah atau tidak valid*.\n\n" +
                                            "Saldo telah dikembalikan (refund) ke sistem kami. Silakan hubungi admin di WhatsApp untuk mengoreksi nomor tujuan agar pesanan bisa diproses ulang, atau untuk mengajukan pengembalian dana.\n\n" +
                                            "Hubungi admin: https://wa.me/" + ADMIN_NUMBER + "\n" +
                                            "Mohon maaf atas ketidaknyamanannya.";
                                    }
                                    await sendViaCurrent(waJid, failedText);
                                } catch (e) {
                                    console.error(`[!] Gagal DM FAILED ke user:`, e.message);
                                    dmFailed = e;
                                }
                            } else {
                                console.log("[DEBUG] waJid is null, skipping FAILED message to user");
                            }

                            if (dmFailed) throw dmFailed;
                        }
                    } catch (err) {
                        notifiedOrderIds.delete(notifKey);
                        console.error("[!] [Realtime] Gagal notif " + order.id + ", akan retry via polling:", err.message);
                    }
                })
                .subscribe((status) => console.log("[*] Realtime [UPDATE]: " + status));
        }

        // POLLING FALLBACK
        if (!pollingStarted) {
            pollingStarted = true;

            setInterval(async () => {
                if (!supabase || !currentSock) return;
                if (!isOrderNotificationReady()) return;
                if (!botActivationTime) return;

                try {
                    const { data: orders, error } = await supabase
                        .from("orders").select("*")
                        .in("status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"])
                        .gt("timestamp", botActivationTime)
                        .order("timestamp", { ascending: true });

                    if (error || !orders || orders.length === 0) return;

                    for (const order of orders) {
                        const notifKey = order.id + ":" + order.status;
                        if (notifiedOrderIds.has(notifKey)) continue;
                        if (!isOrderNotificationReady()) {
                            console.log("[!] [POLLING] Bot belum aktif penuh, berhenti.");
                            break;
                        }

                        notifiedOrderIds.add(notifKey);
                        console.log("\n[+] [POLLING] " + order.id + " - " + order.status);

                        if (!isOrderEligibleForCurrentRun(order)) {
                            notifiedOrderIds.delete(notifKey);
                            console.log("[DEBUG] [POLLING] Skipping old order:", order.id);
                            continue;
                        }

                        console.log("[DEBUG] [POLLING] wa_number from order:", order.wa_number);
                        const waJid = await resolveRealJid(order.wa_number);
                        console.log("[DEBUG] [POLLING] Resolved waJid:", waJid);

                        try {
                            if (order.status === "PENDING") {
                                try {
                                    const gid = await resolveGroupId(currentSock);
                                    console.log("[DEBUG] [POLLING] Sending PENDING message to group:", gid);
                                    const notif =
                                        "*ORDER BARU MASUK!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "ID: *" + order.id + "*\nProduk: *" + order.product + "*\n" +
                                        "Varian: " + (order.variant || "-") + "\n" +
                                        "Harga: *Rp " + Number(order.price || 0).toLocaleString("id-ID") + "*\n" +
                                        "Metode: " + (order.payment_method || "-") + "\n" +
                                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "WA: *" + maskPhone(order.wa_number) + "*\nEmail: " + (order.email ? maskEmail(order.email) : "-") + "\n" +
                                        new Date(order.timestamp || Date.now()).toLocaleString("id-ID") + "\n" +
                                        "_Menunggu pembayaran..._";
                                    await sendViaCurrent(gid, notif);
                                } catch (e) { console.error("[!] Error notif grup PENDING polling:", e.message); }
                            }
                            let dmFailed = null;
                            if (order.status === "PROCESSING") {
                                if (waJid) {
                                    try {
                                        console.log("[DEBUG] [POLLING] Sending PROCESSING message to user...");
                                        await sendViaCurrent(waJid,
                                            "*PEMBAYARAN BERHASIL - SEDANG DIPROSES!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                            "Halo Kak!\n\nPembayaran order *" + order.id + "* sudah kami terima!\n" +
                                            "Produk: *" + order.product + "*\nVarian: " + (order.variant || "-") + "\n\n" +
                                            "Akun sedang disiapkan secara otomatis...\nEstimasi: *1-5 menit*\n\n" +
                                            "Kami akan langsung kirim detail akun ke sini ya Kak!"
                                        );
                                    } catch (e) {
                                        console.error(`[!] [POLLING] Gagal DM PROCESSING ke user:`, e.message);
                                        dmFailed = e;
                                    }
                                } else {
                                    console.log("[DEBUG] [POLLING] waJid is null, skipping PROCESSING message");
                                }
                                if (dmFailed) throw dmFailed;
                            } else if (order.status === "COMPLETED") {
                                const details = order.account_details || {};
                                const rawItems = details.raw_items || [];
                                const isH2H = rawItems.some(item => item.order_process === "h2h" || item.order_process === "smm");
                                const fulfillmentText = formatFulfillmentDetails(order);
                                const labelDetail = isH2H ? "*DETAIL TRANSAKSI:*" : "*DETAIL AKUN ANDA:*";
                                const footerMsg = isH2H
                                    ? "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    "Terima kasih sudah berbelanja di *noxarianet store*!"
                                    : "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    "_Jangan share akun ini ke orang lain!_\n" +
                                    "Terima kasih sudah berbelanja di *noxarianet store*!";

                                if (waJid) {
                                    try {
                                        console.log("[DEBUG] [POLLING] Sending COMPLETED message to user...");
                                        await sendViaCurrent(waJid,
                                            "*PESANAN SELESAI!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                            "Order: *" + order.id + "*\nProduk: *" + order.product + "*\n" +
                                            "Varian: " + (order.variant || "-") + "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                            labelDetail + "\n\n" + fulfillmentText + "\n\n" +
                                            footerMsg
                                        );
                                    } catch (e) {
                                        console.error(`[!] [POLLING] Gagal DM COMPLETED ke user:`, e.message);
                                        dmFailed = e;
                                    }
                                } else {
                                    console.log("[DEBUG] [POLLING] waJid is null, skipping COMPLETED message");
                                }
                                try {
                                    const gid = await resolveGroupId(currentSock);
                                    console.log("[DEBUG] [POLLING] Sending COMPLETED message to group:", gid);
                                    await sendViaCurrent(gid, "ORDER COMPLETED: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number));
                                } catch (e) { console.error("[!] Error notif grup COMPLETED polling:", e.message); }
                                if (dmFailed) throw dmFailed;
                            } else if (order.status === "FAILED") {
                                try {
                                    const gid = await resolveGroupId(currentSock);
                                    console.log("[DEBUG] [POLLING] Sending FAILED message to group:", gid);
                                    await sendViaCurrent(gid,
                                        "*ORDER GAGAL!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "ID: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number) + "\n" +
                                        "Error: _" + (order.error_message || "Unknown") + "_\n*Perlu pengecekan manual!*"
                                    );
                                } catch (e) { console.error("[!] Error notif grup FAILED polling:", e.message); }
                                if (waJid) {
                                    try {
                                        console.log("[DEBUG] [POLLING] Sending FAILED message to user...");
                                        let failedText = "*MAAF, PESANAN GAGAL DIPROSES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                            "Halo Kak, ada kendala pada pesanan *" + order.id + "*.\n\n" +
                                            "Tim kami segera menangani masalah ini.\n" +
                                            "Hubungi admin: https://wa.me/" + ADMIN_NUMBER + "\n" +
                                            "Mohon maaf atas ketidaknyamanannya";
                                        if (order.error_message?.toLowerCase().includes("nomor tujuan salah") || order.error_message?.toLowerCase().includes("refund")) {
                                            failedText = "*MAAF, PESANAN GAGAL (REFUND)*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                                "Halo Kak, pesanan Anda dengan ID *" + order.id + "* gagal karena *nomor tujuan salah atau tidak valid*.\n\n" +
                                                "Saldo telah dikembalikan (refund) ke sistem kami. Silakan hubungi admin di WhatsApp untuk mengoreksi nomor tujuan agar pesanan bisa diproses ulang, atau untuk mengajukan pengembalian dana.\n\n" +
                                                "Hubungi admin: https://wa.me/" + ADMIN_NUMBER + "\n" +
                                                "Mohon maaf atas ketidaknyamanannya.";
                                        }
                                        await sendViaCurrent(waJid, failedText);
                                    } catch (e) {
                                        console.error(`[!] [POLLING] Gagal DM FAILED ke user:`, e.message);
                                        dmFailed = e;
                                    }
                                } else {
                                    console.log("[DEBUG] [POLLING] waJid is null, skipping FAILED message to user");
                                }
                                if (dmFailed) throw dmFailed;
                            }
                        } catch (sendErr) {
                            notifiedOrderIds.delete(notifKey);
                            console.error("[!] [POLLING] Gagal kirim notif " + order.id + ", akan retry:", sendErr.message);
                        }
                    }
                } catch (err) {
                    console.error("[!] [POLLING] Error in polling loop:", err.message);
                }
            }, 10000);
        }

    } catch (err) {
        console.error("\n[!] ERROR FATAL:", err.message);
        setTimeout(() => startBot(), 5000);
    }
}

if (require.main === module) {
    console.log("\n=== NOXARIANET BOT v5.0 (AUTO PAYMENT) ===\n");
    startBot();
}

module.exports = {
    __test: {
        setBotActivationTime,
        getOrderTimestamp,
        isOrderEligibleForCurrentRun,
    },
};