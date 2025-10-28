let mediaRecorder;
let audioChunks = [];

const botonMicro = document.getElementById("mic");
const botonEnviar = document.getElementById("enviar");
const estado = document.getElementById("estado");
const entrada = document.getElementById("chati");

// Iniciar / detener grabación
botonMicro.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.start();
      estado.textContent = "Grabando...";
      botonMicro.classList.add("grabando");
    } catch (err) {
      console.error("Error accediendo al micrófono:", err);
      estado.textContent = "No se pudo acceder al micrófono";
    }
  } else if (mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    estado.textContent = "Procesando...";
    botonMicro.classList.remove("grabando");
  }
});

// Enviar audio al servidor
botonEnviar.addEventListener("click", async () => {
  if (audioChunks.length === 0) return;

  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("audio", blob, "grabacion.webm");

  try {
    const resp = await fetch("/api/voz", { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json();
      estado.textContent = "Error: " + err.error;
      audioChunks = [];
      return;
    }

    const data = await resp.json();
    estado.textContent = "IA respondió (voz reproducida)";
    audioChunks = [];
  } catch (err) {
    console.error("Error enviando audio:", err);
    estado.textContent = "Error conectando con el servidor";
  }
});
