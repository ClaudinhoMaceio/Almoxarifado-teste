/**
 * Gestão Técnica DASCO — Google Apps Script (Web App)
 * Padrão: um arquivo JSON principal na pasta do Drive (cria se não existir).
 *
 * 1) Troque ROOT_FOLDER_ID pelo ID da sua pasta no Google Drive.
 * 2) Implante como Web App: Executar como = Eu | Acesso = Qualquer pessoa.
 *
 * Opcional: o frontend pode enviar folderId na query (GET) ou no JSON (POST)
 * para usar outra pasta sem alterar esta constante.
 *
 * Pasta atual: https://drive.google.com/drive/folders/1B10CWA4s1Dy1h5JDV5qkFFT-fwdxuiBX
 */
const ROOT_FOLDER_ID = '1B10CWA4s1Dy1h5JDV5qkFFT-fwdxuiBX';
const MAIN_DB_FILENAME = 'database.json';
const DEFAULT_VERSION = 1;

function getRootFolderId() {
  return typeof ROOT_FOLDER_ID !== 'undefined' && ROOT_FOLDER_ID
    ? String(ROOT_FOLDER_ID)
    : '';
}

function getMainDbFilename() {
  return typeof MAIN_DB_FILENAME !== 'undefined' && MAIN_DB_FILENAME
    ? String(MAIN_DB_FILENAME)
    : 'database.json';
}

/** Resolve pasta: query/body folderId tem prioridade sobre ROOT_FOLDER_ID. */
function resolveFolderIdFromGet(e) {
  var q = e && e.parameter && e.parameter.folderId;
  if (q) return String(q).trim();
  return getRootFolderId();
}

function resolveFolderIdFromPayload(payload) {
  var p = payload && payload.folderId;
  if (p) return String(p).trim();
  return getRootFolderId();
}

function doGet(e) {
  try {
    var action = String((e && e.parameter && e.parameter.action) || 'ping');
    var folderId = resolveFolderIdFromGet(e);

    if (action === 'ping') {
      return jsonOutput({ ok: true, serverTime: new Date().toISOString(), mainDb: getMainDbFilename() });
    }
    if (action === 'pullMainDatabase') {
      return jsonOutput(pullMainDatabase(folderId));
    }
    if (action === 'initMainDatabase') {
      var fileName = String((e && e.parameter && e.parameter.fileName) || getMainDbFilename());
      return jsonOutput(initMainDatabase(folderId, fileName));
    }

    return jsonOutput({ ok: false, error: 'Ação GET inválida. Use action=ping|pullMainDatabase|initMainDatabase' });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function doPost(e) {
  try {
    var payload = parseBody(e);
    var action = String(payload.action || '');
    var folderId = resolveFolderIdFromPayload(payload);

    if (action === 'initMainDatabase') {
      return jsonOutput(initMainDatabase(folderId, payload.fileName || getMainDbFilename()));
    }
    if (action === 'pushMainDatabase') {
      return jsonOutput(pushMainDatabase(folderId, payload.fileName || getMainDbFilename(), payload.data));
    }

    return jsonOutput({ ok: false, error: 'Ação POST inválida. Use initMainDatabase ou pushMainDatabase.' });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  var raw = String(e.postData.contents || '');
  if (!raw) return {};
  return JSON.parse(raw);
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureRootFolder(overrideFolderId) {
  var folderId = String(overrideFolderId || '').trim() || getRootFolderId();
  if (folderId) {
    return DriveApp.getFolderById(folderId);
  }
  var folders = DriveApp.getFoldersByName('GestaoTecnicaDASCO');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('GestaoTecnicaDASCO');
}

function defaultDascoData() {
  return {
    obras: [],
    funcionarios: [],
    materiais: [],
    residuos: [],
    combustivel: [],
    outrosCustos: [],
    dividasFixas: [],
    veiculos: [],
    premiacoes: [],
    medicoes: [],
    config: { lastBackup: null }
  };
}

function defaultState() {
  return {
    type: 'dasco_backup_completo',
    version: DEFAULT_VERSION,
    updatedAt: new Date().toISOString(),
    data: defaultDascoData()
  };
}

function normalizeDataBlock(d) {
  d = d || {};
  return {
    obras: Array.isArray(d.obras) ? d.obras : [],
    funcionarios: Array.isArray(d.funcionarios) ? d.funcionarios : [],
    materiais: Array.isArray(d.materiais) ? d.materiais : [],
    residuos: Array.isArray(d.residuos) ? d.residuos : [],
    combustivel: Array.isArray(d.combustivel) ? d.combustivel : [],
    outrosCustos: Array.isArray(d.outrosCustos) ? d.outrosCustos : [],
    dividasFixas: Array.isArray(d.dividasFixas) ? d.dividasFixas : [],
    veiculos: Array.isArray(d.veiculos) ? d.veiculos : [],
    premiacoes: Array.isArray(d.premiacoes) ? d.premiacoes : [],
    medicoes: Array.isArray(d.medicoes) ? d.medicoes : [],
    config: d.config && typeof d.config === 'object' ? d.config : { lastBackup: null }
  };
}

function normalizeState(raw) {
  var state = defaultState();
  if (!raw || typeof raw !== 'object') {
    state.updatedAt = new Date().toISOString();
    return state;
  }
  if (raw.type === 'dasco_backup_completo' && raw.data && typeof raw.data === 'object') {
    state.type = raw.type;
    state.version = Number(raw.version || DEFAULT_VERSION);
    state.data = normalizeDataBlock(raw.data);
    state.updatedAt = raw.updatedAt || new Date().toISOString();
    return state;
  }
  state.data = normalizeDataBlock(raw);
  state.updatedAt = new Date().toISOString();
  return state;
}

function readJsonFile(file) {
  try {
    var txt = file.getBlob().getDataAsString('UTF-8');
    return txt ? JSON.parse(txt) : defaultState();
  } catch (error) {
    return defaultState();
  }
}

function writeJsonFile(file, payload) {
  file.setContent(JSON.stringify(normalizeState(payload), null, 2));
}

function getOrCreateFile(folder, filename, initialState) {
  var files = folder.getFilesByName(filename);
  if (files.hasNext()) return { file: files.next(), created: false };
  var content = JSON.stringify(normalizeState(initialState || defaultState()), null, 2);
  var newFile = folder.createFile(filename, content, MimeType.PLAIN_TEXT);
  return { file: newFile, created: true };
}

function initMainDatabase(folderIdOverride, fileName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var folder = ensureRootFolder(folderIdOverride);
    var resolvedName = String(fileName || getMainDbFilename());
    var result = getOrCreateFile(folder, resolvedName, defaultState());
    return {
      ok: true,
      created: result.created,
      fileName: resolvedName,
      fileId: result.file.getId()
    };
  } finally {
    lock.releaseLock();
  }
}

function pullMainDatabase(folderIdOverride) {
  var folder = ensureRootFolder(folderIdOverride);
  var resolved = getOrCreateFile(folder, getMainDbFilename(), defaultState());
  var parsed = readJsonFile(resolved.file);
  return { ok: true, data: normalizeState(parsed), created: resolved.created };
}

function pushMainDatabase(folderIdOverride, fileName, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var folder = ensureRootFolder(folderIdOverride);
    var resolvedName = String(fileName || getMainDbFilename());
    var result = getOrCreateFile(folder, resolvedName, defaultState());
    writeJsonFile(result.file, data || defaultState());
    return { ok: true, fileName: resolvedName, fileId: result.file.getId() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Rode manualmente no editor do Apps Script para criar o database.json na pasta.
 */
function criarDatabaseJsonAgora() {
  var folderId = getRootFolderId();
  var result = initMainDatabase(folderId, getMainDbFilename());
  var folder = ensureRootFolder(folderId);
  return {
    ok: true,
    folderId: folder.getId(),
    folderUrl: 'https://drive.google.com/drive/folders/' + folder.getId(),
    fileName: getMainDbFilename(),
    created: !!result.created,
    fileId: result.fileId || ''
  };
}
