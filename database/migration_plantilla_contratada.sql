-- ==============================================================================
-- Migración: Plantilla de Personal Contratado por Puesto / Cargo
-- y Corrección de Restricción Única para Soporte Concurrente de Turnos
-- ==============================================================================

USE AsistenciaRH_DB;
GO

-- 1. Agregar columna cantidad_contratada a la tabla Puestos si no existe
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Puestos' AND COLUMN_NAME = 'cantidad_contratada'
)
BEGIN
    ALTER TABLE Puestos ADD cantidad_contratada INT NOT NULL DEFAULT 0;
    PRINT 'Columna cantidad_contratada agregada exitosamente a la tabla Puestos.';
END
ELSE
BEGIN
    PRINT 'La columna cantidad_contratada ya existe en la tabla Puestos.';
END
GO

-- 2. Asegurar que no haya valores nulos en cantidad_contratada
UPDATE Puestos SET cantidad_contratada = 0 WHERE cantidad_contratada IS NULL;
GO

-- 3. Limpieza de restricciones e índices únicos obsoletos en Asistencias_Diarias
-- Eliminar restricción o índice anterior UQ_Fecha_Puesto que bloqueaba el Turno 2
IF EXISTS (
    SELECT 1 
    FROM sys.key_constraints 
    WHERE name = 'UQ_Fecha_Puesto' AND parent_object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    ALTER TABLE Asistencias_Diarias DROP CONSTRAINT UQ_Fecha_Puesto;
    PRINT 'Restricción obsoleta UQ_Fecha_Puesto eliminada.';
END
GO

IF EXISTS (
    SELECT 1 
    FROM sys.indexes 
    WHERE name = 'UQ_Fecha_Puesto' AND object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    DROP INDEX UQ_Fecha_Puesto ON Asistencias_Diarias;
    PRINT 'Índice obsoleto UQ_Fecha_Puesto eliminado.';
END
GO

-- Eliminar restricción antigua UQ_Fecha_Puesto_Turno si existiera como key_constraint
IF EXISTS (
    SELECT 1 
    FROM sys.key_constraints 
    WHERE name = 'UQ_Fecha_Puesto_Turno' AND parent_object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    ALTER TABLE Asistencias_Diarias DROP CONSTRAINT UQ_Fecha_Puesto_Turno;
    PRINT 'Restricción UQ_Fecha_Puesto_Turno eliminada en favor de UQ_Fecha_Puesto_Turno_Ubicacion.';
END
GO

IF EXISTS (
    SELECT 1 
    FROM sys.indexes 
    WHERE name = 'UQ_Fecha_Puesto_Turno' AND object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    DROP INDEX UQ_Fecha_Puesto_Turno ON Asistencias_Diarias;
    PRINT 'Índice UQ_Fecha_Puesto_Turno eliminado en favor de UQ_Fecha_Puesto_Turno_Ubicacion.';
END
GO

-- 4. Estandarizar valores de turnos en registros existentes
UPDATE Asistencias_Diarias SET turno = 'TURNO_1' WHERE turno = 'TURNO 1' OR turno = 'Turno 1';
UPDATE Asistencias_Diarias SET turno = 'TURNO_2' WHERE turno = 'TURNO 2' OR turno = 'Turno 2';
UPDATE Asistencias_Diarias SET turno = 'UNICO' WHERE turno IS NULL OR turno = '' OR turno = 'TURNO UNICO' OR turno = 'Turno Único';
GO

-- 5. Columna calculada persistida para unicidad con soporte a NULL en ubicacion
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Asistencias_Diarias' AND COLUMN_NAME = 'id_ubicacion_seguro'
)
BEGIN
    ALTER TABLE Asistencias_Diarias ADD id_ubicacion_seguro AS ISNULL(id_ubicacion, 0) PERSISTED;
    PRINT 'Columna calculada id_ubicacion_seguro agregada a Asistencias_Diarias.';
END
GO

-- 6. Crear índice único que contempla (fecha, id_puesto, turno, id_ubicacion_seguro)
IF NOT EXISTS (
    SELECT 1 
    FROM sys.indexes 
    WHERE name = 'UQ_Fecha_Puesto_Turno_Ubicacion' AND object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    CREATE UNIQUE INDEX UQ_Fecha_Puesto_Turno_Ubicacion 
    ON Asistencias_Diarias(fecha, id_puesto, turno, id_ubicacion_seguro);
    PRINT 'Índice único UQ_Fecha_Puesto_Turno_Ubicacion creado exitosamente.';
END
GO

PRINT 'Migración de plantilla de personal y corrección de turnos completada con éxito.';
GO
