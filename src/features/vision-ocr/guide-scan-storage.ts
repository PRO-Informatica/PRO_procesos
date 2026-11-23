import type { AppEnvironment } from "@/lib/env";
import type { PreparedGuideImage } from "./image-preparation";

const STORE = "draft-parts";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const META = "session";

type Part = { scope: string; name: string; expiresAt: number; value: unknown };
type Change = Record<string, unknown>;

export type GuideScanStorage = {
  get<T>(part: string): T | undefined;
  save(changes: Change): Promise<void>;
  clear(): Promise<void>;
};

let connection: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("pro-guide-scans", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: ["scope", "name"] });
        store.createIndex("expiresAt", "expiresAt");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("El almacenamiento de borradores está ocupado."));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); connection = undefined; };
        resolve(database);
      };
    }).catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("No se pudo guardar el borrador."));
  });
}

function dispatchPrefix(environment: AppEnvironment, projectId: string, dispatchId: string) {
  return `${environment}/${projectId}/${dispatchId}/`;
}

export function guideScanScope(environment: AppEnvironment, projectId: string, dispatchId: string, actorId: string) {
  return dispatchPrefix(environment, projectId, dispatchId) + actorId;
}

function partRange(scope: string) {
  return IDBKeyRange.bound([scope], [scope, "\uffff"]);
}

export async function openGuideScanStorage(scope: string, onFailure: () => void): Promise<GuideScanStorage> {
  const database = await openDatabase();
  const owner = crypto.randomUUID();
  const transaction = database.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  const now = Date.now();
  const parts = new Map<string, unknown>();
  const expired = store.index("expiresAt").getAllKeys(IDBKeyRange.upperBound(now));
  expired.onsuccess = () => {
    for (const key of expired.result) store.delete(key);
    const request = store.getAll(partRange(scope));
    request.onsuccess = () => {
      const records = request.result as Part[];
      const session = records.find((record) => record.name === META);
      if (session) for (const record of records) {
        if (record.name !== META) parts.set(record.name, record.value);
      }
      store.put({ scope, name: META, expiresAt: session?.expiresAt ?? now + RETENTION_MS, value: owner } satisfies Part);
    };
  };
  await finished(transaction);

  async function update(changes: Change, clear = false) {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get([scope, META]);
      let accepted = false;
      request.onsuccess = () => {
        const meta = request.result as Part | undefined;
        // A second window can resume this draft. An older writer must not
        // overwrite its work or recreate a draft after the dispatch closes.
        if (!meta || meta.value !== owner || meta.expiresAt <= Date.now()) return;
        accepted = true;
        if (clear) {
          store.delete(partRange(scope));
          store.put({ ...meta, expiresAt: Date.now() + RETENTION_MS });
        } else {
          for (const [name, value] of Object.entries(changes)) {
            if (value === null) store.delete([scope, name]);
            else store.put({ scope, name, expiresAt: meta.expiresAt, value } satisfies Part);
          }
        }
      };
      await finished(transaction);
      if (!accepted) { onFailure(); return; }
      if (clear) parts.clear();
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) parts.delete(name);
        else parts.set(name, value);
      }
    } catch {
      onFailure();
    }
  }

  return {
    get<T>(part: string) { return parts.get(part) as T | undefined; },
    save: (changes) => update(changes),
    clear: () => update({}, true),
  };
}

export async function clearCompletedGuideScans(environment: AppEnvironment, projectId: string, dispatchId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  const prefix = dispatchPrefix(environment, projectId, dispatchId);
  transaction.objectStore(STORE).delete(IDBKeyRange.bound([prefix], [prefix + "\uffff"]));
  await finished(transaction);
}

export type StoredGuideImage = Omit<PreparedGuideImage, "preview">;

export function storeGuideImage({ file, quality, enhanced, previewBlob }: PreparedGuideImage): StoredGuideImage {
  return { file, quality, enhanced, previewBlob };
}

export function restoreGuideImage(image: StoredGuideImage): PreparedGuideImage {
  return { ...image, preview: URL.createObjectURL(image.previewBlob ?? image.file) };
}
