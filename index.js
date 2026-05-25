/**
 * noxarianet store — WhatsApp Bot v4.0 (NATIVE FLOW BUTTONS)
 * Tombol nyata terlihat di semua akun WA (personal & business)
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    proto,
    generateWAMessageFromContent
} = require("@whiskeysockets/baileys");
const { createClient } = require('@supabase/supabase-js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
require('dotenv').config();

// ═══ ANTI-CRASH: Tangkap semua unhandled rejection agar bot tidak exit ═══
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection (ditangkap):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception (ditangkap):', err.message);
});

// ═══ SUPABASE ═══
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        realtime: { transport: WebSocket }
    });
    console.log('✅ Supabase configured');
} else {
    console.warn('⚠️ SUPABASE belum dikonfigurasi di .env');
}

const GROUP_NAME_KEYWORD = 'noxarianet';
const ADMIN_NUMBER = '6285936603517';

let supabaseSubscribed = false;
let currentSock = null;
let cachedGroupId = null;
let targetGroupId = '120363424077781671@g.us';

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            browser: ["noxarianet Bot", "Safari", "3.0"],
            syncFullHistory: false,
        });
        currentSock = sock;

        sock.ev.on('creds.update', saveCreds);

        const getSendOptions = (quotedMsg) => {
            let options = {};
            if (quotedMsg) {
                // Cegah quote jika dari @lid karena memicu error 406 (not-acceptable)
                const participant = quotedMsg.key.participant || quotedMsg.key.remoteJid || '';
                if (participant.includes('@lid')) {
                    options.ephemeralExpiration = 86400; // Manual ephemeral untuk grup disappearing
                } else {
                    options.quoted = quotedMsg;
                }
            }
            return options;
        };

        // ═══ HELPER: KIRIM TEKS BIASA ═══
        const sendText = async (jid, text, quotedMsg = null) => {
            try {
                await sock.sendMessage(jid, { text }, getSendOptions(quotedMsg));
                console.log(`✅ Pesan terkirim ke ${jid}`);
            } catch (err) {
                console.error('❌ Error kirim pesan:', err.message);
            }
        };

        // ═══ HELPER: KIRIM GAMBAR ═══
        const sendMessage = async (jid, text, imageUrl = null, quotedMsg = null) => {
            try {
                if (imageUrl) {
                    try {
                        const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
                        await sock.sendMessage(jid, { image: Buffer.from(res.data), caption: text }, getSendOptions(quotedMsg));
                    } catch {
                        await sendText(jid, text, quotedMsg);
                    }
                } else {
                    await sendText(jid, text, quotedMsg);
                }
            } catch (err) {
                console.error('❌ Error sendMessage:', err.message);
            }
        };

        const startTime = Date.now();

        // ═══ HELPER: KIRIM MENU PREMIUM (VERSION 4.6 - GROUP STABLE) ═══
        const sendInteractiveMenu = async (jid, quotedMsg = null) => {
            const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
            const uptime = Date.now() - startTime;
            const uh = Math.floor(uptime / 3600000);
            const um = Math.floor((uptime % 3600000) / 60000);

            const menuTeks = 
                `*───「 NOXARIANET STORE 」───*\n` +
                `*Digital Assistant Menu*\n` +
                `────────────────────\n\n` +
                `*Noxarianet Virtual Assistant* 💜\n` +
                `> Layanan Otomatis Aktif 24/7\n\n` +
                `  • Bot    : noxarianet Bot v4.6\n` +
                `  • Status : 🟢 Online & Public\n` +
                `  • Uptime : ${uh}j ${um}m\n\n` +
                `*───「 LAYANAN 」───*\n` +
                `🛒 *.order*  — Cara Order\n` +
                `👤 *.owner*  — Kontak Owner\n` +
                `📢 *.lapor*  — Kirim Laporan\n\n` +
                `*───「 SISTEM 」───*\n` +
                `🏓 *.ping*     — Status Bot\n` +
                `⏳ *.runtime*  — Uptime\n` +
                `📦 *.cekdb*    — Statistik DB\n` +
                `🖥️ *.panel*    — Status Server\n\n` +
                `────────────────────\n` +
                `_Ketik perintah di atas untuk memulai_\n` +
                `*© 2026 noxarianet.web.id*`;

            try {
                await sock.sendMessage(jid, { text: menuTeks }, getSendOptions(quotedMsg));
                console.log(`✅ Stable menu v4.6 terkirim ke ${jid}`);
            } catch (err) {
                console.error('⚠️ Gagal kirim menu:', err.message);
            }
        };

        // ═══ EKSEKUSI PILIHAN MENU ═══
        const handleMenuAction = async (btnId, remoteJid, senderNum, m = null) => {
            switch (btnId) {
                case 'btn_order':
                    await sendText(remoteJid,
                        "🛒 *CARA PEMESANAN DI NOXARIANET*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                        "1️⃣ Kunjungi: *www.noxarianet.web.id*\n" +
                        "2️⃣ Pilih produk & varian\n" +
                        "3️⃣ Isi data pribadi dengan benar\n" +
                        "4️⃣ Selesaikan pembayaran\n" +
                        "5️⃣ Terima notifikasi otomatis\n" +
                        "6️⃣ Produk dikirim 1–5 menit\n" +
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ Mudah, cepat, & terpercaya!", m
                    );
                    break;
                case 'btn_owner':
                    await sendText(remoteJid,
                        "👤 *OWNER NOXARIANET*\n━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                        `📱 WhatsApp: https://wa.me/${ADMIN_NUMBER}\n` +
                        "💼 Hubungi untuk penawaran spesial!\n" +
                        "━━━━━━━━━━━━━━━━━━━━━━━━", m
                    );
                    break;
                case 'btn_ping':
                    await sendText(remoteJid, "🏓 *PONG!*\n✅ Bot noxarianet aktif & berjalan normal!", m);
                    break;
                case 'btn_runtime': {
                    const up = Date.now() - startTime;
                    const h = Math.floor(up / 3600000);
                    const mTime = Math.floor((up % 3600000) / 60000);
                    const s = Math.floor((up % 60000) / 1000);
                    await sendText(remoteJid,
                        `⏳ *BOT RUNTIME*\n━━━━━━━━━━━━━━━━━━━━━━━━\n🟢 Aktif: *${h}h ${mTime}m ${s}s*\n━━━━━━━━━━━━━━━━━━━━━━━━`, m
                    );
                    break;
                }
                case 'btn_cekdb':
                    try {
                        if (!supabase) throw new Error('Supabase tidak dikonfigurasi');
                        const { data: orders, error } = await supabase.from('orders').select('*');
                        if (error) throw error;
                        const total = orders?.length || 0;
                        const pending = orders?.filter(o => o.status === 'pending').length || 0;
                        const done = orders?.filter(o => o.status === 'completed').length || 0;
                        const today = orders?.filter(o => new Date(o.timestamp).toDateString() === new Date().toDateString()).length || 0;
                        await sendText(remoteJid,
                            `📦 *STATISTIK DATABASE*\n━━━━━━━━━━━━━━━━━━━━━━━━\n📊 Total: *${total}*\n⏳ Pending: *${pending}*\n✅ Selesai: *${done}*\n📅 Hari Ini: *${today}*\n━━━━━━━━━━━━━━━━━━━━━━━━`, m
                        );
                    } catch (err) {
                        await sendText(remoteJid, `❌ Error DB: ${err.message}`, m);
                    }
                    break;
                case 'btn_panel': {
                    const tot = os.totalmem(), free = os.freemem(), used = tot - free;
                    const pct = ((used / tot) * 100).toFixed(2);
                    const up2 = os.uptime();
                    await sendText(remoteJid,
                        `🖥️ *STATUS SERVER*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `💾 RAM Total: ${(tot/1024/1024/1024).toFixed(2)} GB\n` +
                        `📈 Terpakai: ${(used/1024/1024/1024).toFixed(2)} GB (${pct}%)\n` +
                        `🆓 Bebas: ${(free/1024/1024/1024).toFixed(2)} GB\n` +
                        `🔧 CPU Cores: ${os.cpus().length}\n` +
                        `⏱️ Uptime: ${Math.floor(up2/3600)}h ${Math.floor((up2%3600)/60)}m\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🟢 *ONLINE & STABIL*`, m
                    );
                    break;
                }
                case 'btn_lapor':
                    await sendText(remoteJid,
                        "📢 *KIRIM LAPORAN*\n━━━━━━━━━━━━━━━━━━━━━━━━\nKetik:\n\n*.lapor <pesan Anda>*\n\nContoh:\n*.lapor Pesanan saya belum diproses*\n━━━━━━━━━━━━━━━━━━━━━━━━", m
                    );
                    break;
                default:
                    await sendInteractiveMenu(remoteJid, m);
            }
        };

        // ═══ KONEKSI ═══
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.clear();
                console.log('\n╔════════════════════════════════╗');
                console.log('║  🔐 SCAN QR CODE WHATSAPP ANDA ║');
                console.log('╚════════════════════════════════╝\n');
                qrcode.generate(qr, { small: true });
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`❌ Koneksi terputus (Status: ${statusCode}). Reconnect: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    cachedGroupId = null;
                    setTimeout(() => startBot(), 3000);
                } else {
                    console.log('⚠️ Sesi logout / invalid. Menghapus folder auth dan restart untuk QR baru...');
                    try {
                        if (fs.existsSync('auth_info_baileys')) {
                            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                        }
                    } catch (e) {
                        console.error('⚠️ Gagal menghapus folder sesi:', e.message);
                    }
                    setTimeout(() => startBot(), 3000);
                }
            } else if (connection === 'open') {
                console.clear();
                console.log('\n╔════════════════════════════════╗');
                console.log('║  ✅ BOT NOXARIANET AKTIF v4.0  ║');
                console.log('╚════════════════════════════════╝\n');
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    Object.values(groups).forEach((g, i) => {
                        console.log(`   ${i + 1}. ${g.subject} (ID: ${g.id})`);
                        if (g.subject.toLowerCase().includes(GROUP_NAME_KEYWORD)) {
                            cachedGroupId = g.id;
                            console.log(`   ✅ Grup target otomatis di-cache: ${g.id}`);
                        }
                    });
                } catch (e) { console.log('⚠️ Error fetch grup: ' + e.message); }
                console.log('\n🎯 Bot siap menerima pesan!\n');
            }
        });

        // ═══ MEMBER BARU (PREMIUM GREETING) ═══
        sock.ev.on('group-participants.update', async (anu) => {
            try {
                if (anu.action === 'add') {
                    const meta = await sock.groupMetadata(anu.id);
                    if (meta.subject.toLowerCase().includes(GROUP_NAME_KEYWORD) || anu.id === targetGroupId) {
                        for (let num of anu.participants) {
                            const greeting = 
                                `╔════  *WELCOME MEMBER*  ════╗\n` +
                                `║      *New Member Joined*      ║\n` +
                                `╚════════════════════╝\n\n` +
                                `Halo @${num.split('@')[0]} 👋\n\n` +
                                `Selamat datang di komunitas *${meta.subject}*! ✨\n\n` +
                                `Saya adalah asisten digital di grup ini. Ketik *.noxa* untuk melihat fitur layanan kami atau bantuan pesanan.\n\n` +
                                `*Happy Shopping!* 🛍️💜\n\n` +
                                `© 2026 noxarianet store`;

                            try {
                                await sock.sendMessage(anu.id, {
                                    text: greeting,
                                    mentions: [num]
                                }, { timeout: 5000 });
                            } catch (e) {
                                console.error('⚠️ Gagal greeting:', e.message);
                            }
                        }
                    }
                }
            } catch (err) { console.error('⚠️ Error group-participants:', err.message); }
        });

        // ═══ HANDLER PESAN MASUK ═══
        sock.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const m = chatUpdate.messages[0];
                if (!m.message || m.key.fromMe) return;

                const remoteJid = m.key.remoteJid;
                const isGroup = remoteJid.endsWith('@g.us');
                
                // 🔓 MODE FULL PUBLIC: Bot merespon di manapun (Grup & Japri)
                const senderNum = isGroup ? m.key.participant : remoteJid;

                // ─── UNWRAP PESAN (Support Disappearing Messages di Grup) ───
                let msgData = m.message;
                if (msgData?.ephemeralMessage) {
                    msgData = msgData.ephemeralMessage.message;
                }
                if (msgData?.viewOnceMessageV2) {
                    msgData = msgData.viewOnceMessageV2.message;
                }

                // ─── Tangkap respons native flow button ───
                const nativeFlow = msgData?.interactiveResponseMessage?.nativeFlowResponseMessage;
                if (nativeFlow) {
                    const params = JSON.parse(nativeFlow.paramsJson || '{}');
                    const btnId = params.id;
                    console.log(`🎯 Native Flow Response: ${btnId} dari ${senderNum}`);
                    await handleMenuAction(btnId, remoteJid, senderNum, m);
                    return;
                }

                // ─── Tangkap respons list message ───
                const listRowId = msgData?.listResponseMessage?.singleSelectReply?.selectedRowId;
                if (listRowId) {
                    console.log(`🎯 List Response: ${listRowId} dari ${senderNum}`);
                    await handleMenuAction(listRowId, remoteJid, senderNum, m);
                    return;
                }

                const messageContent =
                    msgData?.conversation ||
                    msgData?.extendedTextMessage?.text ||
                    msgData?.imageMessage?.caption || 
                    msgData?.videoMessage?.caption || '';

                if (!messageContent) return;
                const msg = messageContent.toLowerCase().trim();

                console.log(`📩 ${isGroup ? '[GRUP]' : '[JAPRI]'} ${senderNum}: "${messageContent}"`);

                if (msg.includes('@noxarianet')) { await sendInteractiveMenu(remoteJid, m); return; }
                if (!msg.startsWith('.')) return;

                const command = msg.slice(1).trim().split(' ')[0];
                console.log(`🎯 Command: .${command}`);

                switch (command) {
                    case 'noxa':
                        await sendInteractiveMenu(remoteJid, m); break;
                    default:
                        // Do not respond to unknown commands
                        break;
                }
            } catch (err) { console.error('❌ Error handler:', err.message); }
        });

        // ═══ SUPABASE REALTIME ═══
        if (!supabaseSubscribed && supabase) {
            supabaseSubscribed = true;
            console.log('📡 Subscribing Supabase Realtime...');
            supabase
                .channel('public:orders')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
                    const s = currentSock;
                    if (!s) return;
                    const order = payload.new;
                    console.log(`\n🔔 PESANAN BARU: ${order.id}`);

                    let notif = `✨ *PESANAN BARU!* ✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    notif += `🆔 ID: *${order.id}*\n📦 Produk: *${order.product}*\n`;
                    notif += `💎 Varian: ${order.variant || '-'}\n`;
                    notif += `💰 Harga: *Rp ${Number(order.price || 0).toLocaleString('id-ID')}*\n`;
                    notif += `💳 Metode: ${order.payment_method || 'Manual'}\n`;
                    notif += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *PEMBELI*\n`;
                    notif += `📱 WA: *${order.wa_number}*\n📧 Email: ${order.email || '-'}\n`;
                    if (order.testimonial && order.testimonial !== '-') notif += `💬 Catatan: _${order.testimonial}_\n`;
                    notif += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⏰ ${new Date(order.timestamp).toLocaleString('id-ID')}`;

                    try {
                        if (cachedGroupId) {
                            await sendMessage(cachedGroupId, notif, order.proof_image);
                        } else {
                            const groups = await sock.groupFetchAllParticipating();
                            const tg = Object.values(groups).find(g => g.subject.toLowerCase().includes(GROUP_NAME_KEYWORD));
                            if (tg) { 
                                cachedGroupId = tg.id; 
                                await sendMessage(cachedGroupId, notif, order.proof_image); 
                            } else {
                                console.log('⚠️ Grup dengan keyword tidak ditemukan, fallback ke targetGroupId');
                                await sendMessage(targetGroupId, notif, order.proof_image);
                            }
                        }

                        let waStr = (order.wa_number || '').toString();
                        let num = waStr.replace(/\D/g, '');
                        if (num) {
                            if (num.startsWith('0')) num = '62' + num.slice(1);
                            else if (!num.startsWith('62')) num = '62' + num;
                            await sendText(`${num}@s.whatsapp.net`,
                                `Halo Kak! 👋\n\nTerima kasih berbelanja di *noxarianet store* 💜\n\n` +
                                `✅ Pesanan ID *${order.id}* sudah kami terima & sedang diproses.\n` +
                                `📧 Email: ${order.email}\n⏱️ Estimasi: *1–5 menit*\n\nTerima kasih! 🙏💜`
                            );
                        }
                    } catch (err) { console.error('❌ Error notifikasi order:', err.message); }
                })
                .subscribe(status => console.log(`📡 Realtime: ${status}`));
        }

        // ═══ POLLING DATABASE (FALLBACK & UTAMA JIKA REALTIME MATI) ═══
        let lastProcessedTime = new Date().toISOString();
        const processedOrderIds = new Set();

        setInterval(async () => {
            if (!supabase || !currentSock) return;
            try {
                // Ambil order terbaru yang dibuat setelah lastProcessedTime
                const { data: newOrders, error } = await supabase
                    .from('orders')
                    .select('*')
                    .gt('timestamp', lastProcessedTime)
                    .order('timestamp', { ascending: true });

                if (error) {
                    // console.error('❌ Polling Error:', error.message);
                    return;
                }

                if (newOrders && newOrders.length > 0) {
                    for (const order of newOrders) {
                        if (processedOrderIds.has(order.id)) continue;
                        processedOrderIds.add(order.id);

                        console.log(`\n🔔 [POLLING] PESANAN BARU DITEMUKAN: ${order.id}`);
                        
                        let notif = `✨ *PESANAN BARU!* ✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                        notif += `🆔 ID: *${order.id}*\n📦 Produk: *${order.product}*\n`;
                        notif += `💎 Varian: ${order.variant || '-'}\n`;
                        notif += `💰 Harga: *Rp ${Number(order.price || 0).toLocaleString('id-ID')}*\n`;
                        notif += `💳 Metode: ${order.payment_method || 'Manual'}\n`;
                        notif += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 *PEMBELI*\n`;
                        notif += `📱 WA: *${order.wa_number}*\n📧 Email: ${order.email || '-'}\n`;
                        if (order.testimonial && order.testimonial !== '-') notif += `💬 Catatan: _${order.testimonial}_\n`;
                        notif += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⏰ ${new Date(order.timestamp).toLocaleString('id-ID')}`;

                        try {
                            if (cachedGroupId) {
                                await sendMessage(cachedGroupId, notif, order.proof_image);
                            } else {
                                const groups = await currentSock.groupFetchAllParticipating();
                                const tg = Object.values(groups).find(g => g.subject.toLowerCase().includes(GROUP_NAME_KEYWORD));
                                if (tg) { 
                                    cachedGroupId = tg.id; 
                                    await sendMessage(cachedGroupId, notif, order.proof_image); 
                                } else {
                                    console.log('⚠️ Grup dengan keyword tidak ditemukan, fallback ke targetGroupId');
                                    await sendMessage(targetGroupId, notif, order.proof_image);
                                }
                            }

                            let waStr = (order.wa_number || '').toString();
                            let num = waStr.replace(/\D/g, '');
                            if (num) {
                                if (num.startsWith('0')) num = '62' + num.slice(1);
                                else if (!num.startsWith('62')) num = '62' + num;
                                await sendText(`${num}@s.whatsapp.net`,
                                    `Halo Kak! 👋\n\nTerima kasih berbelanja di *noxarianet store* 💜\n\n` +
                                    `✅ Pesanan ID *${order.id}* sudah kami terima & sedang diproses.\n` +
                                    `📧 Email: ${order.email}\n⏱️ Estimasi: *1–5 menit*\n\nTerima kasih! 🙏💜`
                                );
                            }
                        } catch (err) { console.error('❌ Error notifikasi order polling:', err.message); }

                        // Update last processed time
                        if (new Date(order.timestamp) > new Date(lastProcessedTime)) {
                            lastProcessedTime = order.timestamp;
                        }
                    }
                }
            } catch (err) {
                // Silently ignore to prevent log spam
            }
        }, 10000); // Cek setiap 10 detik

    } catch (err) {
        console.error('\n❌ ERROR FATAL:', err.message);
        setTimeout(() => startBot(), 5000);
    }
}

console.log('\n╔══════════════════════════════════════╗');
console.log('║ 🚀 NOXARIANET BOT v4.0 (NATIVE FLOW) ║');
console.log('╚══════════════════════════════════════╝\n');
startBot();