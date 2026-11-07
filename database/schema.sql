-- ==============================================================================
-- Script de Base de Datos para Sistema de Asistencia de Personal por Área y Puestos
-- Motor: Microsoft SQL Server 2016+
-- ==============================================================================

USE master;
GO

-- Crear Base de Datos si no existe
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'AsistenciaRH_DB')
BEGIN
    CREATE DATABASE AsistenciaRH_DB;
    PRINT 'Base de datos AsistenciaRH_DB creada exitosamente.';
END
ELSE
BEGIN
    PRINT 'La base de datos AsistenciaRH_DB ya existe.';
END
GO

USE AsistenciaRH_DB;
GO

-- 1. Tabla de Roles
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Roles')
BEGIN
    CREATE TABLE Roles (
        id_rol INT IDENTITY(1,1) PRIMARY KEY,
        codigo VARCHAR(20) NOT NULL UNIQUE,       -- 'ADMIN', 'SUPERVISOR', 'CONSULTOR'
        nombre NVARCHAR(50) NOT NULL,
        descripcion NVARCHAR(200) NULL,
        activo BIT NOT NULL DEFAULT 1
    );
    PRINT 'Tabla Roles creada.';
END
GO

-- 2. Tabla de Usuarios
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Usuarios')
BEGIN
    CREATE TABLE Usuarios (
        id_usuario INT IDENTITY(1,1) PRIMARY KEY,
        id_rol INT NOT NULL FOREIGN KEY REFERENCES Roles(id_rol),
        nombre NVARCHAR(100) NOT NULL,
        usuario VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(120) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        cargo NVARCHAR(100) NULL,
        activo BIT NOT NULL DEFAULT 1,
        fecha_creacion DATETIME NOT NULL DEFAULT GETDATE(),
        ultimo_acceso DATETIME NULL
    );
    PRINT 'Tabla Usuarios creada.';
END
GO

-- 3. Tabla de Áreas
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Areas')
BEGIN
    CREATE TABLE Areas (
        id_area INT IDENTITY(1,1) PRIMARY KEY,
        codigo VARCHAR(20) NOT NULL UNIQUE,
        nombre NVARCHAR(100) NOT NULL,
        descripcion NVARCHAR(255) NULL,
        activa BIT NOT NULL DEFAULT 1,
        fecha_creacion DATETIME NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Tabla Areas creada.';
END
GO

-- 4. Tabla de Puestos (Pertenecen a un Área específica)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Puestos')
BEGIN
    CREATE TABLE Puestos (
        id_puesto INT IDENTITY(1,1) PRIMARY KEY,
        id_area INT NOT NULL FOREIGN KEY REFERENCES Areas(id_area) ON DELETE CASCADE,
        nombre NVARCHAR(100) NOT NULL,
        descripcion NVARCHAR(255) NULL,
        aplica_turnos BIT NOT NULL DEFAULT 0,     -- 0 = Turno único, 1 = Aplica múltiples turnos (Turno 1 y 2)
        activo BIT NOT NULL DEFAULT 1,
        fecha_creacion DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_Puesto_Area_Nombre UNIQUE (id_area, nombre)
    );
    PRINT 'Tabla Puestos creada.';
END
GO

-- 5. Tabla de Asignación de Áreas a Usuarios (Permisos granulares)
-- Define qué áreas puede ver/registrar un usuario supervisor o consultor.
-- Los administradores (id_rol ADMIN) tienen acceso total implícito.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Usuario_Areas')
BEGIN
    CREATE TABLE Usuario_Areas (
        id_usuario_area INT IDENTITY(1,1) PRIMARY KEY,
        id_usuario INT NOT NULL FOREIGN KEY REFERENCES Usuarios(id_usuario) ON DELETE CASCADE,
        id_area INT NOT NULL FOREIGN KEY REFERENCES Areas(id_area) ON DELETE CASCADE,
        permite_registro BIT NOT NULL DEFAULT 1,
        permite_reportes BIT NOT NULL DEFAULT 1,
        fecha_asignacion DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_Usuario_Area UNIQUE (id_usuario, id_area)
    );
    PRINT 'Tabla Usuario_Areas creada.';
END
GO

-- 6. Tabla de Registro Diario de Asistencia por Puesto
-- Cada registro almacena la cantidad de personas que asistieron en una fecha para un puesto determinado y turno
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Asistencias_Diarias')
BEGIN
    CREATE TABLE Asistencias_Diarias (
        id_asistencia INT IDENTITY(1,1) PRIMARY KEY,
        fecha DATE NOT NULL,
        id_puesto INT NOT NULL FOREIGN KEY REFERENCES Puestos(id_puesto),
        turno VARCHAR(20) NOT NULL DEFAULT 'UNICO',   -- 'UNICO', 'TURNO_1', 'TURNO_2'
        cantidad_asistentes INT NOT NULL DEFAULT 0,
        observaciones NVARCHAR(500) NULL,
        id_usuario_registro INT NOT NULL FOREIGN KEY REFERENCES Usuarios(id_usuario),
        fecha_registro DATETIME NOT NULL DEFAULT GETDATE(),
        fecha_modificacion DATETIME NULL,
        id_usuario_modificacion INT NULL FOREIGN KEY REFERENCES Usuarios(id_usuario),
        CONSTRAINT UQ_Fecha_Puesto_Turno UNIQUE (fecha, id_puesto, turno),
        CONSTRAINT CHK_Cantidad_No_Negativa CHECK (cantidad_asistentes >= 0)
    );
    PRINT 'Tabla Asistencias_Diarias creada.';
END
GO

-- Índices para optimizar reportes por fecha y área
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Asistencias_Fecha' AND object_id = OBJECT_ID('Asistencias_Diarias'))
BEGIN
    CREATE INDEX IX_Asistencias_Fecha ON Asistencias_Diarias(fecha);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Puestos_Area' AND object_id = OBJECT_ID('Puestos'))
BEGIN
    CREATE INDEX IX_Puestos_Area ON Puestos(id_area);
END
GO

-- ==============================================================================
-- INSERCIÓN DE DATOS INICIALES (SEMILLA)
-- ==============================================================================

-- Roles base
IF NOT EXISTS (SELECT 1 FROM Roles WHERE codigo = 'ADMIN')
    INSERT INTO Roles (codigo, nombre, descripcion) VALUES ('ADMIN', 'Administrador General', 'Acceso irrestricto a todas las áreas, gestión de usuarios, catálogos y reportes.');

IF NOT EXISTS (SELECT 1 FROM Roles WHERE codigo = 'SUPERVISOR')
    INSERT INTO Roles (codigo, nombre, descripcion) VALUES ('SUPERVISOR', 'Supervisor / Registrador de Área', 'Acceso para registrar asistencia y ver reportes exclusivamente de sus áreas asignadas.');

IF NOT EXISTS (SELECT 1 FROM Roles WHERE codigo = 'CONSULTOR')
    INSERT INTO Roles (codigo, nombre, descripcion) VALUES ('CONSULTOR', 'Consultor / Auditor', 'Acceso de solo lectura y reportes a sus áreas asignadas.');
GO

-- Usuario Administrador Inicial
-- Contraseña predeterminada: Admin123* (Hash bcrypt con 10 salt rounds)
-- Hash generado: $2b$10$wE47.nLqfS/6Xn5W6Zp87exyv.j1o4b0N7pA9YmUf76S6s2F5X26O o el que asignaremos
-- Para garantizar coincidencia exacta, se insertará o actualizará mediante el script de seed de Node.js o el script siguiente.
DECLARE @idAdminRol INT = (SELECT id_rol FROM Roles WHERE codigo = 'ADMIN');

IF NOT EXISTS (SELECT 1 FROM Usuarios WHERE email = 'admin@asistencia.com')
BEGIN
    -- Hash para contraseña: Admin123* (bcrypt genSalt(10))
    INSERT INTO Usuarios (id_rol, nombre, usuario, email, password_hash, cargo, activo)
    VALUES (
        @idAdminRol,
        N'Administrador del Sistema',
        'admin',
        'admin@asistencia.com',
        '$2a$10$lUu4B9pD8YpM2C4s0q8xGefE5FkC3Jj7N2yLq7qM8oP0n1r3u5aee', -- Reemplazable/actualizable por seed.js
        N'Jefe de Sistemas / RH',
        1
    );
    PRINT 'Usuario Administrador inicial creado (admin@asistencia.com).';
END
GO

-- Áreas de demostración iniciales
IF NOT EXISTS (SELECT 1 FROM Areas WHERE codigo = 'PROD')
BEGIN
    INSERT INTO Areas (codigo, nombre, descripcion)
    VALUES ('PROD', N'Producción y Planta', N'Área de manufactura, ensamble y operaciones.');
END

IF NOT EXISTS (SELECT 1 FROM Areas WHERE codigo = 'LOG')
BEGIN
    INSERT INTO Areas (codigo, nombre, descripcion)
    VALUES ('LOG', N'Logística y Almacén', N'Recepción, inventario, despacho y transportes.');
END

IF NOT EXISTS (SELECT 1 FROM Areas WHERE codigo = 'ADM')
BEGIN
    INSERT INTO Areas (codigo, nombre, descripcion)
    VALUES ('ADM', N'Administración y Finanzas', N'Contabilidad, compras, tesorería y recursos humanos.');
END

IF NOT EXISTS (SELECT 1 FROM Areas WHERE codigo = 'CAL')
BEGIN
    INSERT INTO Areas (codigo, nombre, descripcion)
    VALUES ('CAL', N'Control de Calidad', N'Inspección de procesos, pruebas y aseguramiento.');
END
GO

-- Puestos de demostración por Área
DECLARE @idProd INT = (SELECT id_area FROM Areas WHERE codigo = 'PROD');
DECLARE @idLog INT = (SELECT id_area FROM Areas WHERE codigo = 'LOG');
DECLARE @idAdm INT = (SELECT id_area FROM Areas WHERE codigo = 'ADM');
DECLARE @idCal INT = (SELECT id_area FROM Areas WHERE codigo = 'CAL');

-- Puestos Producción
IF @idProd IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idProd AND nombre = N'Operador de Línea 1')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idProd, N'Operador de Línea 1', N'Operación de maquinado principal');
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idProd AND nombre = N'Operador de Ensamble')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idProd, N'Operador de Ensamble', N'Ensamble y acabados');
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idProd AND nombre = N'Técnico de Mantenimiento')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idProd, N'Técnico de Mantenimiento', N'Mantenimiento preventivo y correctivo');
END

-- Puestos Logística
IF @idLog IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idLog AND nombre = N'Montacarguista')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idLog, N'Montacarguista', N'Movimiento de tarimas y estibas');
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idLog AND nombre = N'Auxiliar de Almacén')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idLog, N'Auxiliar de Almacén', N'Pick & Pack y surtido');
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idLog AND nombre = N'Chofer de Reparto')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idLog, N'Chofer de Reparto', N'Distribución en rutas locales');
END

-- Puestos Calidad
IF @idCal IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idCal AND nombre = N'Inspector de Calidad')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idCal, N'Inspector de Calidad', N'Verificación de estándares');
    IF NOT EXISTS (SELECT 1 FROM Puestos WHERE id_area = @idCal AND nombre = N'Analista de Laboratorio')
        INSERT INTO Puestos (id_area, nombre, descripcion) VALUES (@idCal, N'Analista de Laboratorio', N'Pruebas fisicoquímicas');
END
GO
