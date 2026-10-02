// Esquema y datos semilla de la BD (antes corría en cada arranque del servidor Express).
// En Vercel no se ejecuta por petición: lanzarlo a mano con `npm run db:init` tras cambiar el esquema.
// Fuente de verdad de los modelos: prisma/schema.prisma (`npm run db:pull`).
const { pool } = require('./db');

async function initSchema(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_usuarios (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      rol ENUM('admin','gerente','almacenero','contador','supervisor') DEFAULT 'almacenero',
      almacen_id INT NULL,
      activo BOOLEAN DEFAULT TRUE,
      ultimo_acceso TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: login por nombre en vez de correo (correo pasa a ser opcional)
  const [emailCol] = await conn.query(
    "SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_usuarios' AND COLUMN_NAME = 'email'"
  );
  if (emailCol.length && emailCol[0].IS_NULLABLE === 'NO') {
    await conn.query("ALTER TABLE maquicombus_usuarios MODIFY COLUMN email VARCHAR(100) NULL");
    console.log('✅ Migración: erp_usuarios.email ahora es opcional');
  }

  const [ucNombre] = await conn.query(
    "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_usuarios' AND INDEX_NAME = 'uq_maquicombus_usuarios_nombre'"
  );
  if (!ucNombre.length) {
    const [dupes] = await conn.query('SELECT nombre FROM maquicombus_usuarios GROUP BY nombre HAVING COUNT(*) > 1');
    if (!dupes.length) {
      await conn.query('ALTER TABLE maquicombus_usuarios ADD UNIQUE KEY uq_maquicombus_usuarios_nombre (nombre)');
      console.log('✅ Migración: erp_usuarios.nombre es único (login por nombre)');
    } else {
      console.warn('⚠️ erp_usuarios tiene nombres duplicados, no se pudo hacer nombre único:', dupes.map(d => d.nombre).join(', '));
    }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_centros_costo (
      id INT PRIMARY KEY AUTO_INCREMENT,
      codigo VARCHAR(20) UNIQUE NOT NULL,
      nombre VARCHAR(100) NOT NULL,
      descripcion TEXT,
      presupuesto_anual DECIMAL(15,2) DEFAULT 0,
      presupuesto_mensual DECIMAL(15,2) DEFAULT 0,
      ejecutado_total DECIMAL(15,2) DEFAULT 0,
      alerta_porcentaje INT DEFAULT 80,
      bloqueo_porcentaje INT DEFAULT 100,
      estado ENUM('activo','inactivo') DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_almacenes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      codigo VARCHAR(20) UNIQUE NOT NULL,
      nombre VARCHAR(100) NOT NULL,
      tipo ENUM('principal','central','auxiliar') NOT NULL,
      descripcion TEXT,
      responsable_id INT NULL,
      estado ENUM('activo','inactivo') DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_categorias (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(100) NOT NULL,
      descripcion TEXT,
      estado ENUM('activo','inactivo') DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_unidades_medida (
      id INT PRIMARY KEY AUTO_INCREMENT,
      codigo VARCHAR(10) NOT NULL UNIQUE,
      nombre VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_productos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sku VARCHAR(50) UNIQUE NOT NULL,
      codigo_interno VARCHAR(50),
      codigo_barras VARCHAR(50),
      descripcion VARCHAR(250) NOT NULL,
      descripcion_larga TEXT,
      categoria_id INT,
      marca VARCHAR(100),
      unidad_medida_id INT,
      unidad_compra_id INT,
      factor_conversion DECIMAL(10,4) DEFAULT 1,
      imagen_url VARCHAR(500),
      stock_minimo DECIMAL(10,2) DEFAULT 0,
      stock_maximo DECIMAL(10,2) DEFAULT 0,
      punto_reposicion DECIMAL(10,2) DEFAULT 0,
      precio_costo DECIMAL(15,2) DEFAULT 0,
      precio_venta DECIMAL(15,2) DEFAULT 0,
      metodo_costeo ENUM('promedio','fifo') DEFAULT 'promedio',
      estado ENUM('activo','inactivo') DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (categoria_id) REFERENCES maquicombus_categorias(id) ON DELETE SET NULL,
      FOREIGN KEY (unidad_medida_id) REFERENCES maquicombus_unidades_medida(id) ON DELETE SET NULL,
      FOREIGN KEY (unidad_compra_id) REFERENCES maquicombus_unidades_medida(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_inventario (
      id INT PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NOT NULL,
      almacen_id INT NOT NULL,
      stock_fisico DECIMAL(10,4) DEFAULT 0,
      stock_reservado DECIMAL(10,4) DEFAULT 0,
      costo_promedio DECIMAL(15,4) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_prod_alm (producto_id, almacen_id),
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id) ON DELETE CASCADE,
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_clientes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      tipo_documento ENUM('RUC','DNI','CE','PASSPORT') NOT NULL DEFAULT 'RUC',
      numero_documento VARCHAR(20) UNIQUE NOT NULL,
      razon_social VARCHAR(200) NOT NULL,
      nombre_comercial VARCHAR(200),
      direccion TEXT,
      ubigeo VARCHAR(10),
      contacto VARCHAR(100),
      telefono VARCHAR(20),
      telefono2 VARCHAR(20),
      correo VARCHAR(100),
      correo2 VARCHAR(100),
      condicion_comercial TEXT,
      limite_credito DECIMAL(15,2) DEFAULT 0,
      estado ENUM('activo','inactivo') DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_cotizaciones (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      fecha DATE NOT NULL,
      fecha_vigencia DATE,
      cliente_id INT NOT NULL,
      centro_costo_id INT NOT NULL,
      proyecto VARCHAR(150),
      moneda ENUM('PEN','USD','EUR') DEFAULT 'PEN',
      tipo_cambio DECIMAL(10,4) DEFAULT 1.0000,
      subtotal DECIMAL(15,2) DEFAULT 0,
      descuento_total DECIMAL(15,2) DEFAULT 0,
      igv DECIMAL(15,2) DEFAULT 0,
      total DECIMAL(15,2) DEFAULT 0,
      estado ENUM('borrador','enviada','aprobada','rechazada','vencida','convertida') DEFAULT 'borrador',
      observaciones TEXT,
      terminos TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES maquicombus_clientes(id),
      FOREIGN KEY (centro_costo_id) REFERENCES maquicombus_centros_costo(id),
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_cotizacion_detalles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      cotizacion_id INT NOT NULL,
      producto_id INT NOT NULL,
      descripcion VARCHAR(250),
      cantidad DECIMAL(10,4) NOT NULL,
      unidad VARCHAR(20),
      precio_unitario DECIMAL(15,4) NOT NULL,
      descuento_pct DECIMAL(5,2) DEFAULT 0,
      igv_pct DECIMAL(5,2) DEFAULT 18,
      subtotal DECIMAL(15,2) NOT NULL,
      total_linea DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (cotizacion_id) REFERENCES maquicombus_cotizaciones(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_pagos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      cotizacion_id INT NULL,
      cliente_id INT NOT NULL,
      fecha DATE NOT NULL,
      importe DECIMAL(15,2) NOT NULL,
      banco VARCHAR(100),
      moneda ENUM('PEN','USD','EUR') DEFAULT 'PEN',
      tipo_cambio DECIMAL(10,4) DEFAULT 1.0000,
      numero_operacion VARCHAR(100),
      comprobante_url VARCHAR(500),
      medio ENUM('transferencia','deposito','tarjeta','efectivo','yape','plin','cheque') NOT NULL,
      estado ENUM('pendiente','parcial','pagado','verificado','anulado') DEFAULT 'pendiente',
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cotizacion_id) REFERENCES maquicombus_cotizaciones(id) ON DELETE SET NULL,
      FOREIGN KEY (cliente_id) REFERENCES maquicombus_clientes(id),
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_ordenes_compra (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      cotizacion_id INT NOT NULL,
      pago_id INT NULL,
      cliente_id INT NOT NULL,
      centro_costo_id INT NOT NULL,
      proyecto VARCHAR(150),
      fecha DATE NOT NULL,
      fecha_entrega DATE,
      moneda ENUM('PEN','USD','EUR') DEFAULT 'PEN',
      tipo_cambio DECIMAL(10,4) DEFAULT 1.0000,
      subtotal DECIMAL(15,2) DEFAULT 0,
      igv DECIMAL(15,2) DEFAULT 0,
      total DECIMAL(15,2) DEFAULT 0,
      estado ENUM('borrador','aprobada','emitida','parcialmente_recibida','completada','anulada') DEFAULT 'borrador',
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cotizacion_id) REFERENCES maquicombus_cotizaciones(id),
      FOREIGN KEY (pago_id) REFERENCES maquicombus_pagos(id) ON DELETE SET NULL,
      FOREIGN KEY (cliente_id) REFERENCES maquicombus_clientes(id),
      FOREIGN KEY (centro_costo_id) REFERENCES maquicombus_centros_costo(id),
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_orden_compra_detalles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      orden_compra_id INT NOT NULL,
      producto_id INT NOT NULL,
      descripcion VARCHAR(250),
      cantidad_pedida DECIMAL(10,4) NOT NULL,
      cantidad_recibida DECIMAL(10,4) DEFAULT 0,
      precio_unitario DECIMAL(15,4) NOT NULL,
      descuento_pct DECIMAL(5,2) DEFAULT 0,
      igv_pct DECIMAL(5,2) DEFAULT 18,
      subtotal DECIMAL(15,2) NOT NULL,
      FOREIGN KEY (orden_compra_id) REFERENCES maquicombus_ordenes_compra(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_facturas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      serie VARCHAR(10) NOT NULL,
      numero VARCHAR(15) NOT NULL,
      fecha DATE NOT NULL,
      cliente_id INT NOT NULL,
      orden_compra_id INT NULL,
      subtotal DECIMAL(15,2) NOT NULL,
      igv DECIMAL(15,2) NOT NULL DEFAULT 0,
      total DECIMAL(15,2) NOT NULL,
      pdf_url VARCHAR(500),
      xml_url VARCHAR(500),
      imagen_url VARCHAR(500),
      tipo ENUM('factura','boleta','nota_credito','nota_debito') DEFAULT 'factura',
      estado ENUM('registrada','validada','anulada') DEFAULT 'registrada',
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_serie_num (serie, numero),
      FOREIGN KEY (cliente_id) REFERENCES maquicombus_clientes(id),
      FOREIGN KEY (orden_compra_id) REFERENCES maquicombus_ordenes_compra(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_recepciones (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      orden_compra_id INT NOT NULL,
      factura_id INT NULL,
      almacen_destino_id INT NOT NULL,
      fecha DATE NOT NULL,
      tipo ENUM('total','parcial') DEFAULT 'total',
      estado ENUM('borrador','completada','anulada') DEFAULT 'borrador',
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (orden_compra_id) REFERENCES maquicombus_ordenes_compra(id),
      FOREIGN KEY (factura_id) REFERENCES maquicombus_facturas(id) ON DELETE SET NULL,
      FOREIGN KEY (almacen_destino_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_recepcion_detalles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      recepcion_id INT NOT NULL,
      producto_id INT NOT NULL,
      orden_detalle_id INT NULL,
      cantidad_recibida DECIMAL(10,4) NOT NULL,
      precio_unitario DECIMAL(15,4) NOT NULL,
      lote VARCHAR(100),
      serie_producto VARCHAR(100),
      fecha_vencimiento DATE NULL,
      observaciones TEXT,
      FOREIGN KEY (recepcion_id) REFERENCES maquicombus_recepciones(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id),
      FOREIGN KEY (orden_detalle_id) REFERENCES maquicombus_orden_compra_detalles(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_transferencias (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      almacen_origen_id INT NOT NULL,
      almacen_destino_id INT NOT NULL,
      fecha DATE NOT NULL,
      responsable_id INT NULL,
      estado ENUM('borrador','aprobada','completada','anulada') DEFAULT 'borrador',
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (almacen_origen_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (almacen_destino_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (responsable_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_transferencia_detalles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      transferencia_id INT NOT NULL,
      producto_id INT NOT NULL,
      cantidad DECIMAL(10,4) NOT NULL,
      costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
      FOREIGN KEY (transferencia_id) REFERENCES maquicombus_transferencias(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_solicitudes_abastecimiento (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      almacen_solicitante_id INT NOT NULL,
      almacen_proveedor_id INT NOT NULL,
      fecha DATE NOT NULL,
      urgencia ENUM('normal','urgente','critico') DEFAULT 'normal',
      estado ENUM('pendiente','aprobada','atendida','parcialmente_atendida','rechazada') DEFAULT 'pendiente',
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (almacen_solicitante_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (almacen_proveedor_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_solicitud_detalles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      solicitud_id INT NOT NULL,
      producto_id INT NOT NULL,
      cantidad_solicitada DECIMAL(10,4) NOT NULL,
      cantidad_atendida DECIMAL(10,4) DEFAULT 0,
      observaciones TEXT,
      FOREIGN KEY (solicitud_id) REFERENCES maquicombus_solicitudes_abastecimiento(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_salidas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numero VARCHAR(20) UNIQUE NOT NULL,
      almacen_id INT NOT NULL,
      centro_costo_id INT NULL,
      fecha DATE NOT NULL,
      motivo VARCHAR(200),
      solicitante VARCHAR(100),
      observaciones TEXT,
      usuario_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (centro_costo_id) REFERENCES maquicombus_centros_costo(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_salida_detalles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      salida_id INT NOT NULL,
      producto_id INT NOT NULL,
      cantidad DECIMAL(10,4) NOT NULL,
      costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
      valor_total DECIMAL(15,4) NOT NULL DEFAULT 0,
      FOREIGN KEY (salida_id) REFERENCES maquicombus_salidas(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_kardex (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NOT NULL,
      almacen_id INT NOT NULL,
      centro_costo_id INT NULL,
      fecha DATE NOT NULL,
      tipo_documento ENUM('COMPRA','RECEPCION','TRANSFERENCIA_IN','TRANSFERENCIA_OUT','AJUSTE_POS','AJUSTE_NEG','CONSUMO','DEVOLUCION','SALDO_INICIAL','SALIDA_CONSUMO') NOT NULL,
      numero_documento VARCHAR(50),
      referencia_id INT NULL,
      movimiento ENUM('entrada','salida') NOT NULL,
      cantidad DECIMAL(10,4) NOT NULL,
      costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
      valor_total DECIMAL(15,4) NOT NULL DEFAULT 0,
      saldo_cantidad DECIMAL(10,4) NOT NULL DEFAULT 0,
      saldo_valor DECIMAL(15,4) NOT NULL DEFAULT 0,
      saldo_costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
      usuario_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id),
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id),
      FOREIGN KEY (centro_costo_id) REFERENCES maquicombus_centros_costo(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL,
      INDEX idx_kardex_producto (producto_id),
      INDEX idx_kardex_almacen (almacen_id),
      INDEX idx_kardex_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_presupuesto_mensual (
      id INT PRIMARY KEY AUTO_INCREMENT,
      centro_costo_id INT NOT NULL,
      anio YEAR NOT NULL,
      mes TINYINT NOT NULL,
      presupuesto DECIMAL(15,2) DEFAULT 0,
      ejecutado DECIMAL(15,2) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_cc_anio_mes (centro_costo_id, anio, mes),
      FOREIGN KEY (centro_costo_id) REFERENCES maquicombus_centros_costo(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_importaciones_saldo (
      id INT PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NULL,
      fecha_importacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      archivo_nombre VARCHAR(200),
      total INT DEFAULT 0,
      importados INT DEFAULT 0,
      omitidos INT DEFAULT 0,
      errores INT DEFAULT 0,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_saldos_iniciales (
      id INT PRIMARY KEY AUTO_INCREMENT,
      numeracion VARCHAR(20),
      codigo_producto VARCHAR(50),
      descripcion_producto VARCHAR(300),
      almacen VARCHAR(150),
      fecha DATE,
      documento VARCHAR(50),
      ruc VARCHAR(20),
      cantidad DECIMAL(12,4) DEFAULT 0,
      costo_unitario DECIMAL(15,4) DEFAULT 0,
      costo_total DECIMAL(15,4) DEFAULT 0,
      usuario_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: agregar columna sku a erp_saldos_iniciales si no existe
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_saldos_iniciales' AND COLUMN_NAME = 'sku'"
  );
  if (!cols.length) {
    await conn.query("ALTER TABLE maquicombus_saldos_iniciales ADD COLUMN sku VARCHAR(100) NULL AFTER codigo_producto");
    console.log('✅ Columna sku agregada a erp_saldos_iniciales');
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_marcas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      descripcion TEXT,
      estado ENUM('activo','inactivo') DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: agregar columna fecha a erp_productos si no existe
  const [colsFechaProd] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_productos' AND COLUMN_NAME = 'fecha'"
  );
  if (!colsFechaProd.length) {
    await conn.query("ALTER TABLE maquicombus_productos ADD COLUMN fecha DATE NULL AFTER descripcion_larga");
    console.log('✅ Columna fecha agregada a erp_productos');
  }

  // Migración: familia del producto, tomada de familias_productos (sistema anterior)
  // vía listado_items_2025.id_familia y mantenida al día en cada "Actualizar"
  // (ver sincronizarFamiliasProductos en syncOrdenesCompraLegacy.js).
  const [colsFamiliaProd] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_productos' AND COLUMN_NAME = 'familia'"
  );
  if (!colsFamiliaProd.length) {
    await conn.query("ALTER TABLE maquicombus_productos ADD COLUMN familia VARCHAR(150) NULL");
    console.log('✅ Columna familia agregada a erp_productos');
  }

  // Migración: bloqueo de transferencias individuales por producto (Transferencia por Bloque)
  const [colsBloqueoProd] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_productos' AND COLUMN_NAME = 'bloqueado_transferencia'"
  );
  if (!colsBloqueoProd.length) {
    await conn.query("ALTER TABLE maquicombus_productos ADD COLUMN bloqueado_transferencia BOOLEAN DEFAULT FALSE");
    await conn.query("ALTER TABLE maquicombus_productos ADD COLUMN bloqueado_transferencia_fecha DATETIME NULL");
    await conn.query("ALTER TABLE maquicombus_productos ADD COLUMN bloqueado_transferencia_usuario_id INT NULL");
    console.log('✅ Columnas de bloqueo de transferencia agregadas a erp_productos');
  }

  // Migración: trazabilidad de lotes de recepción usados en transferencias
  // (para que "Transferencia por Bloque" y la transferencia individual puedan listar,
  // sin agrupar, cuánto salió de cada recepción/factura en vez de un solo total mezclado)
  const [colsCantTransf] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_recepcion_detalles' AND COLUMN_NAME = 'cantidad_transferida'"
  );
  if (!colsCantTransf.length) {
    await conn.query("ALTER TABLE maquicombus_recepcion_detalles ADD COLUMN cantidad_transferida DECIMAL(10,4) DEFAULT 0");
    console.log('✅ Columna cantidad_transferida agregada a erp_recepcion_detalles');
  }

  const [colsTransfDetLote] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_transferencia_detalles' AND COLUMN_NAME = 'recepcion_detalle_id'"
  );
  if (!colsTransfDetLote.length) {
    await conn.query("ALTER TABLE maquicombus_transferencia_detalles ADD COLUMN recepcion_detalle_id INT NULL");
    await conn.query("ALTER TABLE maquicombus_transferencia_detalles ADD COLUMN nro_factura VARCHAR(300) NULL");
    await conn.query("ALTER TABLE maquicombus_transferencia_detalles ADD COLUMN fecha_origen DATE NULL");
    console.log('✅ Columnas de trazabilidad de lote agregadas a erp_transferencia_detalles');
  }

  // Migración: número de factura directamente en cada línea de kardex, para que las
  // transferencias por bloque puedan registrarse como líneas independientes (una por
  // lote/factura) sin ambigüedad al momento de mostrarlas.
  const [colsKardexFactura] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_kardex' AND COLUMN_NAME = 'nro_factura'"
  );
  if (!colsKardexFactura.length) {
    await conn.query("ALTER TABLE maquicombus_kardex ADD COLUMN nro_factura VARCHAR(300) NULL");
    console.log('✅ Columna nro_factura agregada a erp_kardex');
  }

  // Migración: enlace directo de cada línea de kardex a su línea de transferencia de
  // origen (para poder corregir/consultar por lote sin ambigüedad cuando una misma
  // transferencia tiene varias líneas del mismo producto, como en Transferencia por Bloque).
  const [colsKardexTrfDet] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_kardex' AND COLUMN_NAME = 'transferencia_detalle_id'"
  );
  if (!colsKardexTrfDet.length) {
    await conn.query("ALTER TABLE maquicombus_kardex ADD COLUMN transferencia_detalle_id INT NULL");
    console.log('✅ Columna transferencia_detalle_id agregada a erp_kardex');
  }

  // Migración: agregar columna estado a erp_unidades_medida si no existe
  const [colsEstadoUM] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_unidades_medida' AND COLUMN_NAME = 'estado'"
  );
  if (!colsEstadoUM.length) {
    await conn.query("ALTER TABLE maquicombus_unidades_medida ADD COLUMN estado ENUM('activo','inactivo') DEFAULT 'activo'");
    console.log('✅ Columna estado agregada a erp_unidades_medida');
  }

  // Migración: referencia al detalle de OC de origen (sistema anterior), para que la
  // sincronización pueda saber con exactitud qué líneas ya importó (sin ambigüedad
  // al comparar por producto, ya que varios códigos legados pueden mapear al mismo producto).
  const [colsOrigenDet] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_orden_compra_detalles' AND COLUMN_NAME = 'id_detalle_origen'"
  );
  if (!colsOrigenDet.length) {
    await conn.query("ALTER TABLE maquicombus_orden_compra_detalles ADD COLUMN id_detalle_origen INT NULL UNIQUE");
    console.log('✅ Columna id_detalle_origen agregada a erp_orden_compra_detalles');
  }

  // Migración: centro de costo por línea de OC (antes solo vivía en la cabecera de la OC,
  // lo que obligaba a consultas indirectas para saber el centro de costo de un ítem recibido
  // o transferido). Se sincroniza con la cabecera al crear la OC y en el backfill inicial.
  const [colsCCDetalle] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_orden_compra_detalles' AND COLUMN_NAME = 'centro_costo_id'"
  );
  if (!colsCCDetalle.length) {
    await conn.query("ALTER TABLE maquicombus_orden_compra_detalles ADD COLUMN centro_costo_id INT NULL");
    await conn.query("ALTER TABLE maquicombus_orden_compra_detalles ADD CONSTRAINT fk_maquicombus_ocd_centro_costo FOREIGN KEY (centro_costo_id) REFERENCES maquicombus_centros_costo(id) ON DELETE SET NULL");
    await conn.query(`
      UPDATE maquicombus_orden_compra_detalles ocd
      JOIN maquicombus_ordenes_compra oc ON ocd.orden_compra_id = oc.id
      SET ocd.centro_costo_id = oc.centro_costo_id
      WHERE oc.centro_costo_id IS NOT NULL
    `);
    console.log('✅ Columna centro_costo_id agregada a erp_orden_compra_detalles (con backfill desde la cabecera)');
  }

  // Migración: marcar productos como "equipo" para exigir placa/código en las salidas
  const [colsEsEquipo] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_productos' AND COLUMN_NAME = 'es_equipo'"
  );
  if (!colsEsEquipo.length) {
    await conn.query("ALTER TABLE maquicombus_productos ADD COLUMN es_equipo BOOLEAN DEFAULT FALSE");
    console.log('✅ Columna es_equipo agregada a erp_productos');
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_equipos_placas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NULL,
      placa VARCHAR(100) NOT NULL,
      almacen_id INT NULL,
      estado ENUM('disponible','en_uso','baja') DEFAULT 'disponible',
      observaciones TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_placa (placa),
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id) ON DELETE CASCADE,
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id) ON DELETE SET NULL,
      INDEX idx_placas_producto (producto_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: la placa ya no se registra ligada a un producto/almacén específico,
  // solo el código de la placa (la relación con el producto se resuelve en la salida).
  const [colsPlacaProdNull] = await conn.query(
    "SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_equipos_placas' AND COLUMN_NAME = 'producto_id'"
  );
  if (colsPlacaProdNull.length && colsPlacaProdNull[0].IS_NULLABLE === 'NO') {
    await conn.query("ALTER TABLE maquicombus_equipos_placas MODIFY COLUMN producto_id INT NULL");
    console.log('✅ Migración: erp_equipos_placas.producto_id ahora es opcional');
  }

  // Migración: centro de costo y placa de equipo por línea de salida (antes era un único
  // centro de costo para todo el documento; ahora cada producto puede llevar el suyo,
  // y si es equipo, la placa/código de la unidad física que sale).
  const [colsSalidaDetCC] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_salida_detalles' AND COLUMN_NAME = 'centro_costo_id'"
  );
  if (!colsSalidaDetCC.length) {
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN centro_costo_id INT NULL");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN placa_id INT NULL");
    console.log('✅ Columnas centro_costo_id y placa_id agregadas a erp_salida_detalles');
  }

  // Migración: trazabilidad de diésel en las salidas — vale correlativo propio (SAL1-########)
  // por línea, factura/OC de origen, vehículo abastecido (reutiliza el catálogo de placas,
  // sin tocar su estado de disponibilidad) y lectura de horómetro en la fecha de abastecimiento.
  const [colsSalidaDetDiesel] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_salida_detalles' AND COLUMN_NAME = 'es_diesel'"
  );
  if (!colsSalidaDetDiesel.length) {
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN es_diesel BOOLEAN DEFAULT FALSE");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN vale_diesel_numero VARCHAR(20) NULL UNIQUE");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN factura_id INT NULL");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN placa_vehiculo_id INT NULL");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN horometro DECIMAL(10,2) NULL");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD COLUMN fecha_abastecimiento DATE NULL");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD CONSTRAINT fk_maquicombus_salida_det_factura FOREIGN KEY (factura_id) REFERENCES maquicombus_facturas(id) ON DELETE SET NULL");
    await conn.query("ALTER TABLE maquicombus_salida_detalles ADD CONSTRAINT fk_maquicombus_salida_det_placa_vehiculo FOREIGN KEY (placa_vehiculo_id) REFERENCES maquicombus_equipos_placas(id) ON DELETE SET NULL");
    console.log('✅ Columnas de trazabilidad de diésel agregadas a erp_salida_detalles');
  }

  // Migración: acceso por módulo configurable por usuario. NULL = sin restricción
  // (acceso a todo), para no romper a los usuarios ya creados antes de esta migración.
  // Los roles admin/gerente siempre tienen acceso total sin importar este campo.
  const [colsPermisos] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_usuarios' AND COLUMN_NAME = 'permisos'"
  );
  if (!colsPermisos.length) {
    await conn.query("ALTER TABLE maquicombus_usuarios ADD COLUMN permisos TEXT NULL");
    console.log('✅ Columna permisos agregada a erp_usuarios');
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_auditoria (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(100),
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ip VARCHAR(45),
      modulo VARCHAR(50) NOT NULL,
      accion VARCHAR(50) NOT NULL,
      tabla VARCHAR(50),
      registro_id VARCHAR(50),
      valor_anterior JSON,
      valor_nuevo JSON,
      INDEX idx_audit_modulo (modulo),
      INDEX idx_audit_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Registro persistente de filas "BUSCADOR" importadas del reporte de Contabilidad
  // en Control de Facturas. buscador es UNIQUE: re-importar el mismo archivo (o uno
  // que se solape con importaciones anteriores) actualiza la fila existente en vez
  // de duplicarla, y así la comparación acumula todo el historial sin repetidos.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_contabilidad_importada (
      id INT PRIMARY KEY AUTO_INCREMENT,
      buscador VARCHAR(150) UNIQUE NOT NULL,
      proveedor VARCHAR(255),
      fecha DATE NULL,
      monto DECIMAL(15,2) NULL,
      glosa VARCHAR(500),
      archivo_origen VARCHAR(255),
      usuario_id INT NULL,
      fecha_importacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Cierre de Período / Cierre Mensual: bloquea el registro de movimientos con fecha
  // igual o anterior al último período cerrado, y deja una foto de los saldos de
  // inventario al momento del cierre (referencia de lo que se "trasladó" al mes siguiente,
  // ya que erp_inventario mantiene el saldo corriente de forma nativa).
  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_cierres_periodo (
      id INT PRIMARY KEY AUTO_INCREMENT,
      anio SMALLINT NOT NULL,
      mes TINYINT NOT NULL,
      fecha_cierre DATE NOT NULL,
      estado ENUM('cerrado','reabierto') DEFAULT 'cerrado',
      observaciones TEXT,
      usuario_cierre_id INT NULL,
      fecha_cierre_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      usuario_reapertura_id INT NULL,
      fecha_reapertura TIMESTAMP NULL,
      UNIQUE KEY uk_cierre_anio_mes (anio, mes),
      FOREIGN KEY (usuario_cierre_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_reapertura_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_cierre_periodo_saldos (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      cierre_id INT NOT NULL,
      producto_id INT NOT NULL,
      almacen_id INT NOT NULL,
      cantidad DECIMAL(10,4) NOT NULL DEFAULT 0,
      costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
      valor_total DECIMAL(15,4) NOT NULL DEFAULT 0,
      FOREIGN KEY (cierre_id) REFERENCES maquicombus_cierres_periodo(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id),
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id),
      INDEX idx_cierre_periodo_saldos_cierre (cierre_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: enlace de las líneas de Saldo Inicial generadas automáticamente al cerrar
  // un período (arrastre de stock al mes siguiente) con el cierre que las originó — permite
  // protegerlas de un borrado manual accidental (solo se revierten reabriendo el período).
  const [colsKardexCierre] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_kardex' AND COLUMN_NAME = 'cierre_periodo_id'"
  );
  if (!colsKardexCierre.length) {
    await conn.query("ALTER TABLE maquicombus_kardex ADD COLUMN cierre_periodo_id INT NULL");
    await conn.query("ALTER TABLE maquicombus_kardex ADD CONSTRAINT fk_maquicombus_kardex_cierre_periodo FOREIGN KEY (cierre_periodo_id) REFERENCES maquicombus_cierres_periodo(id) ON DELETE SET NULL");
    console.log('✅ Columna cierre_periodo_id agregada a erp_kardex');
  }

  // Migración: la reversión de una salida deja de borrarla físicamente — ahora se marca
  // como anulada (queda visible en el listado, resaltada, para control) y puede des-anularse
  // (restaurar la salida a su estado anterior) desde la misma pantalla.
  const [colsSalidaAnulada] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_salidas' AND COLUMN_NAME = 'anulada'"
  );
  if (!colsSalidaAnulada.length) {
    await conn.query("ALTER TABLE maquicombus_salidas ADD COLUMN anulada BOOLEAN NOT NULL DEFAULT FALSE");
    await conn.query("ALTER TABLE maquicombus_salidas ADD COLUMN anulada_en DATETIME NULL");
    await conn.query("ALTER TABLE maquicombus_salidas ADD COLUMN anulada_por INT NULL");
    await conn.query("ALTER TABLE maquicombus_salidas ADD CONSTRAINT fk_maquicombus_salidas_anulada_por FOREIGN KEY (anulada_por) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL");
    console.log('✅ Columnas anulada, anulada_en y anulada_por agregadas a erp_salidas');
  }

  // Migración: eliminar una factura (anularla) ahora se puede deshacer ("retornar"). Se
  // guarda el estado que tenía antes de anularse y, si estaba vinculada a una OC, el
  // nro_factura/estado que esa OC tenía antes de limpiarse, para restaurarlos tal cual.
  const [colsFacturaAnulada] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_facturas' AND COLUMN_NAME = 'estado_anterior'"
  );
  if (!colsFacturaAnulada.length) {
    await conn.query("ALTER TABLE maquicombus_facturas ADD COLUMN estado_anterior VARCHAR(20) NULL");
    await conn.query("ALTER TABLE maquicombus_facturas ADD COLUMN anulada_en DATETIME NULL");
    await conn.query("ALTER TABLE maquicombus_facturas ADD COLUMN anulada_por INT NULL");
    await conn.query("ALTER TABLE maquicombus_facturas ADD COLUMN oc_nro_factura_previo VARCHAR(50) NULL");
    await conn.query("ALTER TABLE maquicombus_facturas ADD COLUMN oc_estado_previo VARCHAR(30) NULL");
    await conn.query("ALTER TABLE maquicombus_facturas ADD CONSTRAINT fk_maquicombus_facturas_anulada_por FOREIGN KEY (anulada_por) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL");
    console.log('✅ Columnas de anulación/retorno agregadas a erp_facturas');
  }

  // Conteo físico de almacenes: una fila por producto/almacén con el último conteo
  // registrado (se sobrescribe en cada guardado, como erp_inventario con el stock).
  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_conteos_almacen (
      id INT PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NOT NULL,
      almacen_id INT NOT NULL,
      cantidad_sistema DECIMAL(10,4) NOT NULL DEFAULT 0,
      cantidad_contada DECIMAL(10,4) NOT NULL,
      diferencia DECIMAL(10,4) NOT NULL DEFAULT 0,
      estado ENUM('igualdad','desfase') NOT NULL,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_conteo_prod_alm (producto_id, almacen_id),
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id) ON DELETE CASCADE,
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id) ON DELETE CASCADE,
      FOREIGN KEY (usuario_id) REFERENCES maquicombus_usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: RESERVA de combustible (transferencia -> reserva ligada a una factura -> salida de reserva)
  const tieneCol = async (tabla, col) => {
    const [r] = await conn.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [tabla, col]
    );
    return r.length > 0;
  };
  if (!(await tieneCol('maquicombus_transferencias', 'es_reserva'))) {
    await conn.query('ALTER TABLE maquicombus_transferencias ADD COLUMN es_reserva TINYINT(1) NOT NULL DEFAULT 0');
  }
  if (!(await tieneCol('maquicombus_ordenes_compra', 'es_reserva'))) {
    await conn.query('ALTER TABLE maquicombus_ordenes_compra ADD COLUMN es_reserva TINYINT(1) NOT NULL DEFAULT 0');
  }
  if (!(await tieneCol('maquicombus_kardex', 'tipo_stock'))) {
    await conn.query("ALTER TABLE maquicombus_kardex ADD COLUMN tipo_stock ENUM('consumo','reserva') NOT NULL DEFAULT 'consumo'");
  }
  const [[kdxTipo]] = await conn.query(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_kardex' AND COLUMN_NAME = 'tipo_documento'"
  );
  if (kdxTipo && !kdxTipo.COLUMN_TYPE.includes('SALIDA_RESERVA')) {
    await conn.query(`ALTER TABLE maquicombus_kardex MODIFY COLUMN tipo_documento ${kdxTipo.COLUMN_TYPE.slice(0, -1) + ",'SALIDA_RESERVA')"} NOT NULL`);
  }
  if (!(await tieneCol('maquicombus_salidas', 'tipo_salida'))) {
    await conn.query(`ALTER TABLE maquicombus_salidas
      ADD COLUMN tipo_salida ENUM('consumo','reserva') NOT NULL DEFAULT 'consumo',
      ADD COLUMN orden_salida_reserva VARCHAR(50) NULL`);
  }
  if (!(await tieneCol('maquicombus_salida_detalles', 'reserva_id'))) {
    await conn.query('ALTER TABLE maquicombus_salida_detalles ADD COLUMN reserva_id INT NULL');
  }
  if (!(await tieneCol('maquicombus_salida_detalles', 'saldo_inicial_kardex_id'))) {
    await conn.query('ALTER TABLE maquicombus_salida_detalles ADD COLUMN saldo_inicial_kardex_id INT NULL');
  }
  await conn.query(`
    CREATE TABLE IF NOT EXISTS maquicombus_reservas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      transferencia_id INT NOT NULL,
      transferencia_detalle_id INT NULL,
      recepcion_detalle_id INT NULL,
      producto_id INT NOT NULL,
      almacen_id INT NOT NULL,
      nro_factura VARCHAR(300) NULL,
      fecha DATE NOT NULL,
      cantidad DECIMAL(12,4) NOT NULL,
      cantidad_salida DECIMAL(12,4) NOT NULL DEFAULT 0,
      costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transferencia_id) REFERENCES maquicombus_transferencias(id),
      FOREIGN KEY (producto_id) REFERENCES maquicombus_productos(id),
      FOREIGN KEY (almacen_id) REFERENCES maquicombus_almacenes(id),
      INDEX idx_reservas_prod_alm (producto_id, almacen_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración: una reserva puede nacer directo de una ENTRADA (recepción) sin transferencia.
  const [[resTransCol]] = await conn.query(
    "SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_reservas' AND COLUMN_NAME = 'transferencia_id'"
  );
  if (resTransCol && resTransCol.IS_NULLABLE === 'NO') {
    await conn.query('ALTER TABLE maquicombus_reservas MODIFY COLUMN transferencia_id INT NULL');
  }

  // Migración: vehículos y maquinaria (tipo + descripción) en el maestro de placas/códigos
  const [colsTipoPlaca] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_equipos_placas' AND COLUMN_NAME = 'tipo'"
  );
  if (!colsTipoPlaca.length) {
    await conn.query(`ALTER TABLE maquicombus_equipos_placas
      ADD COLUMN tipo ENUM('vehiculo','maquinaria') NOT NULL DEFAULT 'vehiculo' AFTER placa,
      ADD COLUMN descripcion VARCHAR(200) NULL AFTER tipo`);
    console.log('✅ Columnas tipo y descripcion agregadas a maquicombus_equipos_placas');
  }

  // Migración: columnas de vínculo con el sistema anterior (factura, PDF, almacén central, id origen)
  const [colsOCLegacy] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maquicombus_ordenes_compra' AND COLUMN_NAME = 'id_source'"
  );
  if (!colsOCLegacy.length) {
    await conn.query(`ALTER TABLE maquicombus_ordenes_compra
      ADD COLUMN nro_factura VARCHAR(300) NULL,
      ADD COLUMN almacen_central VARCHAR(3) NULL,
      ADD COLUMN url_pdf VARCHAR(500) NULL,
      ADD COLUMN url_factura VARCHAR(500) NULL,
      ADD COLUMN id_source INT NULL`);
    console.log('✅ Columnas de vínculo con sistema anterior agregadas a maquicombus_ordenes_compra');
  }

  // Migración: la única categoría del sistema es "Combustible". Los productos de las
  // demás categorías (o sin categoría) pasan a ella y las otras categorías se eliminan.
  let [[catComb]] = await conn.query("SELECT id FROM maquicombus_categorias WHERE UPPER(nombre) = 'COMBUSTIBLE' LIMIT 1");
  if (!catComb) {
    const [r] = await conn.query("INSERT INTO maquicombus_categorias (nombre) VALUES ('Combustible')");
    catComb = { id: r.insertId };
  }
  await conn.query('UPDATE maquicombus_productos SET categoria_id = ? WHERE categoria_id IS NULL OR categoria_id <> ?', [catComb.id, catComb.id]);
  const [delCats] = await conn.query('DELETE FROM maquicombus_categorias WHERE id <> ?', [catComb.id]);
  if (delCats.affectedRows) console.log(`✅ Categorías reducidas a "Combustible" (${delCats.affectedRows} eliminadas)`);

  console.log('✅ Schema verificado / tablas listas');
}

async function initSeeds(conn) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) as n FROM maquicombus_usuarios');
  if (n > 0) return;

  const hash = '$2a$10$mo8ABtISEMB2Dj7T2vPN/OzCEip/DJ8PjnuBN2OC/Ti6FC75iNHNe';

  await conn.query(`
    INSERT INTO maquicombus_usuarios (nombre, email, password_hash, rol) VALUES
      ('Administrador', 'admin@kardexerp.com', '${hash}', 'admin'),
      ('Gerente General', 'gerente@kardexerp.com', '${hash}', 'gerente'),
      ('Almacenero Principal', 'almacen@kardexerp.com', '${hash}', 'almacenero')
  `);

  await conn.query(`
    INSERT INTO maquicombus_centros_costo (codigo, nombre, descripcion, presupuesto_anual, presupuesto_mensual) VALUES
      ('ADM','Administración','Gastos administrativos generales',120000,10000),
      ('LOG','Logística','Operaciones logísticas y almacenamiento',240000,20000),
      ('VEN','Ventas','Departamento comercial y ventas',180000,15000),
      ('OPE','Operaciones','Operaciones productivas',360000,30000),
      ('PNOR','Proyecto Norte','Proyecto de expansión zona norte',500000,41666.67),
      ('PSUR','Proyecto Sur','Proyecto de expansión zona sur',450000,37500),
      ('TIC','Tecnología','Sistemas e infraestructura tecnológica',96000,8000)
  `);

  await conn.query(`
    INSERT INTO maquicombus_almacenes (codigo, nombre, tipo, descripcion) VALUES
      ('ALM-CENTRAL','Almacén Central','central','Almacén central de recepción y distribución.'),
      ('ALM-CENTRAL-02','Almacén Central Corporativo','central','Consolidación del stock corporativo.'),
      ('ALM-AUX-01','Almacén Auxiliar Administración','auxiliar','Suministros para el área administrativa.'),
      ('ALM-AUX-02','Almacén Auxiliar Operaciones','auxiliar','Materiales para operaciones productivas.'),
      ('ALM-AUX-03','Almacén Auxiliar Ventas','auxiliar','Productos de exhibición y muestras.')
  `);

  await conn.query(`
    INSERT INTO maquicombus_unidades_medida (codigo, nombre) VALUES
      ('UND','Unidad'),('KG','Kilogramo'),('GR','Gramo'),('LT','Litro'),
      ('ML','Mililitro'),('MT','Metro'),('CM','Centímetro'),('M2','Metro Cuadrado'),
      ('M3','Metro Cúbico'),('CJA','Caja'),('PAQ','Paquete'),('BOL','Bolsa'),
      ('GLN','Galón'),('PAR','Par'),('DOC','Docena'),('RLL','Rollo'),('JGO','Juego')
  `);

  await conn.query(`
    INSERT INTO maquicombus_categorias (nombre) VALUES ('Combustible')
  `);

  // Sin productos de ejemplo: el catálogo viene de las órdenes de compra sincronizadas.

  await conn.query(`
    INSERT INTO maquicombus_clientes (tipo_documento, numero_documento, razon_social, nombre_comercial, direccion, contacto, telefono, correo, estado) VALUES
      ('RUC','20100065992','CORPORACION ACEROS AREQUIPA SA','Aceros Arequipa','Av. Industrial 123, Lima','Luis Quispe','01-234-5678','compras@acerosarequipa.com','activo'),
      ('RUC','20131312955','SUPERMERCADOS PERUANOS SA','Plaza Vea','Calle Los Álamos 456, Lima','Maria Torres','01-345-6789','logistica@spsa.com.pe','activo'),
      ('RUC','20508565934','CENCOSUD RETAIL PERU SA','Wong / Metro','Av. Javier Prado 789, Lima','Carlos Mendoza','01-456-7890','abastecimiento@cencosud.com.pe','activo'),
      ('RUC','20601234567','DISTRIBUIDORA NORTE SAC','Dist. Norte','Jr. Comercio 321, Trujillo','Ana Flores','044-123456','compras@distnorte.com','activo'),
      ('DNI','45678901','JUAN CARLOS RAMIREZ MENDOZA',NULL,'Av. Lima 555, Callao','Juan Ramírez','987654321','jramirez@gmail.com','activo')
  `);

  console.log('✅ Datos iniciales insertados (contraseña: Admin123!)');
}


async function inicializarBaseDeDatos() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    await initSchema(conn);
    await initSeeds(conn);
  } finally {
    conn.release();
  }
}

module.exports = { inicializarBaseDeDatos };
