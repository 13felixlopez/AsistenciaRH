-- =====================================================================
-- ESQUEMA COMPLETO PARA TURSO (SQLite / libSQL)
-- Sistema: Control de Asistencia RH
-- =====================================================================

PRAGMA foreign_keys = ON;

-- 1. Tabla: Roles
CREATE TABLE IF NOT EXISTS Roles (
    id_rol INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    activo INTEGER NOT NULL DEFAULT 1
);

-- 2. Tabla: Areas
CREATE TABLE IF NOT EXISTS Areas (
    id_area INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    activa INTEGER NOT NULL DEFAULT 1,
    fecha_creacion TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 3. Tabla: Ubicaciones (subdivisiones o patios dentro de un área)
CREATE TABLE IF NOT EXISTS Ubicaciones (
    id_ubicacion INTEGER PRIMARY KEY AUTOINCREMENT,
    id_area INTEGER NOT NULL,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    activa INTEGER NOT NULL DEFAULT 1,
    fecha_creacion TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (id_area) REFERENCES Areas(id_area) ON DELETE CASCADE
);

-- 4. Tabla: Puestos de Trabajo
CREATE TABLE IF NOT EXISTS Puestos (
    id_puesto INTEGER PRIMARY KEY AUTOINCREMENT,
    id_area INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    aplica_turnos INTEGER NOT NULL DEFAULT 0,
    fecha_creacion TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (id_area) REFERENCES Areas(id_area) ON DELETE CASCADE
);

-- 5. Tabla: Usuarios
CREATE TABLE IF NOT EXISTS Usuarios (
    id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
    id_rol INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    cargo TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    fecha_creacion TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ultimo_acceso TEXT,
    FOREIGN KEY (id_rol) REFERENCES Roles(id_rol)
);

-- 6. Tabla: Usuario_Areas (Asignación de áreas a usuarios)
CREATE TABLE IF NOT EXISTS Usuario_Areas (
    id_usuario_area INTEGER PRIMARY KEY AUTOINCREMENT,
    id_usuario INTEGER NOT NULL,
    id_area INTEGER NOT NULL,
    permite_registro INTEGER NOT NULL DEFAULT 1,
    permite_reportes INTEGER NOT NULL DEFAULT 1,
    fecha_asignacion TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_area) REFERENCES Areas(id_area) ON DELETE CASCADE,
    UNIQUE(id_usuario, id_area)
);

-- 7. Tabla: Usuario_Ubicaciones (Asignación de ubicaciones específicas)
CREATE TABLE IF NOT EXISTS Usuario_Ubicaciones (
    id_usuario_ubicacion INTEGER PRIMARY KEY AUTOINCREMENT,
    id_usuario INTEGER NOT NULL,
    id_ubicacion INTEGER NOT NULL,
    fecha_asignacion TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_ubicacion) REFERENCES Ubicaciones(id_ubicacion) ON DELETE CASCADE,
    UNIQUE(id_usuario, id_ubicacion)
);

-- 8. Tabla: Asistencias_Diarias (Captura diaria por puesto, turno y fecha)
CREATE TABLE IF NOT EXISTS Asistencias_Diarias (
    id_asistencia INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    id_puesto INTEGER NOT NULL,
    id_ubicacion INTEGER,
    turno TEXT NOT NULL DEFAULT 'UNICO',
    cantidad_asistentes INTEGER NOT NULL DEFAULT 0,
    observaciones TEXT,
    id_usuario_registro INTEGER,
    fecha_registro TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    fecha_modificacion TEXT,
    FOREIGN KEY (id_puesto) REFERENCES Puestos(id_puesto) ON DELETE CASCADE,
    FOREIGN KEY (id_ubicacion) REFERENCES Ubicaciones(id_ubicacion) ON DELETE SET NULL,
    FOREIGN KEY (id_usuario_registro) REFERENCES Usuarios(id_usuario) ON DELETE SET NULL
);

-- Índices de Rendimiento y Clave Única para evitar duplicados en la misma jornada
CREATE UNIQUE INDEX IF NOT EXISTS UQ_Asistencia_Slot 
ON Asistencias_Diarias (fecha, id_puesto, turno, COALESCE(id_ubicacion, 0));

CREATE INDEX IF NOT EXISTS IX_Asistencias_Fecha ON Asistencias_Diarias(fecha);
CREATE INDEX IF NOT EXISTS IX_Puestos_Area ON Puestos(id_area);
CREATE INDEX IF NOT EXISTS IX_Ubicaciones_Area ON Ubicaciones(id_area);
