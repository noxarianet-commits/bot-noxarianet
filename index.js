/**
 * noxarianet store - WhatsApp Bot v5.0 (AUTO PAYMENT FLOW)
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const { createClient } = require("@supabase/supabase-js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const pino = require("pino");
const WebSocket = require("ws");
const os = require("os");
const fs = require("fs");
require("dotenv").config();

process.on("unhandledRejection", (reason) => {
    console.error("[!] Unhandled Rejection:", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
    console.error("[!] Uncaught Exception:", err.message);
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

const GROUP_NAME_KEYWORD = "noxarianet";
const ADMIN_NUMBER = "6285936603517";

let supabaseSubscribed = false;
let pollingStarted = false;
let currentSock = null;
let cachedGroupId = null;
const targetGroupId = "120363424077781671@g.us";
const notifiedOrderIds = new Set();

function formatWaJid(waNumber) {
    let num = (waNumber || "").toString().replace(/\D/g, "");
    if (!num) return null;
    if (num.startsWith("0")) num = "62" + num.slice(1);
    else if (!num.startsWith("62")) num = "62" + num;
    return num + "@s.whatsapp.net";
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

async function resolveGroupId(sock) {
    if (cachedGroupId) return cachedGroupId;
    try {
        const groups = await sock.groupFetchAllParticipating();
        const tg = Object.values(groups).find((g) =>
            g.subject.toLowerCase().includes(GROUP_NAME_KEYWORD)
        );
        if (tg) { cachedGroupId = tg.id; return cachedGroupId; }
    } catch (e) { console.error("[!] resolveGroupId error:", e.message); }
    return targetGroupId;
}

async function sendViaCurrent(jid, text) {
    if (!currentSock?.user) throw new Error("Connection not ready");
    await currentSock.sendMessage(jid, { text });
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
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
                "*© 2026 noxarianet.web.id*";
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
                console.clear();
                console.log("\n=== SCAN QR CODE WHATSAPP ANDA ===\n");
                qrcode.generate(qr, { small: true });
            }
            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log("[-] Koneksi terputus (" + statusCode + "). Reconnect: " + shouldReconnect);
                if (shouldReconnect) {
                    cachedGroupId = null;
                    setTimeout(() => startBot(), 3000);
                } else {
                    try { if (fs.existsSync("auth_info_baileys")) fs.rmSync("auth_info_baileys", { recursive: true, force: true }); } catch (e) {}
                    setTimeout(() => startBot(), 3000);
                }
            } else if (connection === "open") {
                console.clear();
                console.log("\n=== BOT NOXARIANET AKTIF v5.0 ===\n");
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    Object.values(groups).forEach((g, i) => {
                        console.log("   " + (i + 1) + ". " + g.subject + " (ID: " + g.id + ")");
                        if (g.subject.toLowerCase().includes(GROUP_NAME_KEYWORD)) {
                            cachedGroupId = g.id;
                            console.log("   [+] Grup target di-cache: " + g.id);
                        }
                    });
                } catch (e) { console.log("[!] Error fetch grup: " + e.message); }
                console.log("\n[*] Bot siap menerima pesan!\n");
            }
        });

        sock.ev.on("group-participants.update", async (anu) => {
            try {
                if (anu.action === "add") {
                    const meta = await sock.groupMetadata(anu.id);
                    if (meta.subject.toLowerCase().includes(GROUP_NAME_KEYWORD) || anu.id === targetGroupId) {
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
                    if (!s?.user) return;
                    const order = payload.new;
                    console.log("\n[+] ORDER BARU (INSERT): " + order.id);
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
                    try {
                        const groupId = await resolveGroupId(s);
                        await sendViaCurrent(groupId, notif);
                    } catch (err) { console.error("[!] Error notif INSERT:", err.message); }
                })
                .subscribe((status) => console.log("[*] Realtime [INSERT]: " + status));

            supabase
                .channel("public:orders:update")
                .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, async (payload) => {
                    const s = currentSock;
                    if (!s?.user) return;
                    const order = payload.new;
                    const newStatus = order.status;
                    const notifKey = order.id + ":" + newStatus;
                    if (notifiedOrderIds.has(notifKey)) return;
                    notifiedOrderIds.add(notifKey);
                    console.log("\n[~] ORDER UPDATE [Realtime]: " + order.id + " -> " + newStatus);
                    const waJid = formatWaJid(order.wa_number);
                    try {
                        if (newStatus === "PROCESSING") {
                            if (waJid) await sendViaCurrent(waJid,
                                "*PEMBAYARAN BERHASIL - SEDANG DIPROSES!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                "Halo Kak!\n\nPembayaran order *" + order.id + "* sudah kami terima!\n" +
                                "Produk: *" + order.product + "*\nVarian: " + (order.variant || "-") + "\n\n" +
                                "Akun sedang disiapkan secara otomatis...\nEstimasi: *1-5 menit*\n\n" +
                                "Kami akan langsung kirim detail akun ke sini ya Kak!");
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

                            if (waJid) await sendViaCurrent(waJid,
                                "*PESANAN SELESAI!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                "Order: *" + order.id + "*\nProduk: *" + order.product + "*\n" +
                                "Varian: " + (order.variant || "-") + "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                labelDetail + "\n\n" + fulfillmentText + "\n\n" +
                                footerMsg);
                            try {
                                const gid = await resolveGroupId(s);
                                await sendViaCurrent(gid, "ORDER COMPLETED: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number));
                            } catch (e) { console.error("[!] Error notif grup COMPLETED:", e.message); }
                            return;
                        }
                        if (newStatus === "FAILED") {
                            try {
                                const gid = await resolveGroupId(s);
                                await sendViaCurrent(gid,
                                    "*ORDER GAGAL!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    "ID: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number) + "\n" +
                                    "Error: _" + (order.error_message || "Unknown") + "_\n*Perlu pengecekan manual!*");
                            } catch (e) { console.error("[!] Error notif grup FAILED:", e.message); }
                            if (waJid) {
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
                            }
                        }
                    } catch (err) {
                        notifiedOrderIds.delete(notifKey);
                        console.error("[!] [Realtime] Gagal notif " + order.id + ", akan retry via polling:", err.message);
                    }
                })
                .subscribe((status) => console.log("[*] Realtime [UPDATE]: " + status));
        }

        // POLLING FALLBACK
        // FIX 1: pollingStarted guard - SATU interval meski startBot() dipanggil ulang saat reconnect
        // FIX 2: currentSock.user check - cegah "Connection Closed" saat koneksi belum siap
        // FIX 3: sendViaCurrent - pakai currentSock langsung (bukan closure sock lama yang sudah mati)
        // FIX 4: notifiedOrderIds.delete on error - agar gagal send bisa di-retry
        if (!pollingStarted) {
            pollingStarted = true;
            const POLL_WINDOW_MS = 60 * 60 * 1000;

            setInterval(async () => {
                if (!supabase || !currentSock) return;
                if (!currentSock.user) return;

                try {
                    const since = new Date(Date.now() - POLL_WINDOW_MS).toISOString();
                    const { data: orders, error } = await supabase
                        .from("orders").select("*")
                        .in("status", ["PROCESSING", "COMPLETED", "FAILED"])
                        .gt("timestamp", since)
                        .order("timestamp", { ascending: true });

                    if (error || !orders || orders.length === 0) return;

                    for (const order of orders) {
                        const notifKey = order.id + ":" + order.status;
                        if (notifiedOrderIds.has(notifKey)) continue;
                        if (!currentSock?.user) { console.log("[!] [POLLING] Koneksi terputus, berhenti."); break; }

                        notifiedOrderIds.add(notifKey);
                        console.log("\n[+] [POLLING] " + order.id + " - " + order.status);
                        const waJid = formatWaJid(order.wa_number);

                        try {
                            if (order.status === "PROCESSING") {
                                if (waJid) await sendViaCurrent(waJid,
                                    "*PEMBAYARAN BERHASIL - SEDANG DIPROSES!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    "Halo Kak!\n\nPembayaran order *" + order.id + "* sudah kami terima!\n" +
                                    "Produk: *" + order.product + "*\nVarian: " + (order.variant || "-") + "\n\n" +
                                    "Akun sedang disiapkan secara otomatis...\nEstimasi: *1-5 menit*\n\n" +
                                    "Kami akan langsung kirim detail akun ke sini ya Kak!");
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

                                if (waJid) await sendViaCurrent(waJid,
                                    "*PESANAN SELESAI!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    "Order: *" + order.id + "*\nProduk: *" + order.product + "*\n" +
                                    "Varian: " + (order.variant || "-") + "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                    labelDetail + "\n\n" + fulfillmentText + "\n\n" +
                                    footerMsg);
                                try {
                                    const gid = await resolveGroupId(currentSock);
                                    await sendViaCurrent(gid, "ORDER COMPLETED: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number));
                                } catch (e) { console.error("[!] Error notif grup COMPLETED polling:", e.message); }
                            } else if (order.status === "FAILED") {
                                try {
                                    const gid = await resolveGroupId(currentSock);
                                    await sendViaCurrent(gid,
                                        "*ORDER GAGAL!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                                        "ID: *" + order.id + "*\n" + order.product + "\nWA: " + maskPhone(order.wa_number) + "\n" +
                                        "Error: _" + (order.error_message || "Unknown") + "_\n*Perlu pengecekan manual!*");
                                } catch (e) { console.error("[!] Error notif grup FAILED polling:", e.message); }
                                if (waJid) {
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
                                }
                            }
                        } catch (sendErr) {
                            notifiedOrderIds.delete(notifKey);
                            console.error("[!] [POLLING] Gagal kirim notif " + order.id + ", akan retry:", sendErr.message);
                        }
                    }
                } catch (err) { /* silent */ }
            }, 10000);
        }

    } catch (err) {
        console.error("\n[!] ERROR FATAL:", err.message);
        setTimeout(() => startBot(), 5000);
    }
}

console.log("\n=== NOXARIANET BOT v5.0 (AUTO PAYMENT) ===\n");
startBot();
