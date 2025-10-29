import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import mammoth from "mammoth";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import OpenAI from "openai";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";
import https from "https";
import selfsigned from "selfsigned";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static("public"));

// --- Generar certificado autofirmado si no existe ---
if (!fs.existsSync("./certs")) fs.mkdirSync("./certs");

const certPath = "./certs/cert.pem";
const keyPath = "./certs/key.pem";

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.log("Generando certificados HTTPS autofirmados...");
  const pems = selfsigned.generate(
    [{ name: "commonName", value: "192.168.1.68" }],
    { days: 365 }
  );
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
}

const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

// --- Configuración de OpenAI ---
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SISTEMA =
  process.env.SYSTEM_PROMPT || "Eres un asistente conversacional que responde por voz.";

// --- Embeddings de documentos ---
let baseVectores = [];
const ARCHIVO_VECTORES = "./vectorStore.json";

function similitudCoseno(a, b) {
  const producto = a.reduce((suma, val, i) => suma + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((suma, val) => suma + val * val, 0));
  const magB = Math.sqrt(b.reduce((suma, val) => suma + val * val, 0));
  if (magA === 0 || magB === 0) return 0;
  return producto / (magA * magB);
}

async function cargarDocumentos() {
  if (fs.existsSync(ARCHIVO_VECTORES)) {
    try {
      baseVectores = JSON.parse(fs.readFileSync(ARCHIVO_VECTORES, "utf-8"));
      if (Array.isArray(baseVectores) && baseVectores.length > 0) return;
    } catch {
      baseVectores = [];
    }
  }

  if (!fs.existsSync("./docs")) return;

  const archivos = fs
    .readdirSync("./docs")
    .filter((f) => f.toLowerCase().endsWith(".docx"));
  for (const archivo of archivos) {
    const buffer = fs.readFileSync(`./docs/${archivo}`);
    const resultado = await mammoth.extractRawText({ buffer });
    const texto = resultado.value || "";

    const TAMANO_FRAGMENTO = 500;
    for (let i = 0; i < texto.length; i += TAMANO_FRAGMENTO) {
      const fragmento = texto.slice(i, i + TAMANO_FRAGMENTO);
      if (!fragmento.trim()) continue;
      const emb = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: fragmento,
      });
      baseVectores.push({
        id: `${archivo}-${i}`,
        texto: fragmento,
        embedding: emb.data[0].embedding,
        fuente: archivo,
      });
    }
  }

  if (baseVectores.length > 0) {
    fs.writeFileSync(ARCHIVO_VECTORES, JSON.stringify(baseVectores));
  }
}
await cargarDocumentos();

const PALABRAS_DOCUMENTOS = [
  "arquitectura",
  "gótica",
  "veterinaria",
  "vet",
  "animales",
  "league of legends",
  "lol",
  "tft",
  "builds",
  "campeones",
];

function esConversacionDeDocumento(pregunta) {
  const texto = (pregunta || "").toLowerCase();
  return PALABRAS_DOCUMENTOS.some((p) => texto.includes(p));
}

// --- Funciones rápidas ---
const funciones = [
  {
    nombre: "saluda",
    palabras: ["saludame", "hola"],
    ejecutar: () => "Hola, encantado de saludarte.",
  },
  {
    nombre: "tiempo",
    palabras: ["tiempo", "clima"],
    ejecutar: () => "El tiempo en Badajoz es soleado con 25°C.",
  },
];

function detectarFuncion(mensaje) {
  const texto = (mensaje || "").toLowerCase();
  return funciones.find((fn) => fn.palabras.some((p) => texto.includes(p)));
}

// --- Endpoint de audio ---
const upload = multer({ dest: path.join(__dirname, "uploads/") });

app.post("/api/voz", upload.single("audio"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "Archivo de audio requerido" });

  try {
    const tempPath = req.file.path + ".webm";
    fs.renameSync(req.file.path, tempPath);

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "gpt-4o-mini-transcribe",
    });

    const pregunta = transcription.text;
    console.log("Usuario dijo:", pregunta);

    const fn = detectarFuncion(pregunta);
    let respuestaTexto = "";
    if (fn) {
      respuestaTexto = fn.ejecutar();
    } else {
      let contexto = "";
      if (esConversacionDeDocumento(pregunta) && baseVectores.length > 0) {
        const qEmbedding = await client.embeddings.create({
          model: "text-embedding-3-small",
          input: pregunta,
        });
        const queryVector = qEmbedding.data[0].embedding;
        const puntuados = baseVectores.map((c) => ({
          ...c,
          score: similitudCoseno(queryVector, c.embedding),
        }));
        const mejores = puntuados
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        contexto = mejores.map((c) => c.texto).join("\n");
      }

      const mensajesEntrada = [
        { role: "system", content: SISTEMA },
        ...(contexto
          ? [{ role: "system", content: `Información de documentos:\n${contexto}` }]
          : []),
        { role: "user", content: pregunta },
      ];

      const respuesta = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: mensajesEntrada,
      });

      respuestaTexto = respuesta.choices[0].message.content;
    }

    console.log("IA responde:", respuestaTexto);

    const elevenlabs = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
    const audio = await elevenlabs.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
      text: respuestaTexto,
      modelId: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
    });
    await play(audio);

    res.json({ text: respuestaTexto });
    fs.unlinkSync(tempPath);
  } catch (err) {
    console.error("Error procesando audio:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Servidor HTTPS ---
https.createServer(httpsOptions, app).listen(3000, () => {
  console.log("✅ Servidor HTTPS activo en https://192.168.1.68:3000");
  console.log("Abre esa URL en el navegador y acepta el certificado.");
});
