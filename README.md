# Sistema de Control de Asistencia de Personal por Áreas y Puestos (AsistenciaRH)

Sistema web con API REST integrada desarrollado en **Node.js + Express** con motor de plantillas **EJS + Bootstrap 5**, base de datos relacional en **Microsoft SQL Server** y soporte como **Progressive Web App (PWA)** instalable en dispositivos móviles y de escritorio.

---

## 🚀 Cambios y Mejoras Recientes

1. **Estructura Oficial Cargada desde Excel:**
   - La base de datos fue limpiada de datos ficticios y poblada con la estructura exacta de **9 Áreas** y **90 Puestos de Trabajo** provenientes de `Detalle Puestos Por Departamentos.xlsx`:
     - **Calidad** (5 puestos)
     - **Producción** (12 puestos)
     - **Almacén** (10 puestos)
     - **Embarque** (5 puestos)
     - **Recepción** (8 puestos)
     - **Secado Natural Arábico** (10 puestos)
     - **Secado Natural Robusta** (12 puestos)
     - **Secado Mecánico** (7 puestos)
     - **Administración** (21 puestos)
   - Los usuarios existentes (`admin@asistencia.com` y `supervisor.planta@asistencia.com`) fueron preservados con sus contraseñas activas.

2. **Acceso Directo al Registro Diario para Usuarios Operativos:**
   - Todo usuario que no sea Administrador o que tenga rol operativo/supervisor ingresa **directamente a la pantalla de captura de asistencia** (`/asistencias/registro`).
   - Si el usuario solo tiene una única área autorizada, el sistema la preselecciona de forma automática para que capture directamente las cantidades de su jornada sin pasos adicionales.
   - El Administrador ingresa al Panel de Control (`/dashboard`) para gestionar catálogos, usuarios y reportes globales.

3. **Interfaz Limpia y Profesional:**
   - Se removió la información técnica y las credenciales expuestas en la pantalla de inicio de sesión.
   - Se limpió el pie de página eliminando referencias a la infraestructura de base de datos o versión interna.

4. **Soporte PWA (Progressive Web App):**
   - Manifiesto [`/manifest.json`](file:///D:/Disco%20D/Proyectos/AsistenciaRH/public/manifest.json) configurado con iconos en alta resolución (`icon.svg`, `icon-192x192.png`, `icon-512x512.png`).
   - Service Worker [`/sw.js`](file:///D:/Disco%20D/Proyectos/AsistenciaRH/public/sw.js) con estrategia *Network-First* para páginas y caché local de estilos y scripts.
   - Botón automático **"Instalar App"** en la barra superior al acceder desde dispositivos móviles (Android/iOS) o navegadores compatibles (Chrome/Edge).

---

## 👥 Cuentas de Acceso

| Rol | Correo Electrónico | Contraseña | Destino al Entrar |
| :--- | :--- | :--- | :--- |
| **Administrador General** | `admin@asistencia.com` | `Admin123*` | **Panel de Control (`/dashboard`)**: Gestión de catálogo, usuarios y reportes globales. |
| **Supervisor de Área** | `supervisor.planta@asistencia.com` | `Supervisor123*` | **Registro Diario (`/asistencias/registro`)**: Directo a la captura de sus áreas autorizadas. |

---

## 🛠️ Comandos Principales

- **Iniciar la aplicación:** `npm start`
- **Modo desarrollo:** `npm run dev`
- **Reimportar o restablecer estructura desde el Excel:** `npm run seed`
