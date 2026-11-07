const ExcelJS = require('exceljs');
const path = require('path');
const { sql, getPool } = require('../config/db');

const DEPARTAMENTOS_CONFIG = [
    { sheetName: 'Calidad', codigo: 'CALIDAD' },
    { sheetName: 'Producción', codigo: 'PRODUCCION' },
    { sheetName: 'Almacén ', codigo: 'ALMACEN' },
    { sheetName: 'Embarque ', codigo: 'EMBARQUE' },
    { sheetName: 'Recepción ', codigo: 'RECEPCION' },
    { sheetName: 'Secado Natural.', codigo: 'SEC_NATURAL' },
    { sheetName: 'Secado Robusta ', codigo: 'SEC_ROBUSTA' },
    { sheetName: 'Secado Mecanico ', codigo: 'SEC_MECANICO' },
    { sheetName: 'ADM', codigo: 'ADMINISTRACION' }
];

async function syncTurnosFromExcel() {
    try {
        console.log('🔄 Sincronizando flag "aplica_turnos" de puestos desde Excel a la Base de Datos...');
        const pool = await getPool();

        const filePath = path.join(__dirname, 'Detalle  Puestos Por Departamentos.xlsx');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        let puestosActualizados = 0;

        for (const dep of DEPARTAMENTOS_CONFIG) {
            let sheet = workbook.getWorksheet(dep.sheetName);
            if (!sheet) {
                sheet = workbook.worksheets.find(w => w.name.trim().toLowerCase() === dep.sheetName.trim().toLowerCase());
            }

            if (!sheet) continue;

            const areaRes = await pool.request()
                .input('cod', sql.VarChar, dep.codigo)
                .query('SELECT id_area FROM Areas WHERE codigo = @cod');

            if (areaRes.recordset.length === 0) continue;
            const idArea = areaRes.recordset[0].id_area;

            for (let rowIdx = 4; rowIdx <= sheet.rowCount; rowIdx++) {
                const row = sheet.getRow(rowIdx);
                const nombrePuesto = row.getCell(1).value;
                const obs = row.getCell(5).value;

                if (nombrePuesto && typeof nombrePuesto === 'string' && nombrePuesto.trim().length > 0) {
                    const puestoLimpio = nombrePuesto.trim();
                    const obsStr = (obs && typeof obs === 'string') ? obs.trim().toLowerCase() : '';
                    const aplicaTurnos = (obsStr === 'si' || obsStr === 'sí') ? 1 : 0;

                    const updateRes = await pool.request()
                        .input('id_area', sql.Int, idArea)
                        .input('nom', sql.NVarChar, puestoLimpio)
                        .input('turnos', sql.Bit, aplicaTurnos)
                        .query(`
                            UPDATE Puestos 
                            SET aplica_turnos = @turnos 
                            WHERE id_area = @id_area AND UPPER(LTRIM(RTRIM(nombre))) = UPPER(LTRIM(RTRIM(@nom)))
                        `);

                    if (updateRes.rowsAffected[0] > 0 && aplicaTurnos === 1) {
                        puestosActualizados++;
                        console.log(`  ✓ ${dep.codigo}: "${puestoLimpio}" marcado con aplica_turnos = 1`);
                    }
                }
            }
        }

        console.log(`\n🎉 Sincronización completada: ${puestosActualizados} puestos configurados con turnos múltiples.`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error al sincronizar turnos:', err.message);
        process.exit(1);
    }
}

syncTurnosFromExcel();
