// Release 118 only: explicit target, schema backup, function parity and row preservation.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(".env");
process.umask(0o077);
const args = process.argv.slice(2);
const target = args.find((arg) => /^--target=(DEV|PROD)$/u.test(arg))?.slice(9);
const modes = args.filter((arg) => ["--check", "--dry-run", "--apply"].includes(arg));
if (!target || args.length !== 2 || modes.length !== 1) throw new Error("Use --target=DEV|PROD and --check|--dry-run|--apply.");
const mode = modes[0];
function git(...arguments_) {
  const result = spawnSync("git", arguments_, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git check failed.");
  return result.stdout.trim();
}
const root = git("rev-parse", "--show-toplevel");
if (process.cwd() !== root) throw new Error("Run from repository root.");
const migrationPath = "supabase/migrations/118_service_catalog_supplier_units.sql";
const source = await readFile(migrationPath, "utf8");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sha256 = createHash("sha256").update(source).digest("hex");
function functionBody(text, name) {
  const escaped = name.replaceAll('.', '\\.');
  const match = text.match(new RegExp(`create (?:or replace )?function ${escaped}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'u'));
  if (!match) throw new Error(`Missing definition: ${name}`);
  return match[1].trim();
}
const routines = await Promise.all([
  { name: 'app_private.normalize_service_catalog_unit', signature: 'app_private.normalize_service_catalog_unit(text)', file: '113_service_catalog_dose_unit.sql' },
  { name: 'app_private.resolve_dispatch_guide_lines', signature: 'app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)', file: '113_service_catalog_dose_unit.sql' },
  { name: 'public.platform_import_project_price_catalog', signature: 'public.platform_import_project_price_catalog(uuid,uuid,text,text,text,jsonb)', file: '117_service_catalog_code_variants.sql', unchanged: true },
  { name: 'public.search_project_dispatch_catalog', signature: 'public.search_project_dispatch_catalog(uuid,text,text,integer)', file: '117_service_catalog_code_variants.sql', unchanged: true },
].map(async (routine) => {
  const previous = functionBody(await readFile(`supabase/migrations/${routine.file}`, 'utf8'), routine.name);
  return { ...routine, previous, next: routine.unchanged ? previous : functionBody(source, routine.name) };
}));
const oidList = routines.map((routine) => `${quote(routine.signature)}::regprocedure`).join(',');
const unitKey = 'project_service_prices_unit_code_valid';
const oldDefinition = "CHECK (((unit_code IS NULL) OR (unit_code = ANY (ARRAY['KM'::text, 'M3'::text, 'UN'::text, 'SERVICIO'::text, 'COMBO'::text, 'RECARGO'::text, 'DOSIS/M3'::text]))))";
const newDefinition = oldDefinition.replace("'KM'::text,", "'KM'::text, 'M'::text,");
if (mode === "--apply") {
  if (git("status", "--porcelain") || git("branch", "--show-current") !== (target === "DEV" ? "development" : "main")) {
    throw new Error("Apply requires the clean, committed target branch.");
  }
  if (git("show", `HEAD:${migrationPath}`) !== source.trim()) throw new Error("Uncommitted migration.");
  if (target === "PROD") git("merge-base", "--is-ancestor", "development", "HEAD");
}
const ref = target === "DEV" ? "gholwtklihaphoevosyb" : "jeyjblxfqqlypxiaznad";
const uri = new URL(process.env[`${target}_DB_URL`]);
const user = decodeURIComponent(uri.username);
if (uri.pathname !== "/postgres" || !(
  (uri.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`)
  || (uri.hostname === `db.${ref}.supabase.co` && user === "postgres")
)) throw new Error("Unexpected database target.");
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: user,
  PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() }) : reject(new Error(stderr || "SQL failed.")));
    child.stdin.end(query);
  });
}
async function state() {
  const result = await sql(`begin read only; set local statement_timeout='30s'; select jsonb_build_object(
    'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m where version>='117'),
    'routines',jsonb_build_object(${routines.map((routine) => `${quote(routine.name)},(select prosrc from pg_proc where oid=${quote(routine.signature)}::regprocedure)`).join(",")}),
    'unit_constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.project_service_prices'::regclass and conname=${quote(unitKey)}),
    'other_constraints',(select jsonb_object_agg(conname,pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.project_service_prices'::regclass and conname<>${quote(unitKey)}),
    'linear_unit',(select to_jsonb(u) from public.units_of_measure u where code='M')
  ); rollback;`);
  return JSON.parse(result.stdout);
}
function verifyApplied(current) {
  const entry = current.ledger.find((row) => row.version === "118");
  if (!entry || entry.name !== "service_catalog_supplier_units" || entry.statements?.length !== 1 || entry.statements[0] !== source
    || current.unit_constraint !== newDefinition || current.linear_unit?.code !== 'M'
    || current.linear_unit?.name !== 'Metro lineal' || current.linear_unit?.active !== true
    || routines.some((routine) => current.routines[routine.name]?.trim() !== routine.next)) {
    throw new Error("Applied migration/source/schema mismatch.");
  }
}
const before = await state();
if (!before.ledger?.some((row) => row.version === "117") || before.ledger.some((row) => !["117", "118"].includes(row.version))) throw new Error("Requires migration 117 and no later release.");
if (before.ledger.some((row) => row.version === "118")) {
  verifyApplied(before);
  console.log(JSON.stringify({ status: "ALREADY_APPLIED_VERIFIED", target, version: "118" }));
  process.exit(0);
}
if (before.unit_constraint !== oldDefinition || before.linear_unit
  || routines.some((routine) => before.routines[routine.name]?.trim() !== routine.previous)) throw new Error('Schema or routines differ from reviewed prerequisites.');
console.log(JSON.stringify({ status: "PREFLIGHT_PASS", target, version: "118", sha256 }));
if (mode === "--check") process.exit(0);
if (mode === "--apply") {
  await mkdir(path.join(root, "tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(root, "tmp", `release-118-${target}-`));
  const archive = path.join(directory, "before-schema.dump");
  const dump = spawnSync("pg_dump", ["--format=custom", "--schema-only", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--file", archive], { env, encoding: "utf8" });
  if (dump.status !== 0) throw new Error(dump.stderr || "Schema backup failed.");
  const inspect = spawnSync("pg_restore", ["--list", archive], { encoding: "utf8" });
  if (inspect.status !== 0 || !inspect.stdout.includes(unitKey)) throw new Error("Schema backup is incomplete.");
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ head: git("rev-parse", "HEAD"), target, version: "118", sha256 }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "SCHEMA_BACKUP_CREATED", directory }));
}
if ((source.match(/^begin;$/gmu) ?? []).length !== 1 || (source.match(/^commit;$/gmu) ?? []).length !== 1) throw new Error("Unexpected transaction boundaries.");
const body = source.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
let qa = "";
if (mode === "--dry-run" && target === "DEV") {
  const test = await readFile("supabase/qa/service_catalog_supplier_units.sql", "utf8");
  if ((test.match(/^begin;$/gmu) ?? []).length !== 1 || (test.match(/^rollback;$/gmu) ?? []).length !== 1) throw new Error("Unexpected QA boundaries.");
  qa = `savepoint dev_qa; ${test.replace(/^begin;$/mu, "").replace(/^rollback;$/mu, "")} rollback to savepoint dev_qa; release savepoint dev_qa;`;
}
const routineCheck = (which) => routines.map((routine) => `(select btrim(prosrc,chr(32)||chr(10)||chr(13)||chr(9)) from pg_proc where oid=${quote(routine.signature)}::regprocedure) is distinct from ${quote(routine[which])}`).join(" or ");
const metadata = `select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) from pg_proc p where oid in (${oidList})`;
const transaction = `begin isolation level serializable;
set local lock_timeout='5s'; set local statement_timeout='60s'; set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended(${quote(`release:${target}:118`)},0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version>'117') or ${routineCheck("previous")}
    or exists(select 1 from public.units_of_measure where code='M')
    or not exists(select 1 from pg_constraint where conrelid='public.project_service_prices'::regclass and conname=${quote(unitKey)} and pg_get_constraintdef(oid)=${quote(oldDefinition)}) then
    raise exception 'RELEASE_STATE_CHANGED';
  end if;
end $$;
create temp table release_function on commit drop as select (${metadata}) payload;
create temp table release_constraints on commit drop as select jsonb_object_agg(conname,pg_get_constraintdef(oid)) payload from pg_constraint where conrelid='public.project_service_prices'::regclass and conname<>${quote(unitKey)};
create temp table release_rows(table_name text primary key,row_count bigint,digest text) on commit drop;
do $$ declare r record; v_count bigint; v_digest text; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t %s',r.relname,case when r.relname='units_of_measure' then 'where code<>''M''' else '' end) into v_count,v_digest;
    insert into release_rows values(r.relname,v_count,v_digest);
  end loop;
end $$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements) values('118','service_catalog_supplier_units',array[${quote(source)}]);
${qa}
do $$ declare r record; v_count bigint; v_digest text; begin
  if (${metadata}) is distinct from (select payload from release_function) or ${routineCheck("next")}
    or (select jsonb_object_agg(conname,pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.project_service_prices'::regclass and conname<>${quote(unitKey)}) is distinct from (select payload from release_constraints)
    or not exists(select 1 from pg_constraint where conrelid='public.project_service_prices'::regclass and conname=${quote(unitKey)} and pg_get_constraintdef(oid)=${quote(newDefinition)})
    or not exists(select 1 from public.units_of_measure where code='M' and name='Metro lineal' and active) then
    raise exception 'FUNCTION_METADATA_OR_SERVICE_UNITS_INVALID';
  end if;
  for r in select * from release_rows loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t %s',r.table_name,case when r.table_name='units_of_measure' then 'where code<>''M''' else '' end) into v_count,v_digest;
    if v_count<>r.row_count or v_digest<>r.digest then raise exception 'BUSINESS_ROWS_CHANGED:%',r.table_name; end if;
  end loop;
  raise notice 'PASS: existing public rows and routine owners/ACLs/settings preserved; only M master unit, service constraint and private bodies changed';
end $$;
select jsonb_build_object('preserved_tables',(select count(*) from release_rows),'version','118');
${mode === "--apply" ? "commit;" : "rollback;"}`;
const result = await sql(transaction);
console.log(result.stdout);
if (result.stderr) console.log(result.stderr);
const after = await state();
if (mode === "--apply") {
  verifyApplied(after);
  if (JSON.stringify(before.other_constraints) !== JSON.stringify(after.other_constraints)) throw new Error("Unrelated constraints changed.");
}
else if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("Dry run did not restore initial state.");
console.log(JSON.stringify({ status: mode === "--apply" ? "APPLIED_AND_VERIFIED" : "DRY_RUN_ROLLED_BACK_VERIFIED", target, version: "118" }));
