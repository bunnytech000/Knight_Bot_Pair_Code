import express from 'express';
import fs from 'fs';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

const router = express.Router();

/* ===========================
   REMOVE SESSION DIRECTORY 
=========================== */
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

/* ===========================
        MAIN ROUTE
=========================== */
router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num) return res.status(400).send({ error: "Missing ?number=" });

    let dirs = './' + num;

    // Remove session folder first
    removeFile(dirs);

    // Cleanup the number
    num = num.replace(/[^0-9]/g, '');

    // Validate
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        return res.status(400).send({
            code:
                'Invalid phone number. Enter full international format without + (e.g., 263775000000)'
        });
    }

    // Use E.164 format (without "+")
    num = phone.getNumber('e164').replace('+', '');

    console.log("📞 CLEAN NUMBER:", num);

    /* ===========================
       INIT SESSION + PAIRING
    =========================== */
    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            const KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                browser: Browsers.macOS('Desktop'),
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                markOnlineOnConnect: false,
            });

            /* ===========================
                  CONNECTION HANDLER
            =========================== */
            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log("✅ Connected!");

                    try {
                        /* ===========================
                              SEND SESSION FILE
                        =========================== */
                        const sessionData = fs.readFileSync(dirs + "/creds.json");
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        await KnightBot.sendMessage(userJid, {
                            document: sessionData,
                            mimetype: "application/json",
                            fileName: "creds.json"
                        });

                        console.log("📄 Session file sent.");

                        /* ===========================
                              SEND THUMBNAIL
                        =========================== */
                        await KnightBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption:
                                `🎬 *KnightBot MD V2 Setup Guide*\n\n` +
                                `🚀 Fast AI + Bug Fixes\n📺 Watch: https://youtu.be/NjOipI2AoMk`
                        });

                        console.log("🎬 Guide sent.");

                        /* ===========================
                              SEND WARNING
                        =========================== */
                        await KnightBot.sendMessage(userJid, {
                            text:
                                `⚠️ *Do NOT share this file with anyone!*\n\n` +
                                `┌┤✑ Thanks for using Knight Bot\n` +
                                `│└────────────┈ ⳹\n` +
                                `│©2025 Mr Unique Hacker\n` +
                                `└─────────────────┈ ⳹`
                        });

                        console.log("⚠️ Warning sent.");

                        /* ===========================
                           CLEANUP SESSION FOLDER
                        =========================== */
                        await delay(1000);
                        removeFile(dirs);
                        console.log("🧹 Session cleaned.");

                    } catch (err) {
                        console.error("❌ Failed to send session:", err);
                        removeFile(dirs);
                    }
                }

                // Handle disconnects
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode !== 401) {
                        console.log("🔁 Restarting...");
                        initiateSession();
                    } else {
                        console.log("❌ Session logged out.");
                    }
                }
            });

            /* ===========================
                 REQUEST PAIRING CODE
            =========================== */
            if (!KnightBot.authState.creds.registered) {
                await delay(2000);

                try {
                    let code = await KnightBot.requestPairingCode(num);

                    // Format 4-4-4
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!res.headersSent) {
                        console.log("🔐 Pairing code:", code);
                        return res.send({ code });
                    }
                } catch (err) {
                    console.error("❌ Pairing error:", err);
                    if (!res.headersSent) return res.status(500).send({
                        error: "Failed to get pairing code"
                    });
                }
            }

            KnightBot.ev.on("creds.update", saveCreds);

        } catch (error) {
            console.error("❌ Error initiating session:", error);
            if (!res.headersSent) res.status(500).send({ error: "Service unavailable" });
        }
    }

    initiateSession();
});

/* ===========================
  IGNORED ERRORS
=========================== */
process.on('uncaughtException', (err) => {
    let e = String(err);
    const ignore = [
        "conflict",
        "not-authorized",
        "Socket connection timeout",
        "rate-overlimit",
        "Connection Closed",
        "Timed Out",
        "Value not found",
        "Stream Errored",
        "statusCode: 515",
        "statusCode: 503"
    ];
    if (ignore.some(v => e.includes(v))) return;
    console.log("Caught exception:", err);
});

export default router;