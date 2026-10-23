import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const projectId = "78f495d6-d721-4b65-94f0-fdc94a03b8df";
const documentId = "28f495d6-d721-4b65-94f0-fdc94a03b8df";
const dispatchId = "38f495d6-d721-4b65-94f0-fdc94a03b8df";
const source = await readFile(new URL("../src/features/dispatches/actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ authorized = true, available = true, rpcError = null, storageFailure = "" } = {}) {
  const events = [];
  const filters = {};
  const revalidated = [];
  const storageRemovals = [];
  const query = {
    select() { return query; },
    eq(key, value) { filters[key] = value; return query; },
    maybeSingle: async () => ({ data: available ? { id: documentId } : null, error: null }),
  };
  const supabase = {
    from(table) { assert.equal(table, "documents"); events.push("query"); return query; },
    async rpc(name, args) {
      events.push("rpc");
      assert.equal(name, "remove_dispatch_evidence");
      assert.equal(args.p_document_id, documentId);
      return { error: rpcError, data: {
        dispatch_id: dispatchId,
        storage_objects: [
          { bucket: "private-documents", path: "qa/version-1" },
          { bucket: "private-documents", path: "qa/version-2" },
          { bucket: "other-private", path: "qa/version-3" },
        ],
      } };
    },
  };
  const imports = {
    "next/cache": { revalidatePath: path => revalidated.push(path) },
    "@/features/auth/queries": { requireActiveProfile: async () => ({ id: projectId }) },
    "@/features/projects/queries": {
      getProjectContext: async () => ({ status: "ready", activeProject: { id: projectId }, permissions: authorized ? ["dispatch.modify"] : [] }),
    },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/supabase/admin": {
      createAdminClient() {
        if (storageFailure === "config") throw new Error("Admin configuration unavailable");
        return { storage: { from: bucket => ({
          async remove(paths) {
            events.push("storage"); storageRemovals.push({ bucket, paths });
            if (storageFailure === "throw") throw new Error("Storage unavailable");
            return { error: storageFailure === "error" ? { message: "Storage unavailable" } : null };
          },
        }) } };
      },
    },
    "./validation": {}, "./registration": {},
  };
  const exports = {};
  runInNewContext(compiled, { exports, require(path) {
    assert.ok(Object.hasOwn(imports, path), `Unexpected import: ${path}`);
    return imports[path];
  } });
  return { remove: exports.removeDispatchEvidenceAction, events, filters, revalidated, storageRemovals };
}

test("elimina los archivos solo después del RPC exitoso y agrupa todas las versiones por bucket", async () => {
  const f = fixture();
  const result = await f.remove(projectId, documentId);
  assert.equal(result.status, "success");
  assert.equal(result.storageCleanupPending, false);
  assert.deepEqual(f.events, ["query", "rpc", "storage", "storage"]);
  assert.equal(f.filters.project_id, projectId);
  assert.equal(f.filters.id, documentId);
  assert.equal(f.storageRemovals.length, 2);
  assert.equal(f.storageRemovals[0].paths.length, 2);
  assert.ok(f.revalidated.includes(`/dispatches/${dispatchId}`));
  assert.ok(f.revalidated.includes("/documents"));
});

test("un documento no disponible en el proyecto se rechaza antes de eliminar datos o archivos", async () => {
  const f = fixture({ available: false });
  assert.equal((await f.remove(projectId, documentId)).status, "error");
  assert.deepEqual(f.events, ["query"]);
});

test("sin permiso no se consultan documentos ni se solicita eliminación", async () => {
  const f = fixture({ authorized: false });
  assert.equal((await f.remove(projectId, documentId)).status, "error");
  assert.equal(f.events.length, 0);
});

test("un fallo del RPC conserva Storage y devuelve un mensaje de negocio específico", async () => {
  for (const [message, expected] of [
    ["DISPATCH_COMPLETED_NOT_EDITABLE", /completado/u],
    ["DISPATCH_EVIDENCE_IN_USE", /historial de procesamiento/u],
    ["DISPATCH_DOCUMENT_NOT_FOUND", /ya no está disponible/u],
  ]) {
    const f = fixture({ rpcError: { message } });
    const result = await f.remove(projectId, documentId);
    assert.equal(result.status, "error");
    assert.match(result.message, expected);
    assert.equal(f.storageRemovals.length, 0);
  }
});

test("un fallo de Storage informa limpieza pendiente tras el borrado ya confirmado", async () => {
  for (const storageFailure of ["error", "throw", "config"]) {
    const f = fixture({ storageFailure });
    const result = await f.remove(projectId, documentId);
    assert.equal(result.status, "success");
    assert.equal(result.storageCleanupPending, true);
    assert.ok(f.revalidated.includes(`/dispatches/${dispatchId}`));
  }
});
