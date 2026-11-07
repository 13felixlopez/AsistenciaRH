# Guía de Despliegue: Frontend en Netlify y Backend en Servidor Propio

Esta guía detalla los pasos para poner en marcha la arquitectura separada:
- **Frontend:** Alojado en **Netlify** (sitio estático rápido, CDN global y soporte PWA).
- **Backend:** Ejecutándose en tu **servidor propio** (Node.js + Express + SQL Server).

---

## 📁 1. Estructura del Proyecto

El repositorio ahora cuenta con dos carpetas independientes:

* `frontend/`: Todo el código cliente (HTML, CSS, JS, fotos de patio, logos, `netlify.toml`). **Esta es la única carpeta que se sube a Netlify.**
* `backend/`: La API REST (Node.js, Express, autenticación JWT, conexión a SQL Server). Se ejecuta en tu servidor o VPS.

---

## 🚀 2. Despliegue del Frontend en Netlify

Tienes dos formas muy sencillas de subir el frontend a Netlify:

### Opción A: Arrastrar y Soltar (Manual - En 30 segundos)
1. Inicia sesión en [Netlify](https://app.netlify.com/).
2. Ve a la pestaña **Sites** y busca la sección **"Want to deploy a new site without connecting to Git? Drag and drop your site output folder here"**.
3. Arrastra directamente la carpeta **`frontend`** de este proyecto y suéltala allí.
4. Netlify generará una URL pública (ejemplo: `https://asistencia-rh-2026.netlify.app`).

### Opción B: Conectar con Repositorio Git (Recomendada para actualizaciones continuas)
1. Sube tu proyecto a GitHub/GitLab.
2. En Netlify, selecciona **Add new site > Import an existing project**.
3. En la configuración de construcción (*Build settings*):
   * **Base directory:** `frontend`
   * **Build command:** *(dejar vacío)*
   * **Publish directory:** `frontend` (o `.` si la base ya es frontend)

---

## ⚙️ 3. Conectar el Frontend con tu Servidor Propio

1. Abre el archivo `frontend/js/config.js`.
2. Modifica la variable `API_BASE_URL` para colocar la IP pública o dominio de tu servidor con HTTPS:
   ```javascript
   const API_BASE_URL = localStorage.getItem('API_BASE_URL') || (
       window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
           ? 'http://localhost:3031/api'
           : 'https://api.tuempresa.com/api' // <-- Coloca aquí la URL de tu servidor
   );
   ```
> [!TIP]
> También puedes cambiar la URL en tiempo de ejecución abriendo la consola del navegador y ejecutando:
> `localStorage.setItem('API_BASE_URL', 'https://api.tuempresa.com/api'); location.reload();`

---

## 🖥️ 4. Puesta en Marcha del Backend en tu Servidor Propio

1. Ve a la carpeta `backend/`:
   ```bash
   cd backend
   ```
2. Revisa tu archivo `.env`:
   ```env
   PORT=3031
   NODE_ENV=production
   JWT_SECRET=tu_clave_secreta_jwt_personalizada
   JWT_EXPIRES_IN=12h
   CORS_ORIGIN=*

   # Conexión SQL Server
   DB_USER=Secado
   DB_PASSWORD=TuPassword
   DB_SERVER=192.168.88.250
   DB_INSTANCE=Secado
   DB_NAME=AsistenciaRH_DB
   DB_PORT=1433
   ```
3. Inicia el servidor:
   * **Con Node estándar:**
     ```bash
     npm start
     ```
   * **Con PM2 (Recomendado para servidores de producción):**
     ```bash
     npm install -g pm2
     pm2 start app.js --name "asistencia-api"
     pm2 save
     pm2 startup
     ```

---

## 🔒 5. Importante: HTTPS y Certificado SSL (Evitar "Mixed Content")

> [!WARNING]
> Netlify funciona bajo `https://...`. Por seguridad de los navegadores, las páginas HTTPS no pueden hacer peticiones a servidores HTTP sin cifrar (error *Mixed Content*).
> 
> Para que tu frontend en Netlify pueda comunicarse con tu servidor propio, tu servidor debe contar con certificado SSL. Puedes lograrlo fácilmente de dos formas:
> 
> 1. **Cloudflare Tunnel (Recomendado sin abrir puertos ni IP fija):**
>    Instala `cloudflared` en tu servidor y genera un túnel seguro gratuito con SSL (ejemplo: `https://api-asistencia.tudominio.com`).
> 2. **Nginx o Caddy como Reverse Proxy:**
>    Configura Nginx con un certificado gratuito de Let's Encrypt redirigiendo el tráfico `443` hacia `http://localhost:3031`.
