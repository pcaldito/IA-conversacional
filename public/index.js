let mediaRecorder;
let audioChunks = [];

const botonMicro = document.getElementById("mic");
const botonEnviar = document.getElementById("enviar");
const estado = document.getElementById("estado");

// Mantener pulsado para grabar
botonMicro.addEventListener("mousedown", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    audioChunks = [];

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.start();
    estado.textContent = "Grabando...";
    botonMicro.classList.add("listening"); // rojo mientras graba
  } catch (err) {
    console.error("Error accediendo al micrófono:", err);
    estado.textContent = "No se pudo acceder al micrófono";
  }
});

botonMicro.addEventListener("mouseup", () => {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;
  mediaRecorder.stop();
  estado.textContent = "Procesando...";
  botonMicro.classList.remove("listening");
});

botonEnviar.addEventListener("click", async () => {
  if (audioChunks.length === 0) return;

  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("audio", blob, "grabacion.webm");

  try {
    const resp = await fetch("https://192.168.1.68:3000/api/voz", { method: "POST", body: formData });
    if (!resp.ok) {
      estado.textContent = "Error enviando audio";
      return;
    }

    const respuestaTexto = resp.headers.get("X-Respuesta-Texto");
    const audioBlob = await resp.blob();

    console.log("Pregunta enviada:", "Audio enviado");
    console.log("Respuesta IA:", respuestaTexto);

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.onended = () => URL.revokeObjectURL(audioUrl);
    audio.play().catch(() => {});

    estado.textContent = "IA respondió (voz reproducida)";
    audioChunks = [];
  } catch (err) {
    console.error("Error enviando audio:", err);
    estado.textContent = "Error conectando con el servidor";
  }
});
