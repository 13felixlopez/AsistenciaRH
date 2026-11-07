# Bitácora de Estado del Proyecto: Registro de Asistencia
**Fecha de corte:** 24 de Octubre de 2026
**Servidor Base de Datos:** SQL Server 2022 en `192.168.88.250:1433` (Instancia Secado / BD `AsistenciaRH_DB`) y réplica local `localhost\FELIXLOP`
**Puerto local configurado:** `3031`

---

## 🎨 Identidad Visual y Paleta de Colores Oficial

- **Nombre Oficial del Sistema:** **Registro de Asistencia**
- **Paleta de Colores Implementada:**
  - **Purple (Color Primario / Marca):** Base `#860063` | 60% `#B766A2`
  - **Orange (Turno 1 / Alertas / Acentos):** Base `#F88D2A` | 60% `#FBBB7F`
  - **Hibiscus (Peligro / Admin / Errores):** Base `#D83548` | 60% `#E68792`
  - **Blue (Turno 2 / Información / Datos):** Base `#7373C0` | 60% `#B4B0D6`
  - **Vibrant Green (Éxito / Guardado / Asistentes):** Base `#6DBA00` | 60% `#A8D666`
  - **Teal (Métricas / Resúmenes / Totales):** Base `#00A5B5` | 60% `#61C5B8`

---

## 📌 Resumen de lo realizado hasta hoy

1. **Estructura y Limpieza de Base de Datos:**
   - 9 Áreas y 90 Puestos de Trabajo importados desde el Excel oficial (`database/Detalle  Puestos Por Departamentos.xlsx`).
   - Usuarios operativos y administradores con control de acceso por roles.

2. **Flujo de Usuario y Roles:**
   - Supervisores acceden directo a la captura de asistencia (`/asistencias/registro`) con su área preseleccionada.
   - Administradores acceden al Dashboard general.

3. **Soporte PWA y Experiencia Móvil:**
   - Service Worker y Manifest configurados para instalación nativa (PWA).
   - Ergonomía táctil con botones grandes (+/-), selección rápida de valores y barra fija (*sticky bottom bar*).
   - Logotipos e iconos oficiales integrados.

4. **Soporte Dinámico de Turnos por Puesto:**
   - En la tabla `Puestos`, se incorporó el campo `aplica_turnos BIT DEFAULT 0`.
   - Se analizaron las observaciones del Excel y se detectaron 10 puestos que operan con turnos múltiples (`Obs = 'Si'`).
   - En la gestión de puestos (`/puestos`), se añadió la opción tanto al crear un nuevo puesto como al editar cualquier puesto existente para activar o desactivar múltiples turnos (`aplica_turnos`).
   - En `Asistencias_Diarias`, se incorporó la columna `turno VARCHAR(20) DEFAULT 'UNICO'` y la clave única compuesta `UQ_Fecha_Puesto_Turno (fecha, id_puesto, turno)`.
   - Puestos con `aplica_turnos = 1` generan **2 registros por día** (`Turno 1` y `Turno 2`), mientras que puestos regulares generan 1 registro (`Turno Único`).

5. **Protección de Datos y Bloqueo de Jornada (Solo Admin Edita):**
   - Una vez que un supervisor guarda la asistencia, los puestos y turnos guardados quedan bloqueados en **modo solo lectura (🔒)**.
   - **Solo un usuario con rol `ADMIN` puede modificar o editar registros ya guardados**.
   - En el backend (`saveAsistencias`), se valida estrictamente el rol del usuario: si un supervisor envía datos para un puesto/turno que ya existe, el servidor ignora la modificación y preserva el registro original.

6. **Captura Asíncrona Parcial:**
   - Si un supervisor registra el área por la mañana y deja puestos o turnos vacíos (como el Turno 2), lo guardado se protege y los puestos vacíos quedan disponibles para ser capturados más tarde en el día sin sobreescribir lo previo.

7. **Filtro Estricto de Áreas y Rol de Solo Vista:**
   - **Filtro por asignación:** El combobox de áreas en Captura de Asistencia, Historial y Reportes ahora filtra estrictamente según las áreas asignadas al usuario (`Usuario_Areas`). Si un usuario solo tiene 1 área autorizada, se muestra únicamente esa área (preseleccionada de forma directa).
   - **Rol de Solo Vista (`CONSULTOR` / ID: 3):**
     - Usuarios con este rol son asignados a sus áreas correspondientes con `permite_registro = 0` y `permite_reportes = 1`.
     - No pueden capturar, editar ni eliminar información de asistencias, áreas, puestos ni usuarios.
     - Rutas `/asistencias/registro` y `POST /asistencias/guardar` bloqueadas con 403 / redirección a Reportes.
     - Botones y enlaces de "Capturar Asistencia" y "Registrar Asistencia" ocultos en Navbar y Sidebar.
     - Al iniciar sesión, son redirigidos directamente al módulo de Reportes de sus áreas asignadas.


7. **Autocompletado Inteligente con 0 al Siguiente Día:**
   - Servicio automatizado `services/asistenciaService.js`:
     - Al iniciar el servidor, al consultar fechas pasadas o mediante chequeo periódico cada 30 minutos:
     - Cualquier puesto o turno activo que haya quedado `NULL` (sin registrar) en una fecha anterior a la actual (`fecha < hoy`), se **autocompleta automáticamente con 0 asistentes** (`Cierre automático de jornada (0 asistentes)`).
     - De esta forma se garantiza integridad contable y de reportes al 100%.

8. **Restricción Estricta de Captura Exclusiva al Día Actual:**
   - Se bloqueó tanto a nivel visual (`readonly` con `min/max = hoy`) como a nivel de controlador (`showRegistroForm` y `saveAsistencias`) la captura de días pasados y futuros.
   - Las fechas pasadas solo pueden consultarse mediante el Historial y los Reportes.

9. **Sincronización Exacta de Hora y Zona Horaria:**
   - Se corrigió el desfase horario configurando `useUTC: false` en `config/db.js` y formateando directamente desde SQL Server con `FORMAT(ad.fecha_registro, 'dd/MM/yyyy hh:mm tt')` y `FORMAT(ad.fecha_registro, 'hh:mm tt')`.
   - La hora mostrada en el Dashboard, Historial y Reportes coincide 100% con la hora real local en que se ejecutó el registro.

10. **Corrección de Cierre Prematuro en 0 y Estado Pendiente Limpio:**
   - Se detectó que `services/asistenciaService.js` comparaba contra `CAST(GETDATE() AS DATE)` de SQL Server, el cual opera en UTC (+6 horas respecto a la hora local). A partir de las 6:00 PM locales, SQL Server ya estaba en la fecha de mañana, provocando que los puestos o Turno 2 no capturados del día se rellenaran anticipadamente con 0 y quedaran bloqueados.
   - Se corrigió pasando la fecha local del sistema (`@fechaHoyLocal` obtenido con `getLocalDateStr()`) a la consulta SQL, asegurando que la jornada del día actual jamás sea cerrada con 0 mientras sea el día actual local.
   - Se eliminó el `placeholder="0"` confuso en las vistas (`registro.ejs` y `asistencias-registro.html`), dejándolo en blanco para puestos no capturados con su badge correspondiente en "Pendiente", permitiendo que supervisores guarden Turno 1 por la mañana y capturen Turno 2 más tarde sin bloqueo.

---

## 🛠️ Scripts y Migraciones Creadas

1. `database/update_turnos_schema.sql`: Script DDL para aplicar las columnas `aplica_turnos`, `turno` y la clave única `UQ_Fecha_Puesto_Turno`.
2. `database/syncPuestosTurnos.js`: Script para sincronizar las observaciones del Excel (`Obs = 'Si'`) con la base de datos sin borrar registros existentes.
3. `services/asistenciaService.js`: Motor de autocompletado atómico en SQL Server para cierre de jornadas pasadas en 0.
