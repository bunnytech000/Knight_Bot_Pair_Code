import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Genos ASCII header
const genosASCII = `
 _____ _____ _      ____  ____ 
/  __//  __// \\  /|/  _ \\/ ___\\
| |  _|  \\  | |\\ ||| / \\||    \\
| |_//|  /_ | | \\||| \\_/|\\___ |
\\____\\\\____\\\\_/  \\|\\____/\\____/
🤖 Genos MD – Cyborg Bot
`;

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    await removeFile(dirs);
    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Enter full international number without + or spaces.' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let GenosMD = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            GenosMD.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Genos MD connected successfully!");

                    try {
                        const sessionGenos = fs.readFileSync(dirs + '/creds.json');
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        await GenosMD.sendMessage(userJid, {
                            document: sessionGenos,
                            mimetype: 'application/json',
                            fileName: 'genosmd-creds.json'
                        });

                        await GenosMD.sendMessage(userJid, {
                            text: `${genosASCII}\n\n⚠️ *Important:* Do NOT share this session file with anyone.\n\n🧹 Session will auto-clean after setup.\n\n©2025 Genos MD Network`
                        });

                        console.log("📄 Genos MD ASCII message sent successfully");

                        console.log("🧹 Cleaning up Genos MD session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Genos MD session cleaned successfully");
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log("🔐 New login via pair code");
                if (isOnline) console.log("📶 Genos MD is online");

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need new pairing code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!GenosMD.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await GenosMD.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) await res.send({ code });
                    console.log({ num, code });
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Check your number and try again.' });
                    }
                }
            }

            GenosMD.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (["conflict","not-authorized","Socket connection timeout","rate-overlimit","Connection Closed","Timed Out","Value not found","Stream Errored","Stream Errored (restart required)","statusCode: 515","statusCode: 503"].some(v=>e.includes(v))) return;
    console.log('Caught exception: ', err);
});

export default router;
