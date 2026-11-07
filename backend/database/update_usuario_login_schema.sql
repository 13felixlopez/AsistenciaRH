-- ==============================================================================
-- Migración: Soporte para inicio de sesión por Nombre de Usuario o Correo
-- ==============================================================================

USE AsistenciaRH_DB;
GO

-- 1. Agregar columna 'usuario' si no existe
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Usuarios' AND COLUMN_NAME = 'usuario'
)
BEGIN
    ALTER TABLE Usuarios ADD usuario VARCHAR(50) NULL;
    PRINT 'Columna usuario agregada a la tabla Usuarios.';
END
GO

-- 2. Poblar nombres de usuario para registros existentes que lo tengan NULL
-- Extraer la parte anterior al @ del email o asignar nombres específicos
UPDATE Usuarios 
SET usuario = CASE 
    WHEN email = 'admin@asistencia.com' THEN 'admin'
    WHEN email = 'supervisor.planta@asistencia.com' THEN 'supervisor'
    WHEN CHARINDEX('@', email) > 1 THEN SUBSTRING(email, 1, CHARINDEX('@', email) - 1)
    ELSE CONCAT('user_', id_usuario)
END
WHERE usuario IS NULL OR LTRIM(RTRIM(usuario)) = '';
GO

-- 3. Asegurar que no sea NULL
ALTER TABLE Usuarios ALTER COLUMN usuario VARCHAR(50) NOT NULL;
GO

-- 4. Agregar restricción UNIQUE si no existe
IF NOT EXISTS (
    SELECT 1 
    FROM sys.indexes 
    WHERE name = 'UQ_Usuarios_usuario' AND object_id = OBJECT_ID('Usuarios')
)
BEGIN
    ALTER TABLE Usuarios ADD CONSTRAINT UQ_Usuarios_usuario UNIQUE (usuario);
    PRINT 'Restricción UNIQUE UQ_Usuarios_usuario creada con éxito.';
END
GO
