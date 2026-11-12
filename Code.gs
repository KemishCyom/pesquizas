/**
 * Pesquisas de Estaca - backend Google Apps Script.
 * Vincula una hoja de cálculo y despliega como aplicación web.
 * Cada función de datos valida una sesión emitida al iniciar sesión.
 */
const APP_SHEETS = {
  Barrios: ['id','nombre','activo'],
  Actividades: ['id','nombre','fecha','estado','creadoEn'],
  Asistencia: ['actividadId','barrioId','asistentes','obispo','seminario','presidenteHJ','presidentaMJ'],
  Rondas: ['id','actividadId','orden','escritura','tipo','puntosRapidos','puntosNormales','duracionSeg','umbralRapido','puntosEspeciales','estado','iniciadaEn'],
  Resultados: ['actividadId','rondaId','barrioId','encontrada','puntos','segundos'],
  Configuracion: ['clave','valor']
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Pesquisas | Control de Estaca')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Ejecutar manualmente una sola vez desde el editor de Apps Script, abierto desde Sheets. */
function setupApp() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abre Apps Script desde una hoja de cálculo: Extensiones > Apps Script.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ensureSheets_(ss);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_SALT') || !props.getProperty('ADMIN_HASH')) {
    const salt = Utilities.getUuid();
    props.setProperties({ ADMIN_SALT: salt, ADMIN_HASH: hashPassword_('admin', salt) });
  }
  if (!props.getProperty('AUTH_SECRET')) props.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
  seedInitialData_(ss);
  return 'Configuración lista. Usuario inicial: admin. Contraseña inicial: admin. Cámbiala desde la aplicación.';
}

function loginApp(username, password) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) throw new Error('Falta inicializar la app. Ejecuta setupApp() desde el editor de Apps Script vinculado a la hoja.');
  const wantedUser = props.getProperty('ADMIN_USER') || 'admin';
  const salt = props.getProperty('ADMIN_SALT');
  const expected = props.getProperty('ADMIN_HASH');
  if (String(username || '').trim() !== wantedUser || hashPassword_(String(password || ''), salt) !== expected) {
    return { ok: false, message: 'Usuario o contraseña incorrectos.' };
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, wantedUser, 21600); // 6 horas
  return { ok: true, token: token, username: wantedUser };
}

function logoutApp(token) {
  if (token) CacheService.getScriptCache().remove('session_' + String(token));
  return { ok: true };
}

function getAppState(token) {
  requireSession_(token);
  const ss = spreadsheet_();
  ensureSheets_(ss);
  const wardsRows = readRows_(ss, 'Barrios');
  const activityRows = readRows_(ss, 'Actividades');
  const attendanceRows = readRows_(ss, 'Asistencia');
  const roundRows = readRows_(ss, 'Rondas');
  const resultRows = readRows_(ss, 'Resultados');
  const configRows = readRows_(ss, 'Configuracion');
  const wards = wardsRows.map(r => ({ id: String(r[0]), name: String(r[1]), active: String(r[2]) !== 'false' }));
  const activities = activityRows.map(r => ({ id: String(r[0]), name: String(r[1]), date: String(r[2]), status: String(r[3] || 'En curso'), createdAt: String(r[4] || ''), attendance: {}, rounds: [] }));
  const byActivity = {};
  activities.forEach(a => byActivity[a.id] = a);
  attendanceRows.forEach(r => {
    const a = byActivity[String(r[0])]; if (!a) return;
    a.attendance[String(r[1])] = { attendees: Number(r[2]) || 0, bishop: asBool_(r[3]), seminary: asBool_(r[4]), ym: asBool_(r[5]), yw: asBool_(r[6]) };
  });
  roundRows.forEach(r => {
    const a = byActivity[String(r[1])]; if (!a) return;
    a.rounds.push({ id: String(r[0]), order: Number(r[2]) || 0, scripture: String(r[3]), type: String(r[4] || 'normal'), earlyPoints: Number(r[5]) || 0, normalPoints: Number(r[6]) || 0, duration: Number(r[7]) || 10, fastSeconds: Number(r[8]) || 5, specialPoints: Number(r[9]) || 0, status: String(r[10] || 'lista'), startedAt: r[11] === '' || r[11] == null ? null : Number(r[11]), results: {} });
  });
  const byRound = {};
  activities.forEach(a => a.rounds.forEach(r => byRound[r.id] = r));
  resultRows.forEach(r => {
    const round = byRound[String(r[1])]; if (!round) return;
    round.results[String(r[2])] = { found: asBool_(r[3]), points: Number(r[4]) || 0, seconds: r[5] === '' || r[5] == null ? null : Number(r[5]) };
  });
  activities.forEach(a => a.rounds.sort((x,y) => Number(x.order || 0) - Number(y.order || 0)));
  const config = {};
  configRows.forEach(r => config[String(r[0])] = String(r[1]));
  return { wards: wards, activities: activities, activeActivityId: config.activeActivityId || (activities[0] && activities[0].id) || null };
}

/** Guarda el estado completo en pestañas normalizadas, en una única llamada tras cada acción. */
function saveAppState(token, state) {
  requireSession_(token);
  if (!state || !Array.isArray(state.wards) || !Array.isArray(state.activities)) throw new Error('El formato de datos enviado no es válido.');
  if (state.wards.length > 100 || state.activities.length > 500) throw new Error('La cantidad de registros supera el límite permitido.');
  const ss = spreadsheet_();
  ensureSheets_(ss);
  const wards = state.wards.map(w => [String(w.id), String(w.name || '').slice(0,80), w.active !== false]);
  const activities = [];
  const attendance = [];
  const rounds = [];
  const results = [];
  state.activities.forEach(a => {
    activities.push([String(a.id), String(a.name || 'Actividad de Pesquisas').slice(0,150), String(a.date || ''), String(a.status || 'En curso'), String(a.createdAt || '')]);
    const at = a.attendance || {};
    Object.keys(at).forEach(wardId => {
      const x = at[wardId] || {};
      attendance.push([String(a.id), String(wardId), Math.max(0, Number(x.attendees) || 0), !!x.bishop, !!x.seminary, !!x.ym, !!x.yw]);
    });
    (a.rounds || []).forEach((r, index) => {
      rounds.push([String(r.id), String(a.id), index + 1, String(r.scripture || '').slice(0,250), String(r.type || 'normal'), Number(r.earlyPoints) || 0, Number(r.normalPoints) || 0, Number(r.duration) || 10, Number(r.fastSeconds) || 5, Number(r.specialPoints) || 0, String(r.status || 'lista'), r.startedAt == null ? '' : Number(r.startedAt)]);
      Object.keys(r.results || {}).forEach(wardId => {
        const x = r.results[wardId] || {};
        results.push([String(a.id), String(r.id), String(wardId), !!x.found, Number(x.points) || 0, x.seconds == null ? '' : Number(x.seconds)]);
      });
    });
  });
  writeRows_(ss, 'Barrios', wards);
  writeRows_(ss, 'Actividades', activities);
  writeRows_(ss, 'Asistencia', attendance);
  writeRows_(ss, 'Rondas', rounds);
  writeRows_(ss, 'Resultados', results);
  writeRows_(ss, 'Configuracion', [['activeActivityId', String(state.activeActivityId || '')]]);
  SpreadsheetApp.flush();
  return { ok: true, savedAt: new Date().toISOString() };
}

function changeAdminPassword(token, currentPassword, newPassword) {
  requireSession_(token);
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('ADMIN_SALT');
  if (hashPassword_(String(currentPassword || ''), salt) !== props.getProperty('ADMIN_HASH')) return { ok: false, message: 'La contraseña actual no coincide.' };
  const next = String(newPassword || '');
  if (next.length < 8) return { ok: false, message: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  const newSalt = Utilities.getUuid();
  props.setProperties({ ADMIN_SALT: newSalt, ADMIN_HASH: hashPassword_(next, newSalt) });
  return { ok: true };
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('No hay hoja de cálculo vinculada. Ejecuta setupApp() primero.');
  return SpreadsheetApp.openById(id);
}
function requireSession_(token) {
  const value = String(token || '');
  if (!value || !CacheService.getScriptCache().get('session_' + value)) throw new Error('La sesión expiró. Cierra sesión e inicia de nuevo.');
}
function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt || '') + ':' + String(password || ''), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function ensureSheets_(ss) {
  Object.keys(APP_SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = APP_SHEETS[name];
    const first = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (first.join('|') !== headers.join('|')) {
      sh.clear();
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#20395f').setFontColor('#ffffff');
      sh.autoResizeColumns(1, headers.length);
    }
  });
}
function readRows_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, APP_SHEETS[sheetName].length).getValues();
}
function writeRows_(ss, sheetName, rows) {
  const sh = ss.getSheetByName(sheetName);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, APP_SHEETS[sheetName].length).clearContent();
  if (rows.length) {
    if (sheetName === 'Actividades') sh.getRange(2, 3, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, APP_SHEETS[sheetName].length).setValues(rows);
  }
}
function asBool_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function seedInitialData_(ss) {
  const wards = readRows_(ss, 'Barrios');
  const acts = readRows_(ss, 'Actividades');
  if (!wards.length) {
    const examples = ['Barrio 1','Barrio 2','Barrio 3','Barrio 4','Barrio 5'].map((name, i) => [Utilities.getUuid(), name, true]);
    writeRows_(ss, 'Barrios', examples);
  }
  if (!acts.length) {
    const now = new Date();
    const date = Utilities.formatDate(now, Session.getScriptTimeZone() || 'America/Mexico_City', 'yyyy-MM-dd');
    const activityId = Utilities.getUuid();
    writeRows_(ss, 'Actividades', [[activityId, 'Actividad de Pesquisas', date, 'En curso', now.toISOString()]]);
    const rows = readRows_(ss, 'Barrios').map(w => [activityId, String(w[0]), 0, false, false, false, false]);
    writeRows_(ss, 'Asistencia', rows);
    writeRows_(ss, 'Configuracion', [['activeActivityId', activityId]]);
  }
}
