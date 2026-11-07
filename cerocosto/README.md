# 🚀 Control de Asistencia RH - Arquitectura Cero Costo (Netlify + Turso DB)

Este proyecto está 100% preparado y optimizado para ser desplegado en **Netlify** con backend serverless y base de datos distribuida en **Turso (SQLite / libSQL)**, sin necesidad de contratar servidores VPS, Render o Railway.

---

## 📁 Estructura del Proyecto

```text
cerocosto/
├── .env                     <-- Variables de entorno configuradas con tus credenciales de Turso
├── .env.example             <-- Plantilla de variables de entorno
├── .gitignore               <-- Exclusiones de Git (node_modules, .env, etc.)
├── netlify.toml             <-- Configuración de compilación y redirección serverless de Netlify
├── package.json             <-- Dependencias (@libsql/client, serverless-http, express, etc.)
│
├── database/
│   ├── schema_turso.sql     <-- DDL oficial de todas las tablas e índices para SQLite/Turso
│   ├── seed_turso.sql       <-- Datos iniciales (9 áreas, 90 puestos, roles y usuarios)
│   └── init_turso.js        <-- Script automatizado para migrar todo a Turso con 1 comando
│
├── netlify/
│   └── functions/
│       └── api.js           <-- Netlify Serverless Function (Express envuelto con serverless-http)
│
├── backend/
│   ├── app.js               <-- Aplicación Express adaptada a Turso y Serverless
│   ├── config/db.js         <-- Cliente de conexión con @libsql/client
│   ├── middlewares/auth.js  <-- Autenticación JWT y control de permisos por roles y áreas
│   ├── services/            <-- Cierre automático y lógica de autocompletado de jornadas
│   ├── controllers/         <-- Controladores de áreas, puestos, asistencias, reportes y usuarios
│   └── routes/              <-- Rutas API
│
└── frontend/                <-- Aplicación PWA estática completa (HTML5, JS modular, CSS, Bootstrap)
```

---

## ⚡ Paso 1: Inicializar la Base de Datos en Turso

Tienes dos opciones muy sencillas para cargar las tablas y los datos en tu base de datos de Turso:

### Opción A (Recomendada con Node.js):
Abre una terminal en esta carpeta `cerocosto` y ejecuta:
```bash
npm install
npm run init-db
```
Este comando se conectará a tu base `libsql://asistenciarh-13felixlopez.aws-us-east-1.turso.io` y creará automáticamente todas las tablas, relaciones y cargará los datos semilla.

### Opción B (Desde el panel web de Turso):
1. Entra a tu dashboard en [turso.tech](https://turso.tech) y abre la base de datos `asistenciarh-13felixlopez`.
2. Ve a la pestaña **SQL Console**.
3. Copia el contenido de [`database/schema_turso.sql`](database/schema_turso.sql) y dale **Run**.
4. Luego copia el contenido de [`database/seed_turso.sql`](database/seed_turso.sql) y dale **Run**.

---

## 🖥️ Paso 2: Probar localmente (Opcional)

Si deseas probarlo en tu computadora antes de subirlo:
```bash
npm start
```
Abre tu navegador en `http://localhost:3031` o abre directamente cualquier archivo HTML de la carpeta `frontend/`.

---

## ☁️ Paso 3: Desplegar en Netlify

### Opción 1: Conectar Repositorio de GitHub (Más recomendada)
1. Sube el contenido de la carpeta `cerocosto` a un repositorio en tu cuenta de GitHub.
2. Inicia sesión en [netlify.com](https://www.netlify.com) y haz clic en **"Add new site" > "Import an existing project"**.
3. Selecciona tu repositorio de GitHub.
4. Netlify detectará automáticamente el archivo `netlify.toml`:
   - **Base directory:** (dejar vacío si el repo contiene directamente estos archivos, o poner `cerocosto` si subiste el proyecto completo)
   - **Publish directory:** `frontend`
   - **Functions directory:** `netlify/functions`
5. Ve a **Site configuration > Environment variables** y agrega las siguientes variables (puedes copiarlas de tu archivo `.env`):
   - `TURSO_DATABASE_URL`: `libsql://asistenciarh-13felixlopez.aws-us-east-1.turso.io`
   - `TURSO_AUTH_TOKEN`: *(tu token JWT de Turso)*
   - `JWT_SECRET`: (Tu frase secreta elegida libremente)
   - `NODE_ENV`: `production`
6. Haz clic en **"Deploy Site"** y ¡listo! En segundos tu aplicación estará en línea con HTTPS y certificado SSL gratuito.

### Opción 2: Desplegar mediante Netlify CLI
1. Instala Netlify CLI globalmente:
   ```bash
   npm install -g netlify-cli
   ```
2. Inicia sesión y despliega desde la carpeta `cerocosto`:
   ```bash
   netlify login
   netlify init
   netlify deploy --prod
   ```

---

## 🔐 Credenciales de Acceso Iniciales

Los datos semilla incluyen las cuentas listas para iniciar sesión:

| Rol | Usuario / Correo | Contraseña | Permisos |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin` ó `admin@asistencia.com` | `admin123` | Acceso global total a todas las áreas, gestión de catálogos y usuarios. |
| **Supervisor** | `supervisor` | `admin123` | Captura y consulta de asistencia en sus áreas asignadas (Producción y Secado Mecánico). |
| **Supervisor Área** | `felix` | `admin123` | Captura de asistencia únicamente en su área asignada (Secado Mecánico). |

---

## 💡 ¿Por qué es Cero Costo?
- **Netlify Free Tier:** 100 GB de ancho de banda, 125,000 invocaciones serverless al mes y 100 horas de tiempo de ejecución (suficiente para más de 10,000 registros diarios).
- **Turso Free Tier:** 9 GB de almacenamiento y 1 billón de lecturas de filas al mes.
