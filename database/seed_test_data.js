const { getPool, sql } = require('../config/db');

async function seedTestData() {
    let pool;
    try {
        console.log('🔄 Conectando con Microsoft SQL Server para insertar datos de prueba...');
        pool = await getPool();

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        console.log('📦 Iniciando transacción segura...');

        // 1. Asignar ubicaciones al usuario 2 (Supervisor) si no las tiene
        // Ubicaciones: 1 (ARÁBIGA), 2 (ROBUSTA), 3 (Patio ofi)
        const userLocations = [1, 2, 3];
        const supervisorId = 2;

        for (const locId of userLocations) {
            const reqLoc = new sql.Request(transaction);
            reqLoc.input('id_usuario', sql.Int, supervisorId);
            reqLoc.input('id_ubicacion', sql.Int, locId);
            
            await reqLoc.query(`
                IF NOT EXISTS (
                    SELECT 1 FROM Usuario_Ubicaciones 
                    WHERE id_usuario = @id_usuario AND id_ubicacion = @id_ubicacion
                )
                BEGIN
                    INSERT INTO Usuario_Ubicaciones (id_usuario, id_ubicacion, fecha_asignacion)
                    VALUES (@id_usuario, @id_ubicacion, GETDATE())
                END
            `);
        }
        console.log('✅ Permisos de ubicaciones asignados al usuario supervisor (IDs: 1, 2, 3).');

        // 2. Definir datos de prueba para Puestos y Ubicaciones
        // Puestos de Secado Natural Arábico (Área 6):
        // 43: PATIERO, 46: PUNTERO, 42: CAPATAZ, 44: CONTROL DE PATIO
        // Puestos de Producción (Área 2):
        // 11: OPERADOR DE MAQUINARIA, 12: ESTIBADOR, 13: MONTACARGUISTA, 17: AUXILIAR DE PRODUCCION

        const sampleAttendance = [
            // Patio ofi (id_ubicacion = 3) - Serie temporal de 7 días (23 al 29 de Octubre 2026)
            { fecha: '2026-10-23', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 8 }, { id: 46, cant: 2 }, { id: 42, cant: 1 }, { id: 44, cant: 2 }] },
            { fecha: '2026-10-24', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 12 }, { id: 46, cant: 3 }, { id: 42, cant: 1 }, { id: 44, cant: 2 }] },
            { fecha: '2026-10-25', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 15 }, { id: 46, cant: 4 }, { id: 42, cant: 1 }, { id: 44, cant: 3 }] },
            { fecha: '2026-10-26', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 10 }, { id: 46, cant: 2 }, { id: 42, cant: 1 }, { id: 44, cant: 2 }] },
            { fecha: '2026-10-27', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 18 }, { id: 46, cant: 5 }, { id: 42, cant: 1 }, { id: 44, cant: 3 }] },
            { fecha: '2026-10-28', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 14 }, { id: 46, cant: 4 }, { id: 42, cant: 1 }, { id: 44, cant: 2 }] },
            { fecha: '2026-10-29', ubicacion: 3, turno: 'UNICO', puestos: [{ id: 43, cant: 16 }, { id: 46, cant: 4 }, { id: 42, cant: 1 }, { id: 44, cant: 3 }] },

            // Producción - ARÁBIGA (id_ubicacion = 1)
            { fecha: '2026-10-27', ubicacion: 1, turno: 'TURNO_1', puestos: [{ id: 11, cant: 6 }, { id: 12, cant: 10 }, { id: 13, cant: 2 }, { id: 17, cant: 4 }] },
            { fecha: '2026-10-28', ubicacion: 1, turno: 'TURNO_1', puestos: [{ id: 11, cant: 7 }, { id: 12, cant: 12 }, { id: 13, cant: 2 }, { id: 17, cant: 5 }] },
            { fecha: '2026-10-29', ubicacion: 1, turno: 'TURNO_1', puestos: [{ id: 11, cant: 6 }, { id: 12, cant: 11 }, { id: 13, cant: 2 }, { id: 17, cant: 4 }] },

            // Producción - ROBUSTA (id_ubicacion = 2)
            { fecha: '2026-10-27', ubicacion: 2, turno: 'TURNO_1', puestos: [{ id: 11, cant: 4 }, { id: 12, cant: 8 }, { id: 13, cant: 1 }, { id: 17, cant: 3 }] },
            { fecha: '2026-10-28', ubicacion: 2, turno: 'TURNO_1', puestos: [{ id: 11, cant: 5 }, { id: 12, cant: 9 }, { id: 13, cant: 1 }, { id: 17, cant: 3 }] },
            { fecha: '2026-10-29', ubicacion: 2, turno: 'TURNO_1', puestos: [{ id: 11, cant: 4 }, { id: 12, cant: 8 }, { id: 13, cant: 1 }, { id: 17, cant: 3 }] }
        ];

        let insertados = 0;

        for (const dia of sampleAttendance) {
            for (const p of dia.puestos) {
                const req = new sql.Request(transaction);
                req.input('fecha', sql.Date, dia.fecha);
                req.input('id_puesto', sql.Int, p.id);
                req.input('cantidad', sql.Int, p.cant);
                req.input('turno', sql.VarChar(20), dia.turno);
                req.input('id_ubicacion', sql.Int, dia.ubicacion);
                req.input('obs', sql.NVarChar(1000), `Registro de prueba simulada [DATO_PRUEBA]`);
                req.input('id_usuario', sql.Int, supervisorId);

                const res = await req.query(`
                    IF NOT EXISTS (
                        SELECT 1 FROM Asistencias_Diarias
                        WHERE fecha = @fecha 
                          AND id_puesto = @id_puesto 
                          AND turno = @turno 
                          AND id_ubicacion_seguro = ISNULL(@id_ubicacion, 0)
                    )
                    BEGIN
                        INSERT INTO Asistencias_Diarias (
                            fecha, id_puesto, cantidad_asistentes, observaciones,
                            id_usuario_registro, fecha_registro, turno, id_ubicacion
                        )
                        VALUES (
                            @fecha, @id_puesto, @cantidad, @obs,
                            @id_usuario, GETDATE(), @turno, @id_ubicacion
                        );
                        SELECT 1 as inserted;
                    END
                    ELSE
                    BEGIN
                        SELECT 0 as inserted;
                    END
                `);

                if (res.recordset && res.recordset[0] && res.recordset[0].inserted === 1) {
                    insertados++;
                }
            }
        }

        await transaction.commit();
        console.log(`\n🎉 Transacción completada con éxito.`);
        console.log(`📊 Se insertaron ${insertados} registros de asistencia de prueba.`);
        console.log(`📌 Todos los registros contienen la etiqueta [DATO_PRUEBA] para garantizar reversión limpia.`);
        process.exit(0);

    } catch (err) {
        console.error('❌ Error insertando datos de prueba:', err);
        if (pool) {
            try {
                // Si la transacción estaba activa, el rollback se ejecutará
            } catch (e) {}
        }
        process.exit(1);
    }
}

seedTestData();
