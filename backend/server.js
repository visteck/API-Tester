const dns = require("node:dns").promises;
const crypto = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const { Agent, fetch } = require("undici");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT) || 3000;
const requestTimeoutMs = 30_000;
const username = process.env.API_TESTER_USERNAME;
const password = process.env.API_TESTER_PASSWORD;
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGIN || `http://localhost:${port}`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const blockedHeaderNames = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

if (!username || !password) {
  throw new Error("Define API_TESTER_USERNAME y API_TESTER_PASSWORD antes de iniciar el servidor.");
}

function credentialsMatch(value, expected) {
  const actualBuffer = Buffer.from(value, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireAuthentication(req, res, next) {
  const authorization = req.get("authorization");
  if (!authorization || !authorization.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="API Tester", charset="UTF-8"');
    return res.status(401).send("Autenticación requerida.");
  }

  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const suppliedUsername = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);

  if (
    separator === -1 ||
    !credentialsMatch(suppliedUsername, username) ||
    !credentialsMatch(suppliedPassword, password)
  ) {
    res.set("WWW-Authenticate", 'Basic realm="API Tester", charset="UTF-8"');
    return res.status(401).send("Credenciales inválidas.");
  }

  return next();
}

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  }
}));
app.use(requireAuthentication);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224
  );
}

function getIpv4MappedAddress(address) {
  let value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const lastSegment = value.slice(value.lastIndexOf(":") + 1);

  if (net.isIP(lastSegment) === 4) {
    const octets = lastSegment.split(".").map(Number);
    value = `${value.slice(0, value.lastIndexOf(":") + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const doubleColonIndex = value.indexOf("::");
  if (doubleColonIndex !== value.lastIndexOf("::")) {
    return null;
  }

  const left = doubleColonIndex === -1 ? [] : value.slice(0, doubleColonIndex).split(":").filter(Boolean);
  const right = doubleColonIndex === -1 ? value.split(":") : value.slice(doubleColonIndex + 2).split(":").filter(Boolean);
  const missingGroups = 8 - left.length - right.length;
  const groups = doubleColonIndex === -1 ? right : [...left, ...Array(missingGroups).fill("0"), ...right];

  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[\da-f]{1,4}$/.test(group)) ||
    !groups.slice(0, 5).every((group) => parseInt(group, 16) === 0) ||
    parseInt(groups[5], 16) !== 0xffff
  ) {
    return null;
  }

  const high = parseInt(groups[6], 16);
  const low = parseInt(groups[7], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    return isPrivateIpv4(address);
  }

  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mappedIpv4 = getIpv4MappedAddress(normalized);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function validateProductionUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("La URL de destino no es válida.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Solo se permiten URLs HTTPS de producción sin credenciales incluidas.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("No se permiten destinos locales o internos.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("No se permiten direcciones IP privadas, locales o reservadas.");
    }
    return { url, addresses: [{ address: hostname, family: net.isIP(hostname) }] };
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("No fue posible resolver el host de destino.");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("El destino resuelve a una dirección privada, local o reservada.");
  }

  return { url, addresses };
}

function createPinnedDispatcher(addresses) {
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        const address = addresses.find(({ family }) => !options.family || family === options.family);
        if (!address) {
          callback(new Error("No hay una dirección compatible para el destino."));
          return;
        }
        if (options.all) {
          callback(null, [address]);
          return;
        }
        callback(null, address.address, address.family);
      }
    }
  });
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error("Los headers deben ser un objeto JSON.");
  }

  const normalized = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!name.trim() || blockedHeaderNames.has(lowerName)) {
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`El header "${name}" debe tener un valor simple.`);
    }
    normalized[name] = String(value);
  }
  return normalized;
}

app.post("/api/proxy", async (req, res) => {
  const { targetUrl, method, headers = {}, body } = req.body || {};
  const allowedMethods = new Set(["GET", "POST", "PUT", "DELETE"]);
  const normalizedMethod = typeof method === "string" ? method.toUpperCase() : "";

  try {
    if (!allowedMethods.has(normalizedMethod)) {
      return res.status(400).json({ error: "El método HTTP no está permitido." });
    }

    const { url, addresses } = await validateProductionUrl(targetUrl);
    const requestHeaders = normalizeHeaders(headers);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const dispatcher = createPinnedDispatcher(addresses);

    try {
      const response = await fetch(url, {
        method: normalizedMethod,
        headers: requestHeaders,
        body: normalizedMethod === "GET" || body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
        dispatcher
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return res.status(502).json({
          error: "El servidor destino no devolvió una respuesta JSON.",
          status: response.status
        });
      }

      let data;
      try {
        data = await response.json();
      } catch {
        return res.status(502).json({
          error: "El servidor destino devolvió JSON inválido.",
          status: response.status
        });
      }

      return res.status(response.status).json({
        status: response.status,
        statusText: response.statusText,
        data
      });
    } catch (error) {
      const message = error.name === "AbortError"
        ? "La petición al servidor destino excedió los 30 segundos."
        : "No se pudo conectar con el servidor destino.";
      return res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeout);
      dispatcher.close();
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`API Tester disponible en http://localhost:${port}`);
});
