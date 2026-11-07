# Especificación de Diseño: Ubicaciones por Área, Permisos Granulares y Ambientación Visual de Patios

**Fecha**: 2026-10-29  
**Proyecto**: AsistenciaRH (Control de Asistencia de Personal)  
**Estado**: Validado con el usuario (Opción 1 aprobada)

---

## 1. Resumen Ejecutivo
El sistema actual gestiona el registro de asistencias a nivel de **Áreas** y **Puestos**. En la operación real (beneficio y secado de café), un área operativa como *Producción* se subdivide en ubicaciones como *ARÁBIGA* y *ROBUSTA*, y las áreas de secado se subdividen en diferentes *Patios*.

Este diseño incorpora:
1. **Gestión de Ubicaciones por Área**: Capacidad de crear, editar, listar y activar/desactivar ubicaciones por cada área.
2. **Registro de Asistencia por Ubicación**: Los puestos de trabajo siguen perteneciendo al área, pero la captura de asistencias se asocia a la ubicación específica (cada ubicación registra sus asistentes independientemente).
3. **Seguridad y Filtrado Granular por Usuario**: Un usuario supervisor solo puede ver y operar en las áreas y ubicaciones que tiene explícitamente autorizadas en el sistema.
4. **Ambientación Visual y Carrusel de Fotos**: Integración de las fotos de patios y cosecha en un carrusel dinámico en el Login y banners en el Dashboard, reflejando el proceso productivo del café.

---

## 2. Modelo de Datos (SQL Server)

### 2.1 Nueva Tabla: `Ubicaciones`
```sql
CREATE TABLE Ubicaciones (
    id_ubicacion INT IDENTITY(1,1) PRIMARY KEY,
    id_area INT NOT NULL FOREIGN KEY REFERENCES Areas(id_area) ON DELETE CASCADE,
    codigo VARCHAR(30) NOT NULL,
    nombre NVARCHAR(100) NOT NULL,
    descripcion NVARCHAR(255) NULL,
    activa BIT NOT NULL DEFAULT 1,
    fecha_creacion DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_Area_Ubicacion_Nombre UNIQUE (id_area, nombre),
    CONSTRAINT UQ_Area_Ubicacion_Codigo UNIQUE (id_area, codigo)
);
```

### 2.2 Nueva Tabla: `Usuario_Ubicaciones`
Permite definir a qué ubicaciones específicas tiene acceso un usuario dentro de sus áreas autorizadas.
```sql
CREATE TABLE Usuario_Ubicaciones (
    id_usuario_ubicacion INT IDENTITY(1,1) PRIMARY KEY,
    id_usuario INT NOT NULL FOREIGN KEY REFERENCES Usuarios(id_usuario) ON DELETE CASCADE,
    id_ubicacion INT NOT NULL FOREIGN KEY REFERENCES Ubicaciones(id_ubicacion) ON DELETE CASCADE,
    fecha_asignacion DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_Usuario_Ubicacion UNIQUE (id_usuario, id_ubicacion)
);
```

### 2.3 Modificación a `Asistencias_Diarias`
Agregar columna `id_ubicacion` nullable (para mantener compatibilidad con históricos):
```sql
ALTER TABLE Asistencias_Diarias ADD id_ubicacion INT NULL FOREIGN KEY REFERENCES Ubicaciones(id_ubicacion);

-- Ajuste de la restricción de unicidad para contemplar la ubicación:
-- En SQL Server se elimina el UQ_Fecha_Puesto_Turno anterior y se crea un índice único que incluya la ubicación.
IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_Fecha_Puesto_Turno' AND object_id = OBJECT_ID('Asistencias_Diarias'))
BEGIN
    ALTER TABLE Asistencias_Diarias DROP CONSTRAINT UQ_Fecha_Puesto_Turno;
END;

-- Columna calculada para manejar unicidad con o sin ubicación (NULL coalesce a 0)
ALTER TABLE Asistencias_Diarias ADD id_ubicacion_seguro AS ISNULL(id_ubicacion, 0) PERSISTED;
CREATE UNIQUE INDEX UQ_Fecha_Puesto_Turno_Ubicacion ON Asistencias_Diarias(fecha, id_puesto, turno, id_ubicacion_seguro);
```

---

## 3. Lógica de Negocio y Reglas de Permisos

1. **Administradores (`ADMIN`)**:
   - Tienen acceso irrestricto a todas las áreas y a todas sus ubicaciones.
   - Pueden crear, editar y eliminar asignaciones de áreas y ubicaciones para cualquier usuario.
   - Pueden ver y editar registros de asistencia en cualquier área y ubicación.

2. **Supervisores y Consultores**:
   - Solo pueden ver las áreas que tienen asignadas en `Usuario_Areas`.
   - Si un área asignada tiene ubicaciones creadas:
     - Solo pueden ver y registrar en las ubicaciones que tienen asignadas en `Usuario_Ubicaciones`.
     - Si no tienen ninguna ubicación asignada para esa área, no tienen acceso a registrar en esa área hasta que el administrador les asigne su ubicación correspondiente.
   - Si el área NO tiene ubicaciones creadas (ej. *Administración* o *Calidad* si no se han desglosado):
     - Operan a nivel de área general como hasta ahora (`id_ubicacion = NULL`).

3. **Captura de Asistencia**:
   - En `/asistencias/registro`:
     - El usuario selecciona el Área.
     - Si el área tiene ubicaciones asignadas al usuario, se despliega el selector de Ubicación.
     - Si el usuario solo tiene una ubicación asignada para esa área, se preselecciona automáticamente.
     - El formulario carga los puestos activos del área y permite registrar la cantidad por turno para esa fecha y ubicación.

---

## 4. Gestión de Ubicaciones en la Interfaz
1. **En Catálogo de Áreas (`/areas`)**:
   - Cada fila de área incluirá un botón y contador de **Ubicaciones** (ej. `2 ubicaciones`).
   - Modal o vista de gestión para:
     - Listar ubicaciones del área.
     - Crear nueva ubicación (código, nombre, descripción).
     - Modificar estado (Activa / Inactiva) o editar nombre.
2. **En Catálogo de Usuarios (`/usuarios/nuevo` y `/usuarios/editar/:id`)**:
   - Al seleccionar un área asignada, se despliegan en acordeón o checkboxes las ubicaciones disponibles de esa área para marcar con precisión cuáles puede operar el usuario.

---

## 5. Diseño Visual y Carrusel de Fotos de Patios
1. **Archivos de Imágenes**:
   - Copiar imágenes desde `Fotos patio/` hacia `public/img/fotos-patio/` con nomenclatura limpia y optimizada para web.
2. **Pantalla de Login (`/auth/login`)**:
   - Diseño moderno Split Layout (dos columnas en escritorio):
     - **Lado izquierdo**: Carrusel de fotos en alta resolución con superposición degradada, mostrando el proceso completo del café (fincas de Jinotega, cosecha manual, patios de secado y colaboradores) con leyendas descriptivas ("Cosecha de Café Especial", "Secado Tradicional en Patios", "Compromiso y Mano de Obra").
     - **Lado derecho**: Tarjeta de login con identidad visual de la marca, logotipo y campos claros.
   - En dispositivos móviles: diseño responsive vertical optimizado.
3. **Dashboard Principal (`/dashboard`)**:
   - Carrusel o galería de tarjetas visuales en la cabecera mostrando el proceso de beneficiado y secado en patios, aportando dinamismo visual a la plataforma.

---

## 6. Plan de Verificación y Pruebas
1. **Migración de Base de Datos**:
   - Script SQL ejecutado sin errores, verificando integridad de las 200 asistencias existentes.
2. **Catálogo de Ubicaciones**:
   - Crear ubicaciones de prueba: *ARÁBIGA* y *ROBUSTA* en el área *Producción*; *Patio 1* y *Patio 2* en *Secado Natural Arábico*.
3. **Permisos de Usuario**:
   - Crear o modificar un usuario de prueba asignándole únicamente *Producción - ARÁBIGA*.
   - Iniciar sesión con ese usuario y verificar que:
     - No puede ver ni seleccionar *Producción - ROBUSTA*.
     - No puede ver áreas no asignadas.
     - El administrador ve todas las áreas y ubicaciones.
4. **Registro y Reportes**:
   - Guardar asistencias en *Producción - ARÁBIGA* y en *Producción - ROBUSTA* para los mismos puestos sin colisiones.
   - Comprobar que en Reportes y en el Historial se puede filtrar por Ubicación.
5. **Comprobación Visual**:
   - Carga correcta del carrusel en Login y Dashboard sin imágenes rotas.
