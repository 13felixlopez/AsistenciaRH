-- ==============================================================================
-- SCRIPT DE REVERSIÓN DE DATOS DE PRUEBA
-- Base de Datos: AsistenciaRH_DB
-- Propósito: Regresar la base de datos exactamente a su estado previo.
-- ==============================================================================

USE AsistenciaRH_DB;
GO

SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    PRINT 'Iniciando reversión segura de datos de prueba...';

    -- 1. Eliminar asistencias que tengan la etiqueta [DATO_PRUEBA]
    DELETE FROM Asistencias_Diarias
    WHERE observaciones LIKE '%[DATO_PRUEBA]%';

    DECLARE @FilasAsistencias INT = @@ROWCOUNT;
    PRINT '-> Asistencias de prueba eliminadas: ' + CAST(@FilasAsistencias AS VARCHAR(10));

    -- 2. Limpiar permisos de prueba en Usuario_Ubicaciones
    DELETE FROM Usuario_Ubicaciones
    WHERE id_usuario = 2 AND id_ubicacion IN (1, 2, 3);

    DECLARE @FilasPermisos INT = @@ROWCOUNT;
    PRINT '-> Permisos de ubicaciones de prueba eliminados: ' + CAST(@FilasPermisos AS VARCHAR(10));

    COMMIT TRANSACTION;
    PRINT '==================================================';
    PRINT '>> REVERSIÓN COMPLETADA EXITOSAMENTE (COMMIT) <<';
    PRINT '==================================================';

    -- Verificación de recuento
    SELECT 
        (SELECT COUNT(*) FROM Asistencias_Diarias) AS Total_Asistencias_Restauradas,
        (SELECT COUNT(*) FROM Usuario_Ubicaciones) AS Total_Usuario_Ubicaciones_Restauradas;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    PRINT 'ERROR AL REVERTIR: ' + ERROR_MESSAGE();
    THROW;
END CATCH;
GO
