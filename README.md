# API Tester

Cliente web minimalista para probar APIs HTTPS de producción mediante un proxy Express. Incluye una pantalla de inicio de sesión y validación para bloquear destinos locales o privados.

## Requisitos

- Node.js 18.17 o superior.
- HTTPS habilitado en producción.

## Ejecución local

Desde la raíz del repositorio, instala las dependencias:

```powershell
cd backend
npm install
```

Configura `backend/.env` con las credenciales de acceso y una clave de firma aleatoria. Este archivo está excluido de Git; no lo publiques ni lo compartas:

```env
API_TESTER_USERNAME=tu-usuario
API_TESTER_PASSWORD=una-contrasena-larga-y-unica
SESSION_SECRET=secreto-aleatorio-de-al-menos-32-caracteres
```

Puedes copiar `backend/.env.example` como punto de partida. Genera tu propio valor para `SESSION_SECRET`; no uses el texto de ejemplo.

Luego inicia el servidor:

```powershell
npm start
```

Abre `http://localhost:3000`. La página de inicio de sesión usa esas credenciales. Las sesiones duran 8 horas, usan una cookie firmada `HttpOnly` y `SameSite=Strict`, y el formulario limita los intentos de inicio de sesión.

## Despliegue en cPanel

1. Habilita un certificado TLS válido y fuerza la redirección de HTTP a HTTPS.
2. En **Setup Node.js App**, configura la versión de Node.js (18.17 o superior), el directorio de la aplicación como `backend` y `server.js` como archivo de inicio.
3. Configura las variables de entorno de la aplicación en cPanel. No subas `backend/.env`:

   ```env
   API_TESTER_USERNAME=tu-usuario
   API_TESTER_PASSWORD=una-contrasena-larga-y-unica
   SESSION_SECRET=secreto-aleatorio-de-al-menos-32-caracteres
   NODE_ENV=production
   APP_BASE_PATH=/apps/apitester
   FRONTEND_ORIGIN=https://victorcabrera.cl
   ```

4. Instala las dependencias de producción desde el entorno de la aplicación:

   ```sh
   npm ci --omit=dev
   ```

5. Configura la URL de la aplicación como `https://victorcabrera.cl/apps/apitester` y comprueba el inicio de sesión, los archivos estáticos, el cierre de sesión y una llamada al proxy.

`APP_BASE_PATH` debe coincidir con la ruta que recibe Express. Algunos montajes de Passenger conservan el prefijo `/apps/apitester` en las rutas y otros lo eliminan antes de entregar la petición a Node. Si cPanel elimina el prefijo, usa `APP_BASE_PATH` vacío y confirma con el proveedor cómo montar la aplicación en esa URL.

Con `NODE_ENV=production`, la cookie de sesión lleva el atributo `Secure`. Asegúrate de que cPanel o su proxy inverso informe el esquema HTTPS correctamente a Node. Si el frontend y el proxy se sirven bajo el mismo dominio, no hace falta habilitar CORS para ese flujo.

## Seguridad

- Mantén `backend/.env` y los secretos del entorno fuera de GitHub.
- Usa una contraseña fuerte y un `SESSION_SECRET` aleatorio propio de al menos 32 caracteres.
- El proxy acepta únicamente destinos HTTPS y rechaza direcciones locales o privadas.
- Esta herramienta está pensada para uso personal. Antes de permitir acceso público, añade controles adicionales como una lista permitida de APIs destino y límites de uso.
