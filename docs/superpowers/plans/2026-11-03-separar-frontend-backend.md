# Plan de Implementación: Separación de Frontend (Netlify) y Backend (Servidor Propio)

> **Goal:** Separar el monolito actual en una API REST en Node.js/Express para el servidor propio y un Frontend estático en HTML5/Bootstrap 5/JS idéntico al actual para desplegar en Netlify.
>
> **Architecture:**
> - `backend/`: API Express RESTful con autenticación JWT, CORS habilitado, controladores que retornan JSON y conexión persistente a SQL Server.
> - `frontend/`: Archivos estáticos (HTML, CSS, JS, imágenes, PWA) que consumen la API mediante `api.js` y renderizan la interfaz con exactamente el mismo diseño visual, listos para Netlify.
>
> **Tech Stack:** Node.js, Express, mssql, jsonwebtoken, bcryptjs, cors, Bootstrap 5.3, SweetAlert2, Chart.js, Netlify.

---

## Tareas de Implementación

### Fase 1: Estructuración del Proyecto y Preparación de Carpetas
- [ ] Crear las carpetas `backend/` y `frontend/`.
- [ ] Mover/copiar el código del servidor (`config/`, `controllers/`, `middlewares/`, `routes/`, `services/`, `database/`, `.env`, `package.json`) a `backend/`.
- [ ] Mover/copiar los recursos estáticos (`public/css/`, `public/js/`, `public/img/`, `public/icons/`, `manifest.json`, `sw.js`) a `frontend/`.
- [ ] Instalar `jsonwebtoken` en `backend/package.json` y remover dependencias de renderizado (`ejs`, `express-ejs-layouts`, `connect-flash`).

### Fase 2: Transformación del Backend a API REST con JWT
- [ ] **Configuración de CORS y Variables de Entorno (`backend/.env`, `backend/app.js`):**
  - Configurar `CORS_ORIGIN` para permitir `http://localhost:*` y el dominio de Netlify.
  - Añadir `JWT_SECRET` y tiempo de expiración.
- [ ] **Middleware de Autenticación JWT (`backend/middlewares/auth.js`):**
  - Implementar verificación de token Bearer en `Authorization: Bearer <token>`.
  - Adaptar `isAuthenticated` y `isAdmin` para responder con códigos HTTP 401 y 403 en formato JSON.
- [ ] **Controlador y Rutas de Autenticación (`backend/controllers/authController.js`, `backend/routes/authRoutes.js`):**
  - `POST /api/auth/login`: Valida credenciales, genera y retorna token JWT y datos de usuario.
  - `GET /api/auth/me`: Retorna los datos del usuario autenticado actual.
  - `PUT /api/auth/perfil`: Actualiza nombre, correo y contraseña.
- [ ] **Adaptar Controladores a JSON (`backend/controllers/*`):**
  - `dashboardController.js`: Retornar métricas, áreas permitidas, últimos registros y datos para gráficos en JSON.
  - `asistenciaController.js`: Endpoints para obtener datos de la jornada actual (áreas, puestos, estado de bloqueo) y guardar registros.
  - `historialController` / `reporteController.js`: Consultas de historial y reportes en JSON, y descarga de Excel mediante endpoint API.
  - `areaController.js`, `puestoController.js`, `ubicacionController.js`, `usuarioController.js`: CRUDs completos respondiendo `{ success: true, data: [...] }`.
- [ ] **Limpieza de `backend/app.js`:**
  - Exponer rutas bajo el prefijo `/api/`.
  - Eliminar motor EJS, express-session y vistas del backend.

### Fase 3: Construcción del Frontend Estático para Netlify
- [ ] **Cliente de API y Configuración (`frontend/js/config.js` y `frontend/js/api.js`):**
  - Configurar `API_BASE_URL` configurable según entorno (local vs servidor de producción).
  - Wrapper de `fetch` que adjunta automáticamente el token `Authorization: Bearer <token>`, maneja redirección al login ante 401 y parsea JSON.
- [ ] **Componentes Compartidos (`frontend/js/layout.js`):**
  - Función `renderLayout(activePage)` que inyecta el `navbar`, `sidebar` y `footer` con el usuario logueado y control de visibilidad por rol (ADMIN vs Supervisor), manteniendo el 100% del HTML y CSS actual.
- [ ] **Páginas HTML Estáticas (conservando diseño original exacto):**
  - `frontend/index.html`: Redirección inteligente (a `dashboard.html` o `login.html`).
  - `frontend/login.html`: Pantalla de login actual con fondo carrusel de patios, validación y almacenamiento de token en `localStorage`.
  - `frontend/dashboard.html`: Panel de control, tarjetas KPI, accesos directos y gráfico Chart.js alimentado vía API.
  - `frontend/asistencias-registro.html`: Formulario de captura rápida con botones táctiles (+/-), soporte de turnos, ubicaciones y barra fija inferior.
  - `frontend/asistencias-historial.html`: Tabla de historial con filtros de fecha y área.
  - `frontend/reportes.html`: Filtros por rango de fechas, áreas, turnos, gráficos interactivos y botón de exportar Excel.
  - `frontend/areas.html`: Catálogo de áreas con modales de creación/edición.
  - `frontend/puestos.html`: Catálogo de puestos con asignación de turnos.
  - `frontend/usuarios.html`: Gestión de usuarios, roles y asignación de áreas/ubicaciones.
  - `frontend/perfil.html`: Actualización de perfil y cambio de contraseña.
- [ ] **Archivo de Configuración para Netlify (`frontend/netlify.toml`):**
  - Headers de seguridad, caché para estáticos y reglas de redirección.

### Fase 4: Verificación y Pruebas Locales
- [ ] Iniciar el backend en `http://localhost:3000` y verificar conectividad a SQL Server.
- [ ] Servir el frontend con un servidor estático local y probar el flujo completo:
  - Login con usuario normal y con Administrador.
  - Registro de asistencia y bloqueo de puestos guardados.
  - Consulta de Dashboard y Reportes.
  - Cierre de sesión.
- [ ] Verificar que no haya errores de CORS ni referencias a rutas inexistentes.
