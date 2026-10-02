const router = require('../router').Router();
const { pool } = require('../db');
const { authMiddleware, requirePrincipalAccess } = require('../middleware/auth');

router.use(authMiddleware);

// CRUD sobre familias_productos (tabla del sistema anterior). Es la agrupación que
// realmente se usa hoy en los productos (ver erp_productos.familia, sincronizado
// desde acá vía listado_items_2025.id_familia) — reemplaza a erp_categorias como
// fuente de "categoría" en el menú Maestros.
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.id_familia AS id, f.codigo_familia, f.nombre_familia, f.descripcion,
             IF(f.activo, 'activo', 'inactivo') AS estado,
             (SELECT COUNT(*) FROM listado_items_2025 li WHERE li.id_familia = f.id_familia) AS productos_asociados
      FROM familias_productos f
      WHERE UPPER(f.nombre_familia) LIKE '%COMBUSTIBLE%'
      ORDER BY f.nombre_familia
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener familias' });
  }
});

router.post('/', async (req, res) => {
  const { codigo_familia, nombre_familia, descripcion } = req.body;
  if (!codigo_familia || !nombre_familia) return res.status(400).json({ error: 'Código y nombre son requeridos' });
  if (!/combustible/i.test(nombre_familia)) return res.status(400).json({ error: 'Solo se permite la categoría Combustible' });
  try {
    const [r] = await pool.query(
      'INSERT INTO familias_productos (codigo_familia, nombre_familia, descripcion, activo) VALUES (?, ?, ?, 1)',
      [codigo_familia.trim(), nombre_familia.trim(), descripcion || null]
    );
    const [row] = await pool.query('SELECT id_familia AS id, codigo_familia, nombre_familia, descripcion, "activo" AS estado FROM familias_productos WHERE id_familia = ?', [r.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una familia con ese código' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear familia' });
  }
});

router.put('/:id', async (req, res) => {
  const { codigo_familia, nombre_familia, descripcion, estado } = req.body;
  if (!codigo_familia || !nombre_familia) return res.status(400).json({ error: 'Código y nombre son requeridos' });
  const nuevoNombre = nombre_familia.trim();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[actual]] = await conn.query('SELECT nombre_familia FROM familias_productos WHERE id_familia = ? FOR UPDATE', [req.params.id]);
    if (!actual) { await conn.rollback(); return res.status(404).json({ error: 'Familia no encontrada' }); }

    await conn.query(
      'UPDATE familias_productos SET codigo_familia=?, nombre_familia=?, descripcion=?, activo=? WHERE id_familia=?',
      [codigo_familia.trim(), nuevoNombre, descripcion || null, estado === 'inactivo' ? 0 : 1, req.params.id]
    );

    // Si cambió el nombre, se propaga de inmediato a erp_productos.familia (copia
    // desnormalizada) para que los productos reflejen el cambio sin esperar al
    // próximo "Actualizar" — cubre tanto los sincronizados como los editados a mano.
    let productosActualizados = 0;
    if (actual.nombre_familia !== nuevoNombre) {
      const [r] = await conn.query('UPDATE maquicombus_productos SET familia = ? WHERE familia = ?', [nuevoNombre, actual.nombre_familia]);
      productosActualizados = r.affectedRows;
    }

    await conn.commit();
    const [row] = await pool.query(
      `SELECT id_familia AS id, codigo_familia, nombre_familia, descripcion, IF(activo, 'activo', 'inactivo') AS estado
       FROM familias_productos WHERE id_familia = ?`,
      [req.params.id]
    );
    res.json({ ...row[0], productosActualizados });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una familia con ese código' });
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar familia' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', requirePrincipalAccess, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ usos }]] = await conn.query('SELECT COUNT(*) as usos FROM listado_items_2025 WHERE id_familia = ?', [req.params.id]);
    if (parseInt(usos) > 0) {
      await conn.rollback();
      return res.status(409).json({ error: `No se puede eliminar: hay ${usos} producto(s) del catálogo asignados a esta familia` });
    }
    const [[familia]] = await conn.query('SELECT nombre_familia FROM familias_productos WHERE id_familia = ? FOR UPDATE', [req.params.id]);
    if (!familia) { await conn.rollback(); return res.status(404).json({ error: 'Familia no encontrada' }); }

    // Limpia la copia desnormalizada en los productos que aún la tuvieran asignada,
    // para no dejar productos apuntando a una familia que ya no existe.
    await conn.query('UPDATE maquicombus_productos SET familia = NULL WHERE familia = ?', [familia.nombre_familia]);
    await conn.query('DELETE FROM familias_productos WHERE id_familia = ?', [req.params.id]);

    await conn.commit();
    res.json({ message: 'Familia eliminada' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar familia' });
  } finally {
    conn.release();
  }
});

module.exports = router;
