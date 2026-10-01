const form = document.querySelector("#request-form");
const methodSelect = document.querySelector("#method");
const bodyInput = document.querySelector("#body");
const headersInput = document.querySelector("#headers");
const urlInput = document.querySelector("#target-url");
const responsePanel = document.querySelector("#response");
const statusBadge = document.querySelector("#status");
const errorPanel = document.querySelector("#form-error");
const submitButton = document.querySelector("#submit-button");
const pasteHeadersButton = document.querySelector("#paste-headers");
const pasteBodyButton = document.querySelector("#paste-body");
const copyResponseButton = document.querySelector("#copy-response");
const clipboardFeedback = document.querySelector("#clipboard-feedback");
const appBasePath = document.querySelector('meta[name="app-base-path"]').content;

function parseHeaders(value) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return {};
  }

  if (trimmedValue.startsWith("{")) {
    const parsed = JSON.parse(trimmedValue);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Los headers JSON deben ser un objeto.");
    }
    return parsed;
  }

  return trimmedValue.split(/\r?\n/).reduce((headers, line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Header inválido: "${line}". Usa el formato Nombre: valor.`);
    }
    const name = line.slice(0, separator).trim();
    const headerValue = line.slice(separator + 1).trim();
    if (!name) {
      throw new Error("El nombre de un header no puede estar vacío.");
    }
    headers[name] = headerValue;
    return headers;
  }, {});
}

function setBodyAvailability() {
  const isGet = methodSelect.value === "GET";
  bodyInput.disabled = isGet;
  pasteBodyButton.disabled = isGet;
  if (isGet) {
    bodyInput.value = "";
  }
}

function showError(message) {
  errorPanel.textContent = message;
  errorPanel.classList.remove("hidden");
}

function clearError() {
  errorPanel.textContent = "";
  errorPanel.classList.add("hidden");
}

function showClipboardFeedback(message) {
  clipboardFeedback.textContent = message;
  setTimeout(() => {
    if (clipboardFeedback.textContent === message) {
      clipboardFeedback.textContent = "";
    }
  }, 2_500);
}

async function pasteInto(input, label) {
  try {
    input.value = await navigator.clipboard.readText();
    input.focus();
    showClipboardFeedback(`${label} pegados.`);
  } catch {
    showError("No se pudo leer el portapapeles. Comprueba los permisos del navegador.");
  }
}

async function copyResponse() {
  try {
    await navigator.clipboard.writeText(responsePanel.textContent);
    showClipboardFeedback("Respuesta copiada.");
  } catch {
    showError("No se pudo copiar la respuesta. Comprueba los permisos del navegador.");
  }
}

function renderStatus(status, statusText) {
  const success = status >= 200 && status < 300;
  statusBadge.textContent = `${status} ${statusText || ""}`.trim();
  statusBadge.className = `rounded-full px-3 py-1 text-sm font-bold ${
    success
      ? "bg-emerald-500/20 text-emerald-300"
      : "bg-red-500/20 text-red-300"
  }`;
}

methodSelect.addEventListener("change", setBodyAvailability);
pasteHeadersButton.addEventListener("click", () => pasteInto(headersInput, "Headers"));
pasteBodyButton.addEventListener("click", () => pasteInto(bodyInput, "Body"));
copyResponseButton.addEventListener("click", copyResponse);
setBodyAvailability();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  let headers;
  let body;
  try {
    headers = parseHeaders(headersInput.value);
    if (methodSelect.value !== "GET" && bodyInput.value.trim()) {
      body = JSON.parse(bodyInput.value);
    }
  } catch (error) {
    showError(error.message === "Unexpected end of JSON input" || error instanceof SyntaxError
      ? "El JSON de headers o body no es válido."
      : error.message);
    return;
  }

  const request = {
    targetUrl: urlInput.value.trim(),
    method: methodSelect.value,
    headers
  };
  if (body !== undefined) {
    request.body = body;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";
  statusBadge.classList.add("hidden");
  responsePanel.textContent = "Esperando respuesta del servidor...";

  try {
    const response = await fetch(`${appBasePath}/api/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const payload = await response.json();

    if (response.status === 401) {
      window.location.assign(`${appBasePath}/login`);
      return;
    }

    renderStatus(payload.status || response.status, payload.statusText || response.statusText);
    responsePanel.textContent = JSON.stringify(
      Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload,
      null,
      2
    );
  } catch (error) {
    renderStatus(0, "Error de conexión");
    responsePanel.textContent = JSON.stringify({ error: "No se pudo contactar el proxy local." }, null, 2);
  } finally {
    statusBadge.classList.remove("hidden");
    submitButton.disabled = false;
    submitButton.textContent = "Enviar petición";
  }
});
