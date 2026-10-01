# API Tester

Cliente web minimalista para probar APIs HTTPS de producción mediante un proxy Express.

## Configuración

Requiere Node.js 18.17 o superior. Instala las dependencias:

```powershell
cd backend
npm install
```

Configura `backend/.env` con las credenciales de acceso. Este archivo está excluido de Git. No lo publiques ni lo compartas:

```env
API_TESTER_USERNAME=tu-usuario
API_TESTER_PASSWORD=una-contrasena-larga-y-unica
```

Luego inicia el servidor:

```powershell
npm start
```

Abre `http://localhost:3000`. El navegador solicitará las credenciales mediante HTTP Basic antes de permitir el acceso a la interfaz o al proxy.

## Despliegue

- Usa HTTPS en el hosting o proxy inverso.
- Define `API_TESTER_USERNAME` y `API_TESTER_PASSWORD` como secretos del entorno de despliegue.
- Si el frontend se publica en otro origen, configura `FRONTEND_ORIGIN` con ese origen completo. Puedes indicar varios orígenes separados por comas.
- No expongas las credenciales, API keys ni tokens en el repositorio.
