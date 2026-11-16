-- ==============================================================================
-- Migración: Plantilla de Personal Contratado por Puesto / Cargo
-- Permite establecer la dotación presupuestada por área y puesto
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

-- 2. Asegurar que no haya valores nulos
UPDATE Puestos SET cantidad_contratada = 0 WHERE cantidad_contratada IS NULL;
GO

PRINT 'Migración de plantilla de personal completada con éxito.';
GO
