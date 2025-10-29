import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import OpenAI from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import https from "https";
import selfsigned from "selfsigned";
import cors from "cors";

dotenv.config();

// ---- Arreglado para Windows ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));
app.use(express.static("public"));

if (!fs.existsSync("./certs")) fs.mkdirSync("./certs");
const certPath = "./certs/cert.pem";
const keyPath = "./certs/key.pem";

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  const pems = selfsigned.generate([{ name: "commonName", value: "192.168.1.68" }], { days: 365 });
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
}

const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SISTEMA = process.env.SYSTEM_PROMPT || "Eres un asistente conversacional que responde por voz.";

// ---- Carpeta uploads segura para Windows ----
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.post("/api/voz", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Archivo de audio requerido" });

  const tempPath = req.file.path + ".webm";
  fs.renameSync(req.file.path, tempPath);

  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "gpt-4o-mini-transcribe",
    });

    const pregunta = transcription.text;
    console.log("Usuario dijo:", pregunta);

    const respuesta = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: pregunta }
      ],
    });

    const respuestaTexto = respuesta.choices[0].message.content;
    console.log("IA responde:", respuestaTexto);

    const eleven = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    const audioStream = await eleven.textToSpeech.convert(
      "JBFqnCBsd6RMkjVDRZzb",
      { text: respuestaTexto, modelId: "eleven_multilingual_v2", outputFormat: "mp3_44100_128" }
    );

    // Convertir ReadableStream a Buffer
    const chunks = [];
    for await (const chunk of audioStream) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Respuesta-Texto", respuestaTexto);
    res.send(audioBuffer);

  } catch (err) {
    console.error("Error procesando audio:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

https.createServer(httpsOptions, app).listen(3000, () => {
  console.log("Servidor HTTPS activo en https://192.168.1.68:3000");
});
