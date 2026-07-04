require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const pino = require('pino');

function formatWaJid(waNumber) {
    let num = (waNumber || "").toString().replace(/\D/g, "");
    if (!num) return null;
    if (num.startsWith("0")) num = "62" + num.slice(1);
    else if (!num.startsWith("62")) num = "62" + num;
    return num + "@s.whatsapp.net";
}

let currentSock = null;

async function sendViaCurrent(jid, text) {
    console.log(`[DEBUG] Attempting to send message to: ${jid}`);
    if (!currentSock?.user) {
        const errMsg = "Connection not ready";
        console.error(`[DEBUG] ${errMsg}`);
        throw new Error(errMsg);
    }
    try {
        await currentSock.sendMessage(jid, { text });
        console.log(`[DEBUG] SUCCESS: Message sent to ${jid}`);
    } catch (err) {
        console.error(`[DEBUG] ERROR sending to ${jid}:`, err); // Log full error, not just message
        throw err;
    }
}

async function main() {
    console.log("Starting manual send test...");
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version } = await fetchLatestBaileysVersion();

    currentSock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: ["noxarianet Bot", "Safari", "5.0"],
        syncFullHistory: false,
    });

    currentSock.ev.on('creds.update', saveCreds);

    currentSock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("Scan QR code to continue (this script is for testing only!)");
            console.log("QR:", qr);
        }
        if (connection === 'open') {
            console.log("Connected! Let's test sending a message...");
            
            // Test with the number from the order data we saw earlier
            const testWaNumber = "081999622231"; // This is from the test-supa.js output
            const testJid = formatWaJid(testWaNumber);
            console.log("Test waNumber:", testWaNumber);
            console.log("Test formatted JID:", testJid);

            try {
                await sendViaCurrent(testJid, "Hello, this is a test message from the bot!");
                console.log("Test message sent!");
            } catch (err) {
                console.error("Test failed:", err);
            }
            
            // Exit after test
            setTimeout(() => process.exit(0), 5000);
        } else if (connection === 'close') {
            console.log("Connection closed. Exiting...");
            process.exit(1);
        }
    });
}

main();
