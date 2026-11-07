const ExcelJS = require('exceljs');
const path = require('path');
const { sql, getPool, dbConfig } = require('../config/db');

// Mapeo limpio de nombres y códigos de departamentos
const DEPARTAMENTOS_CONFIG = [
    { sheetName: 'Calidad', codigo: 'CALIDAD', nombre: 'Calidad', descripcion: 'Control de calidad, catación y análisis de procesos' },
    { sheetName: 'Producción', codigo: 'PRODUCCION', nombre: 'Producción', descripcion: 'Operaciones de planta, manufactura y ensamble' },
    { sheetName: 'Almacén ', codigo: 'ALMACEN', nombre: 'Almacén', descripcion: 'Bodega, inventario, recepción y báscula' },
    { sheetName: 'Embarque ', codigo: 'EMBARQUE', nombre: 'Embarque', descripcion: 'Despacho, carga y logística de salida' },
    { sheetName: 'Recepción ', codigo: 'RECEPCION', nombre: 'Recepción', descripcion: 'Recepción, pesaje y clasificación de café' },
    { sheetName: 'Secado Natural.', codigo: 'SEC_NATURAL', nombre: 'Secado Natural Arábico', descripcion: 'Manejo de patio y secado de café arábico' },
    { sheetName: 'Secado Robusta ', codigo: 'SEC_ROBUSTA', nombre: 'Secado Natural Robusta', descripcion: 'Manejo de patio y secado de café robusta' },
    { sheetName: 'Secado Mecanico ', codigo: 'SEC_MECANICO', nombre: 'Secado Mecánico', descripcion: 'Hornos, maquinaria y secado mecánico industrial' },
    { sheetName: 'ADM', codigo: 'ADMINISTRACION', nombre: 'Administración', descripcion: 'Recursos humanos, contabilidad, finanzas y soporte' }
];

async function cleanAndImportExcel() {
    try {
        console.log('🔄 Conectando a SQL Server para limpiar y cargar datos del Excel...');
        const pool = await getPool();

        // 1. Limpieza de tablas de datos manteniendo Usuarios y Roles
        console.log('🧹 Limpiando asistencias, asignaciones previas, puestos y áreas...');
        await pool.request().query(`
            DELETE FROM Asistencias_Diarias;
            DELETE FROM Usuario_Areas;
            DELETE FROM Puestos;
            DELETE FROM Areas;
            DBCC CHECKIDENT ('Puestos', RESEED, 0);
            DBCC CHECKIDENT ('Areas', RESEED, 0);
        `);
        console.log('✅ Base de datos limpia (usuarios y roles preservados).');

        // 2. Leer archivo Excel
        const filePath = path.join(__dirname, 'Detalle  Puestos Por Departamentos.xlsx');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        let totalAreasInsertadas = 0;
        let totalPuestosInsertados = 0;

        for (const dep of DEPARTAMENTOS_CONFIG) {
            // Buscar la hoja
            let sheet = workbook.getWorksheet(dep.sheetName);
            if (!sheet) {
                // Búsqueda insensible a espacios
                sheet = workbook.worksheets.find(w => w.name.trim().toLowerCase() === dep.sheetName.trim().toLowerCase());
            }

            if (!sheet) {
                console.warn(`⚠️ No se encontró la hoja "${dep.sheetName}" en el Excel.`);
                continue;
            }

            // Insertar Área
            const areaRes = await pool.request()
                .input('cod', sql.VarChar, dep.codigo)
                .input('nom', sql.NVarChar, dep.nombre)
                .input('desc', sql.NVarChar, dep.descripcion)
                .query(`
                    INSERT INTO Areas (codigo, nombre, descripcion, activa)
                    OUTPUT INSERTED.id_area
                    VALUES (@cod, @nom, @desc, 1)
                `);

            const idArea = areaRes.recordset[0].id_area;
            totalAreasInsertadas++;

            // Extraer puestos de la hoja (a partir de la fila 4)
            const puestosAgregados = new Set();

            for (let rowIdx = 4; rowIdx <= sheet.rowCount; rowIdx++) {
                const row = sheet.getRow(rowIdx);
                const nombrePuesto = row.getCell(1).value;
                const resp1 = row.getCell(3).value;
                const resp2 = row.getCell(4).value;
                const obs = row.getCell(5).value;

                if (nombrePuesto && typeof nombrePuesto === 'string' && nombrePuesto.trim().length > 0) {
                    const puestoLimpio = nombrePuesto.trim();
                    const key = puestoLimpio.toUpperCase();

                    if (!puestosAgregados.has(key)) {
                        puestosAgregados.add(key);

                        const obsStr = (obs && typeof obs === 'string') ? obs.trim() : '';
                        const aplicaTurnos = (obsStr.toLowerCase() === 'si' || obsStr.toLowerCase() === 'sí') ? 1 : 0;

                        let detalles = [];
                        if (resp1 && typeof resp1 === 'string' && resp1.trim()) detalles.push(`Resp 1: ${resp1.trim()}`);
                        if (resp2 && typeof resp2 === 'string' && resp2.trim()) detalles.push(`Resp 2: ${resp2.trim()}`);
                        if (obsStr) detalles.push(`Obs: ${obsStr}`);

                        const descripcionPuesto = detalles.length > 0 ? detalles.join(' | ') : null;

                        await pool.request()
                            .input('id_area', sql.Int, idArea)
                            .input('nom', sql.NVarChar, puestoLimpio)
                            .input('desc', sql.NVarChar, descripcionPuesto)
                            .input('turnos', sql.Bit, aplicaTurnos)
                            .query(`
                                INSERT INTO Puestos (id_area, nombre, descripcion, aplica_turnos, activo)
                                VALUES (@id_area, @nom, @desc, @turnos, 1)
                            `);

                        totalPuestosInsertados++;
                    }
                }
            }

            console.log(`📍 Área "${dep.nombre}" (${dep.codigo}) creada con ${puestosAgregados.size} puestos.`);
        }

        // 3. Asignar áreas al supervisor de prueba (Producción y Secado Mecánico)
        const supUser = await pool.request()
            .input('email', sql.VarChar, 'supervisor.planta@asistencia.com')
            .query("SELECT id_usuario FROM Usuarios WHERE email = @email");

        if (supUser.recordset.length > 0) {
            const supId = supUser.recordset[0].id_usuario;
            const areasParaSupervisor = await pool.request().query("SELECT id_area FROM Areas WHERE codigo IN ('PRODUCCION', 'SEC_MECANICO')");

            for (const a of areasParaSupervisor.recordset) {
                await pool.request()
                    .input('userId', sql.Int, supId)
                    .input('areaId', sql.Int, a.id_area)
                    .query(`
                        INSERT INTO Usuario_Areas (id_usuario, id_area, permite_registro, permite_reportes)
                        VALUES (@userId, @areaId, 1, 1)
                    `);
            }
            console.log('✅ Áreas asignadas al supervisor de prueba (Producción y Secado Mecánico).');
        }

        console.log(`\n🎉 PROCESO COMPLETADO: ${totalAreasInsertadas} Áreas y ${totalPuestosInsertados} Puestos importados exitosamente.`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error al importar Excel:', err);
        process.exit(1);
    }
}

cleanAndImportExcel();
