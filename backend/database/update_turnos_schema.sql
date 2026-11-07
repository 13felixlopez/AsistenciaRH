-- ==============================================================================
-- Migración: Soporte de Turnos en Puestos y Asistencias Diarias
-- AsistenciaRH - SQL Server 2016+
-- ==============================================================================

USE AsistenciaRH_DB;
GO

-- 1. Agregar columna aplica_turnos en la tabla Puestos si no existe
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Puestos' AND COLUMN_NAME = 'aplica_turnos'
)
BEGIN
    ALTER TABLE Puestos ADD aplica_turnos BIT NOT NULL CONSTRAINT DF_Puestos_AplicaTurnos DEFAULT 0;
    PRINT 'Columna aplica_turnos agregada a Puestos.';
END
ELSE
BEGIN
    PRINT 'La columna aplica_turnos ya existe en Puestos.';
END
GO

-- 2. Agregar columna turno en Asistencias_Diarias si no existe
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Asistencias_Diarias' AND COLUMN_NAME = 'turno'
)
BEGIN
    ALTER TABLE Asistencias_Diarias ADD turno VARCHAR(20) NOT NULL CONSTRAINT DF_Asistencias_Turno DEFAULT 'UNICO';
    PRINT 'Columna turno agregada a Asistencias_Diarias.';
END
ELSE
BEGIN
    PRINT 'La columna turno ya existe en Asistencias_Diarias.';
END
GO

-- 3. Actualizar la restricción única en Asistencias_Diarias
-- De: UQ_Fecha_Puesto (fecha, id_puesto)
-- A:  UQ_Fecha_Puesto_Turno (fecha, id_puesto, turno)
IF EXISTS (
    SELECT 1 FROM sys.key_constraints 
    WHERE name = 'UQ_Fecha_Puesto' AND parent_object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    ALTER TABLE Asistencias_Diarias DROP CONSTRAINT UQ_Fecha_Puesto;
    PRINT 'Restricción anterior UQ_Fecha_Puesto eliminada.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints 
    WHERE name = 'UQ_Fecha_Puesto_Turno' AND parent_object_id = OBJECT_ID('Asistencias_Diarias')
)
BEGIN
    ALTER TABLE Asistencias_Diarias ADD CONSTRAINT UQ_Fecha_Puesto_Turno UNIQUE (fecha, id_puesto, turno);
    PRINT 'Nueva restricción única UQ_Fecha_Puesto_Turno (fecha, id_puesto, turno) creada exitosamente.';
END
GO
