'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.startsWith('REEMPLAZA_ESTO_')) {
  console.error('Falta JWT_SECRET en .env. Usa una cadena aleatoria de al menos 32 caracteres.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '1h' }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pesquisas_estaca',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  enableKeepAlive: true,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});

function createDefaultState() {
  const now = new Date().toISOString();
  const wards = ['Barrio 1', 'Barrio 2', 'Barrio 3', 'Barrio 4', 'Barrio 5']
    .map(name => ({ id: crypto.randomUUID(), name, active: true }));
  const activity = {
    id: crypto.randomUUID(),
    name: 'Actividad de Pesquisas',
    date: new Date().toISOString().slice(0, 10),
    status: 'En curso',
    createdAt: now,
    attendance: {},
    rounds: [],
  };
  for (const ward of wards) {
    activity.attendance[ward.id] = {
      attendees: 0, bishop: false, seminary: false, ym: false, yw: false,
    };
  }
  return { wards, activities: [activity], activeActivityId: activity.id };
}

async function initialize() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      state JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [users] = await pool.execute('SELECT id FROM app_users WHERE username = ? LIMIT 1', [ADMIN_USER]);
  if (!users.length) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.execute('INSERT INTO app_users (username, password_hash) VALUES (?, ?)', [ADMIN_USER, hash]);
    console.log(`Usuario inicial creado: ${ADMIN_USER}. Cambia la contraseña desde Configuración después de iniciar sesión.`);
  }

  const [stateRows] = await pool.execute('SELECT id FROM app_state WHERE id = 1');
  if (!stateRows.length) {
    await pool.execute('INSERT INTO app_state (id, state) VALUES (1, ?)', [JSON.stringify(createDefaultState())]);
    console.log('Se creó el estado inicial de Pesquisas en MySQL. Renombra los barrios de ejemplo desde la aplicación.');
  }
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Tu sesión expiró. Inicia sesión de nuevo.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ message: 'La sesión no es válida o expiró. Inicia sesión de nuevo.' });
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (_) {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ message: 'Escribe el usuario y la contraseña.' });
    const [rows] = await pool.execute('SELECT id, username, password_hash FROM app_users WHERE username = ? LIMIT 1', [username]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ ok: false, message: 'Usuario o contraseña incorrectos.' });
    }
    const token = jwt.sign({ sub: String(rows[0].id), username: rows[0].username }, JWT_SECRET, { expiresIn: '12h', issuer: 'pesquisas-estaca' });
    res.json({ ok: true, token, username: rows[0].username });
  } catch (err) { next(err); }
});

app.get('/api/state', authRequired, async (_req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT state, updated_at FROM app_state WHERE id = 1');
    if (!rows.length) return res.status(404).json({ message: 'No existe un estado inicial en la base de datos.' });
    const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state;
    res.json({ ok: true, state, updatedAt: rows[0].updated_at });
  } catch (err) { next(err); }
});

app.put('/api/state', authRequired, async (req, res, next) => {
  try {
    const state = req.body?.state;
    if (!state || !Array.isArray(state.wards) || !Array.isArray(state.activities)) {
      return res.status(400).json({ message: 'La estructura de datos no es válida.' });
    }
    if (JSON.stringify(state).length > 2_500_000) {
      return res.status(413).json({ message: 'El archivo de datos excede el tamaño permitido.' });
    }
    await pool.execute(
      'INSERT INTO app_state (id, state) VALUES (1, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = CURRENT_TIMESTAMP',
      [JSON.stringify(state)],
    );
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

app.post('/api/auth/change-password', authRequired, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8) return res.status(400).json({ message: 'La contraseña nueva debe tener al menos 8 caracteres.' });
    const [rows] = await pool.execute('SELECT id, password_hash FROM app_users WHERE id = ? LIMIT 1', [Number(req.user.sub)]);
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ ok: false, message: 'La contraseña actual no coincide.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.execute('UPDATE app_users SET password_hash = ? WHERE id = ?', [hash, Number(req.user.sub)]);
    res.json({ ok: true, message: 'Contraseña actualizada.' });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', authRequired, (_req, res) => res.json({ ok: true }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Ocurrió un error interno. Revisa los registros del servidor.' });
});

initialize().then(() => {
  app.listen(PORT, () => console.log(`Pesquisas de Estaca disponible en http://localhost:${PORT}`));
}).catch(err => {
  console.error('No se pudo iniciar la aplicación. Revisa MySQL y las variables del archivo .env.');
  console.error(err.message);
  process.exit(1);
});
