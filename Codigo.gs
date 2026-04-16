const ROOT_FOLDER_ID = "1dQ47OF8nmOMPnBGRE1IeTSZ-WR4lo-DG";
const MAIN_DB_FILENAME = "database.json";
const WAREHOUSE_PREFIX = "warehouse_";
const DEFAULT_VERSION = 1;

function getRootFolderId() {
  return typeof ROOT_FOLDER_ID !== "undefined" && ROOT_FOLDER_ID
    ? String(ROOT_FOLDER_ID)
    : "1dQ47OF8nmOMPnBGRE1IeTSZ-WR4lo-DG";
}

function getMainDbFilename() {
  return typeof MAIN_DB_FILENAME !== "undefined" && MAIN_DB_FILENAME
    ? String(MAIN_DB_FILENAME)
    : "database.json";
}

function getWarehousePrefix() {
  return typeof WAREHOUSE_PREFIX !== "undefined" && WAREHOUSE_PREFIX
    ? String(WAREHOUSE_PREFIX)
    : "warehouse_";
}

function resolveRuntimeOptions(input) {
  const src = input || {};
  return {
    rootFolderId: String(src.rootFolderId || src.rootFolderID || "").trim(),
    fileName: String(src.fileName || "").trim(),
    warehousePrefix: String(src.warehousePrefix || "").trim()
  };
}

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || "ping");
    const warehouseId = String((e && e.parameter && e.parameter.warehouseId) || "wh_1");
    const runtime = resolveRuntimeOptions((e && e.parameter) || {});

    if (action === "ping") return jsonOutput({ ok: true, serverTime: new Date().toISOString() });
    if (action === "pull") return jsonOutput(pullWarehouseData(warehouseId, runtime));
    if (action === "pullMainDatabase") return jsonOutput(pullMainDatabase(runtime));
    if (action === "initWarehouse") return jsonOutput(initWarehouseOnce(warehouseId, warehouseId, runtime));
    if (action === "initMainDatabase") return jsonOutput(initMainDatabase(runtime.fileName || getMainDbFilename(), runtime));

    return jsonOutput({ ok: false, error: "Ação GET inválida." });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function doPost(e) {
  try {
    const payload = parseBody(e);
    const action = String(payload.action || "");
    const runtime = resolveRuntimeOptions(payload);

    if (action === "initWarehouse") {
      return jsonOutput(initWarehouseOnce(payload.warehouseId, payload.warehouseName, runtime));
    }
    if (action === "push") {
      return jsonOutput(pushWarehouseData(payload.warehouseId, payload.data, runtime));
    }
    if (action === "initMainDatabase") {
      return jsonOutput(initMainDatabase(payload.fileName || getMainDbFilename(), runtime));
    }
    if (action === "pushMainDatabase") {
      return jsonOutput(pushMainDatabase(payload.fileName || getMainDbFilename(), payload.data, runtime));
    }

    return jsonOutput({ ok: false, error: "Ação POST inválida." });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const raw = String(e.postData.contents || "");
  if (!raw) return {};
  return JSON.parse(raw);
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureRootFolder(runtime) {
  const folderId = String((runtime && runtime.rootFolderId) || getRootFolderId() || "").trim();
  if (folderId) return DriveApp.getFolderById(folderId);
  const folders = DriveApp.getFoldersByName("almoxarifado");
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder("almoxarifado");
}

function defaultState() {
  return {
    version: DEFAULT_VERSION,
    settings: { systemName: "SANEGESTAO", primaryColor: "#0284c7" },
    users: [],
    warehouses: [],
    items: [],
    orders: [],
    logs: [],
    replenishments: [],
    unitCatalog: ["UN", "M", "KG", "L", "CX", "PCT", "JG", "ROL", "M2", "M3"],
    updatedAt: new Date().toISOString()
  };
}

function normalizeState(raw) {
  const state = raw || {};
  state.version = Number(state.version || DEFAULT_VERSION);
  state.settings = state.settings || { systemName: "SANEGESTAO", primaryColor: "#0284c7" };
  state.users = Array.isArray(state.users) ? state.users : [];
  state.warehouses = Array.isArray(state.warehouses) ? state.warehouses : [];
  state.items = Array.isArray(state.items) ? state.items : [];
  state.orders = Array.isArray(state.orders) ? state.orders : [];
  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.replenishments = Array.isArray(state.replenishments) ? state.replenishments : [];
  state.unitCatalog = Array.isArray(state.unitCatalog) ? state.unitCatalog : [];

  state.items = state.items.map(function (i) {
    return {
      id: i.id || makeId("it"),
      code: i.code || "",
      name: i.name || "Item",
      category: i.category || "MATERIAL",
      area: i.area || "PROPRIO",
      unit: i.unit || "UN",
      warehouseId: i.warehouseId || "wh_1",
      qty: Number(i.qty || 0),
      minQty: Number(i.minQty || 0),
      updatedAt: i.updatedAt || new Date().toISOString()
    };
  });

  state.orders = state.orders.map(function (o) {
    const lines = Array.isArray(o.lines) ? o.lines : [];
    return {
      id: o.id || makeId("req"),
      requesterUserId: o.requesterUserId || "desconhecido",
      requesterName: o.requesterName || "Solicitante",
      requesterSignature: o.requesterSignature || "",
      warehouseId: o.warehouseId || "wh_1",
      status: o.status || "pending",
      requestDate: o.requestDate || o.date || new Date().toISOString(),
      updatedAt: o.updatedAt || o.date || new Date().toISOString(),
      lines: lines.map(function (l) {
        const qtyRequested = Number(l.qtyRequested || 1);
        const qtyDeliveredRaw = typeof l.qtyDelivered === "undefined" ? qtyRequested : Number(l.qtyDelivered || 0);
        const qtyDelivered = qtyDeliveredRaw < 0 ? 0 : qtyDeliveredRaw;
        const qtyUsedRaw = Number(l.qtyUsed || 0);
        const qtyUsed = qtyUsedRaw < 0 ? 0 : (qtyUsedRaw > qtyDelivered ? qtyDelivered : qtyUsedRaw);
        return {
          lineId: l.lineId || makeId("line"),
          itemId: l.itemId || "",
          itemName: l.itemName || "Item",
          qtyRequested: qtyRequested,
          qtyDelivered: qtyDelivered,
          qtyUsed: qtyUsed,
          unit: l.unit || "UN",
          separated: Boolean(l.separated)
        };
      })
    };
  });

  state.replenishments = state.replenishments.map(function (r) {
    return {
      id: r.id || makeId("rep"),
      itemId: r.itemId || "",
      itemCode: r.itemCode || "",
      itemName: r.itemName || "Item",
      warehouseId: r.warehouseId || "wh_1",
      qty: Number(r.qty || 0),
      unit: r.unit || "UN",
      date: r.date || new Date().toISOString(),
      user: r.user || "sistema",
      userName: r.userName || "Sistema",
      updatedAt: r.updatedAt || new Date().toISOString()
    };
  });

  state.unitCatalog = uniqueUpper(state.unitCatalog.concat(state.items.map(function (i) { return i.unit; })));
  state.updatedAt = new Date().toISOString();
  return state;
}

function uniqueUpper(list) {
  const seen = {};
  const out = [];
  (list || []).forEach(function (value) {
    const token = String(value || "").toUpperCase().trim();
    if (!token || seen[token]) return;
    seen[token] = true;
    out.push(token);
  });
  return out;
}

function readJsonFile(file) {
  try {
    const txt = file.getBlob().getDataAsString("UTF-8");
    return txt ? JSON.parse(txt) : defaultState();
  } catch (error) {
    return defaultState();
  }
}

function writeJsonFile(file, payload) {
  file.setContent(JSON.stringify(normalizeState(payload), null, 2));
}

function getOrCreateFile(folder, filename, initialState) {
  const files = folder.getFilesByName(filename);
  if (files.hasNext()) return { file: files.next(), created: false };
  const content = JSON.stringify(normalizeState(initialState || defaultState()), null, 2);
  const newFile = folder.createFile(filename, content, MimeType.PLAIN_TEXT);
  return { file: newFile, created: true };
}

function initMainDatabase(fileName, runtime) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = ensureRootFolder(runtime);
    const resolvedName = String(fileName || (runtime && runtime.fileName) || getMainDbFilename());
    const result = getOrCreateFile(folder, resolvedName, defaultState());
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

function pullMainDatabase(runtime) {
  const folder = ensureRootFolder(runtime);
  const resolvedName = String((runtime && runtime.fileName) || getMainDbFilename());
  const resolved = getOrCreateFile(folder, resolvedName, defaultState());
  const parsed = readJsonFile(resolved.file);
  return { ok: true, data: normalizeState(parsed), created: resolved.created };
}

function pushMainDatabase(fileName, data, runtime) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = ensureRootFolder(runtime);
    const resolvedName = String(fileName || (runtime && runtime.fileName) || getMainDbFilename());
    const result = getOrCreateFile(folder, resolvedName, defaultState());
    writeJsonFile(result.file, data || defaultState());
    return { ok: true, fileName: resolvedName, fileId: result.file.getId() };
  } finally {
    lock.releaseLock();
  }
}

function getWarehouseFileName(warehouseId, runtime) {
  const id = String(warehouseId || "wh_1").trim() || "wh_1";
  const prefix = String((runtime && runtime.warehousePrefix) || getWarehousePrefix() || "").trim();
  const fileBase = prefix ? `${prefix}${id}` : id;
  return `${fileBase}.json`;
}

function initWarehouseOnce(warehouseId, warehouseName, runtime) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = ensureRootFolder(runtime);
    const id = String(warehouseId || "wh_1");
    const fileName = getWarehouseFileName(id, runtime);
    const initial = defaultState();
    initial.warehouses = [{ id: id, name: String(warehouseName || id), city: "", phone: "" }];
    const result = getOrCreateFile(folder, fileName, initial);
    return { ok: true, warehouseId: id, created: result.created, fileId: result.file.getId(), fileName: fileName };
  } finally {
    lock.releaseLock();
  }
}

function pullWarehouseData(warehouseId, runtime) {
  const folder = ensureRootFolder(runtime);
  const id = String(warehouseId || "wh_1");
  const result = getOrCreateFile(folder, getWarehouseFileName(id, runtime), defaultState());
  const state = normalizeState(readJsonFile(result.file));
  return { ok: true, warehouseId: id, data: state, created: result.created };
}

function pushWarehouseData(warehouseId, data, runtime) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = ensureRootFolder(runtime);
    const id = String(warehouseId || "wh_1");
    const result = getOrCreateFile(folder, getWarehouseFileName(id, runtime), defaultState());
    writeJsonFile(result.file, data || defaultState());
    return { ok: true, warehouseId: id, fileId: result.file.getId() };
  } finally {
    lock.releaseLock();
  }
}

function makeId(prefix) {
  return String(prefix || "id") + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 10);
}

/**
 * Execução manual no editor do Apps Script para criar o database.json na pasta.
 * Use esta função quando quiser forçar a criação sem passar pelo frontend.
 */
function criarDatabaseJsonAgora() {
  const result = initMainDatabase(getMainDbFilename());
  const folder = ensureRootFolder();
  return {
    ok: true,
    folderId: folder.getId(),
    folderUrl: "https://drive.google.com/drive/folders/" + folder.getId(),
    fileName: getMainDbFilename(),
    created: !!result.created,
    fileId: result.fileId || ""
  };
}
