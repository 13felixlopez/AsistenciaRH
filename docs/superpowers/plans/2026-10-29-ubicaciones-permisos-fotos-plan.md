# Plan de Implementación: Ubicaciones por Área, Permisos Granulares y Ambientación Visual de Patios

**Meta**: Implementar la gestión de ubicaciones por área, filtrado de permisos de usuario a nivel de área y ubicación, registro de asistencia por ubicación y carrusel visual de fotos de patios y cosecha en el login y dashboard.  
**Arquitectura**: Base de datos relacional en SQL Server (tablas `Ubicaciones`, `Usuario_Ubicaciones` y ajuste de `Asistencias_Diarias`), backend Express con middlewares de permisos granulares y rutas de gestión, vistas EJS con Bootstrap 5.3 para gestión modal, selectores dependientes y carrusel responsivo.  
**Stack**: Node.js, Express, SQL Server (mssql), EJS, Bootstrap 5.3, Bootstrap Icons.

---

### Tareas de Implementación

- [x] **Fase 1: Base de Datos y Migración SQL Server**
  - [x] Crear script `database/migration_ubicaciones_y_permisos.sql` con creación de `Ubicaciones`, `Usuario_Ubicaciones`, adición de `id_ubicacion` e índice único en `Asistencias_Diarias`.
  - [x] Crear script de ejecución `database/runMigration.js` para aplicar el cambio a `AsistenciaRH_DB` preservando datos históricos.
  - [x] Ejecutar la migración y registrar ubicaciones iniciales para Producción (*ARÁBIGA*, *ROBUSTA*) y Patios de secado.
  - [x] Verificar la estructura de las tablas e índices en SQL Server.

- [x] **Fase 2: Organización de Fotos y Diseño Visual (Login & Dashboard)**
  - [x] Crear directorio `public/img/fotos-patio/`.
  - [x] Copiar y renombrar las imágenes de `Fotos patio/` a nombres estandarizados en `public/img/fotos-patio/`.
  - [x] Rediseñar `views/auth/login.ejs` y `views/layouts/auth.ejs` con un Split Layout moderno y carrusel automático Bootstrap con leyendas del proceso cafetalero.
  - [x] Agregar carrusel/banner en `views/dashboard/index.ejs` con las imágenes de patios y beneficios.
  - [x] Verificar visualmente la renderización en navegador.

- [x] **Fase 3: Gestión de Ubicaciones por Área (Backend & Frontend)**
  - [x] Crear endpoints en backend (`controllers/ubicacionController.js` y `routes/ubicacionRoutes.js`):
    - `GET /api/areas/:id/ubicaciones` (listado JSON de ubicaciones activas del área)
    - `POST /ubicaciones/crear` (crear nueva ubicación)
    - `POST /ubicaciones/editar` (actualizar nombre/código/descripción)
    - `POST /ubicaciones/toggle/:id` (activar/desactivar)
  - [x] Conectar rutas en `app.js`.
  - [x] Actualizar `views/areas/index.ejs` para mostrar el botón de Ubicaciones en cada área y un modal de administración completo para agregar/editar ubicaciones sin salir de la vista.

- [x] **Fase 4: Permisos Granulares por Usuario (Áreas y Ubicaciones)**
  - [x] Extender `middlewares/auth.js` con `getUserAllowedLocations(userId, userRole, areaId)` y `hasLocationAccess(userId, userRole, areaId, locationId)`.
  - [x] Modificar `controllers/usuarioController.js` (`showCreateUser`, `createUser`, `showEditUser`, `updateUser`):
    - Obtener todas las áreas con sus ubicaciones disponibles.
    - Guardar y actualizar asociaciones en `Usuario_Ubicaciones`.
  - [x] Modificar `views/usuarios/create.ejs` y `views/usuarios/edit.ejs` con interfaz jerárquica (Área $\rightarrow$ checkboxes de Ubicaciones) para asignar permisos detallados.
  - [x] Modificar `views/usuarios/index.ejs` para mostrar las ubicaciones asignadas.

- [x] **Fase 5: Registro Diario de Asistencia por Ubicación**
  - [x] Modificar `controllers/asistenciaController.js`:
    - `showRegistroForm`: filtrar áreas y ubicaciones según el usuario autenticado. Cargar puestos y asistencias filtrados por `id_area` e `id_ubicacion`.
    - `saveAsistencias`: recibir `id_ubicacion`, validar permisos y guardar/actualizar en `Asistencias_Diarias` con la clave `(fecha, id_puesto, turno, id_ubicacion)`.
  - [x] Modificar `views/asistencias/registro.ejs`:
    - Agregar selector en cascada de Ubicación cuando el área seleccionada tenga ubicaciones activas.
    - Pasar `id_ubicacion` al registrar y preseleccionar si solo tiene una autorizada.

- [x] **Fase 6: Historial, Reportes y Dashboard con Filtro de Ubicación**
  - [x] Actualizar `controllers/asistenciaController.js` (`listHistorial`) para admitir filtro de `ubicacionId` y mostrar la columna de Ubicación.
  - [x] Actualizar `views/asistencias/historial.ejs` con selector de Ubicación y badge en la tabla.
  - [x] Actualizar `controllers/reporteController.js` y `views/reportes/index.ejs` para incluir filtro y desglose por Ubicación en reportes y exportación Excel.
  - [x] Actualizar `controllers/dashboardController.js` y `views/dashboard/index.ejs` para mostrar ubicaciones en los registros recientes.

- [x] **Fase 7: Verificación Integral y Pruebas**
  - [x] Prueba de login con carrusel responsivo y verificación de entrega HTTP 200 de las 6 fotos de patios.
  - [x] Prueba de endpoints y seguridad de sesión en APIs.
  - [x] Prueba con usuario administrador: ve todas las áreas y ubicaciones.
  - [x] Prueba con supervisor asignado exclusivamente a *Producción - ARÁBIGA*: comprobado que tiene acceso a *ARÁBIGA* y queda bloqueado para *ROBUSTA*.
  - [x] Prueba de registro concurrente: inserción simultánea en *ARÁBIGA* y en *ROBUSTA* para el mismo puesto y fecha sin colisiones.
