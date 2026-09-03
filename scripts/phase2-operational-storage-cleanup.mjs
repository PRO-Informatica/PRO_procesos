import { loadEnvFile } from "node:process";

import { createClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env");
} catch {
  // Environment variables may already be supplied by the caller.
}

const execute = process.argv.includes("--execute");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sources = [
  ["programming_documents", "document_id"],
  ["guide_documents", "document_id"],
  ["incident_documents", "document_id"],
  ["batch_documents", "document_id"],
  ["invoice_documents", "document_id"],
  ["mixto_listo_invoice_intakes", "document_id"],
];
const documentIds = new Set();
for (const [table, column] of sources) {
  const { data, error } = await supabase.from(table).select(column);
  if (error) throw new Error(`${table}: ${error.message}`);
  for (const row of data ?? []) if (row[column]) documentIds.add(row[column]);
}

const versions = [];
for (const ids of Array.from(documentIds).reduce((chunks, id, index) => {
  const chunk = Math.floor(index / 100);
  (chunks[chunk] ??= []).push(id);
  return chunks;
}, [])) {
  const { data, error } = await supabase
    .from("document_versions")
    .select("document_id, storage_bucket, storage_path")
    .in("document_id", ids);
  if (error) throw new Error(`document_versions: ${error.message}`);
  versions.push(...(data ?? []));
}

const uniqueObjects = [...new Map(
  versions.map((version) => [
    `${version.storage_bucket}:${version.storage_path}`,
    { bucket: version.storage_bucket, path: version.storage_path },
  ]),
).values()];

process.stdout.write(`${JSON.stringify({
  mode: execute ? "EXECUTE" : "DRY_RUN",
  operationalDocuments: documentIds.size,
  storageObjects: uniqueObjects.length,
  objects: uniqueObjects,
}, null, 2)}\n`);

if (!execute) {
  process.stdout.write("DRY_RUN: no se eliminó ningún objeto. Usa --execute inmediatamente antes de ejecutar la migración 079.\n");
  process.exit(0);
}

const objectsByBucket = new Map();
for (const object of uniqueObjects) {
  const paths = objectsByBucket.get(object.bucket) ?? [];
  paths.push(object.path);
  objectsByBucket.set(object.bucket, paths);
}
for (const [bucket, paths] of objectsByBucket) {
  for (let index = 0; index < paths.length; index += 100) {
    const selected = paths.slice(index, index + 100);
    const { error } = await supabase.storage.from(bucket).remove(selected);
    if (error) throw new Error(`${bucket}: ${error.message}`);
  }
}
process.stdout.write(`Eliminados ${uniqueObjects.length} objetos operativos inventariados; ningún otro path fue afectado.\n`);
