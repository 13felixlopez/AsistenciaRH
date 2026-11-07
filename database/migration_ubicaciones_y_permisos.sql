-- ==============================================================================
-- Migración: Soporte para Ubicaciones por Área, Permisos de Usuario y Asistencias
-- ==============================================================================

USE AsistenciaRH_DB;
GO

-- 1. Crear Tabla Ubicaciones si no existe
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Ubicaciones')
BEGIN
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
    PRINT 'Tabla Ubicaciones creada exitosamente.';
END
ELSE
BEGIN
    PRINT 'La tabla Ubicaciones ya existe.';
END
GO

-- 2. Crear Tabla Usuario_Ubicaciones si no existe
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Usuario_Ubicaciones')
BEGIN
    CREATE TABLE Usuario_Ubicaciones (
        id_usuario_ubicacion INT IDENTITY(1,1) PRIMARY KEY,
        id_usuario INT NOT NULL FOREIGN KEY REFERENCES Usuarios(id_usuario) ON DELETE CASCADE,
        id_ubicacion INT NOT NULL FOREIGN KEY REFERENCES Ubicaciones(id_ubicacion) ON DELETE CASCADE,
        fecha_asignacion DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_Usuario_Ubicacion UNIQUE (id_usuario, id_ubicacion)
    );
    PRINT 'Tabla Usuario_Ubicaciones creada exitosamente.';
END
ELSE
BEGIN
    PRINT 'La tabla Usuario_Ubicaciones ya existe.';
END
GO

-- 3. Modificar Asistencias_Diarias para agregar id_ubicacion
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Asistencias_Diarias' AND COLUMN_NAME = 'id_ubicacion'
)
BEGIN
    ALTER TABLE Asistencias_Diarias ADD id_ubicacion INT NULL FOREIGN KEY REFERENCES Ubicaciones(id_ubicacion);
    PRINT 'Columna id_ubicacion agregada a Asistencias_Diarias.';
END
GO

-- 4. Actualizar restricción de unicidad para Asistencias_Diarias
-- Si existe el constraint clásico UQ_Fecha_Puesto_Turno, eliminarlo
IF EXISTS (
    SELECT 1 
    FROM sys.key_constraints 
    WHERE name = 'UQ_Fecha_Puesto_Turno' AND parent_object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    ALTER TABLE Asistencias_Diarias DROP CONSTRAINT UQ_Fecha_Puesto_Turno;
    PRINT 'Restricción previa UQ_Fecha_Puesto_Turno eliminada para permitir unicidad por ubicación.';
END
GO

-- Si ya existe columna calculada id_ubicacion_seguro, no volver a crearla
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Asistencias_Diarias' AND COLUMN_NAME = 'id_ubicacion_seguro'
)
BEGIN
    ALTER TABLE Asistencias_Diarias ADD id_ubicacion_seguro AS ISNULL(id_ubicacion, 0) PERSISTED;
    PRINT 'Columna persistida id_ubicacion_seguro agregada.';
END
GO

-- Crear nuevo índice UNIQUE incluyendo fecha, id_puesto, turno y id_ubicacion_seguro
IF NOT EXISTS (
    SELECT 1 
    FROM sys.indexes 
    WHERE name = 'UQ_Fecha_Puesto_Turno_Ubicacion' AND object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    CREATE UNIQUE INDEX UQ_Fecha_Puesto_Turno_Ubicacion 
    ON Asistencias_Diarias(fecha, id_puesto, turno, id_ubicacion_seguro);
    PRINT 'Índice UNIQUE UQ_Fecha_Puesto_Turno_Ubicacion creado con éxito.';
END
GO

-- 5. Poblar Ubicaciones iniciales conocidas (Producción: ARABIGA, ROBUSTA; Secado: Patios)
DECLARE @idProd INT = (SELECT id_area FROM Areas WHERE codigo = 'PRODUCCION');
IF @idProd IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Ubicaciones WHERE id_area = @idProd AND codigo = 'PROD_ARA')
        INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion)
        VALUES (@idProd, 'PROD_ARA', N'ARÁBIGA', N'Líneas de producción y procesamiento de café Arábica');

    IF NOT EXISTS (SELECT 1 FROM Ubicaciones WHERE id_area = @idProd AND codigo = 'PROD_ROB')
        INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion)
        VALUES (@idProd, 'PROD_ROB', N'ROBUSTA', N'Líneas de producción y procesamiento de café Robusta');
END
GO

DECLARE @idSecNat INT = (SELECT id_area FROM Areas WHERE codigo = 'SEC_NATURAL');
IF @idSecNat IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Ubicaciones WHERE id_area = @idSecNat AND codigo = 'PATIO_ARA_1')
        INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion)
        VALUES (@idSecNat, 'PATIO_ARA_1', N'Patio 1 - Arábico', N'Patios de secado natural de café Arábica sector norte');

    IF NOT EXISTS (SELECT 1 FROM Ubicaciones WHERE id_area = @idSecNat AND codigo = 'PATIO_ARA_2')
        INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion)
        VALUES (@idSecNat, 'PATIO_ARA_2', N'Patio 2 - Arábico', N'Patios de secado natural de café Arábica sector sur');
END
GO

DECLARE @idSecRob INT = (SELECT id_area FROM Areas WHERE codigo = 'SEC_ROBUSTA');
IF @idSecRob IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Ubicaciones WHERE id_area = @idSecRob AND codigo = 'PATIO_ROB_1')
        INSERT INTO Ubicaciones (id_area, codigo, nombre, descripcion)
        VALUES (@idSecRob, 'PATIO_ROB_1', N'Patio 1 - Robusta', N'Patios de secado natural de café Robusta');
END
GO

PRINT 'Migración completada con éxito.';
