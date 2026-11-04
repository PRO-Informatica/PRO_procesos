// Release 119 only. Explicit target, source parity, rollback QA, backup and row preservation.
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
const git = (...arguments_) => {
  const result = spawnSync("git", arguments_, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git check failed.");
  return result.stdout.trim();
};
const root = git("rev-parse", "--show-toplevel");
if (process.cwd() !== root) throw new Error("Run from repository root.");
const migrationPath = "supabase/migrations/119_service_catalog_unitario_alias.sql";
const source = await readFile(migrationPath, "utf8");
const oldSource = await readFile("supabase/migrations/118_service_catalog_supplier_units.sql", "utf8");
const functionBody = (text) => {
  const match = text.match(/create or replace function app_private\.normalize_service_catalog_unit\([\s\S]*?as \$\$([\s\S]*?)\$\$;/u);
  if (!match) throw new Error("Unit normalizer definition missing.");
  return match[1].trim();
};
const previousBody = functionBody(oldSource), nextBody = functionBody(source);
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
const signature = "app_private.normalize_service_catalog_unit(text)";
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
async function state() {
  const result = await sql(`begin read only; set local statement_timeout='30s'; select jsonb_build_object(
    'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m where version>='118'),
    'definition',pg_get_functiondef(${quote(signature)}::regprocedure),
    'body',(select prosrc from pg_proc where oid=${quote(signature)}::regprocedure)); rollback;`);
  return JSON.parse(result.stdout);
}
function verifyApplied(current) {
  const entry = current.ledger.find((row) => row.version === "119");
  if (!entry || entry.name !== "service_catalog_unitario_alias" || entry.statements?.length !== 1
    || entry.statements[0] !== source || current.body.trim() !== nextBody) throw new Error("Applied migration/source mismatch.");
}
const before = await state();
if (!before.ledger?.some((row) => row.version === "118") || before.ledger.some((row) => !["118", "119"].includes(row.version))) {
  throw new Error("Unexpected migration history; requires 118, no later release.");
}
if (before.ledger.some((row) => row.version === "119")) {
  verifyApplied(before);
  console.log(JSON.stringify({ status: "ALREADY_APPLIED_VERIFIED", target, version: "119" }));
  process.exit(0);
}
if (before.body.trim() !== previousBody) throw new Error("Current unit normalizer differs from reviewed 118.");
console.log(JSON.stringify({ status: "PREFLIGHT_PASS", target, version: "119", sha256: createHash("sha256").update(source).digest("hex") }));
if (mode === "--check") process.exit(0);
if (mode === "--apply") {
  await mkdir(path.join(root, "tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(root, "tmp", `release-119-${target}-`));
  await writeFile(path.join(directory, "before-function.sql"), before.definition, { mode: 0o600 });
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ head: git("rev-parse", "HEAD"), target,
    version: "119", sha256: createHash("sha256").update(source).digest("hex") }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "FUNCTION_BACKUP_CREATED", directory }));
}
if ((source.match(/^begin;$/gmu) ?? []).length !== 1 || (source.match(/^commit;$/gmu) ?? []).length !== 1) throw new Error("Unexpected transaction boundaries.");
const body = source.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
let qa = "";
if (mode === "--dry-run" && target === "DEV") {
  const test = await readFile("supabase/qa/service_catalog_unitario_alias.sql", "utf8");
  if ((test.match(/^begin;$/gmu) ?? []).length !== 1 || (test.match(/^rollback;$/gmu) ?? []).length !== 1) throw new Error("Unexpected QA boundaries.");
  qa = `savepoint dev_qa; ${test.replace(/^begin;$/mu, "").replace(/^rollback;$/mu, "")} rollback to savepoint dev_qa; release savepoint dev_qa;`;
}
const transaction = `begin isolation level serializable;
set local lock_timeout='5s'; set local statement_timeout='60s'; set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended(${quote(`release:${target}:119`)},0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version>'118')
    or (select btrim(prosrc,chr(32)||chr(10)||chr(13)||chr(9)) from pg_proc where oid=${quote(signature)}::regprocedure)<>${quote(previousBody)} then
    raise exception 'RELEASE_STATE_CHANGED';
  end if;
end $$;
create temp table release_function on commit drop as select to_jsonb(p)-'prosrc' payload from pg_proc p where oid=${quote(signature)}::regprocedure;
create temp table release_rows(table_name text primary key,row_count bigint,digest text) on commit drop;
do $$ declare r record; v_count bigint; v_digest text; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',r.relname) into v_count,v_digest;
    insert into release_rows values(r.relname,v_count,v_digest);
  end loop;
end $$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements) values('119','service_catalog_unitario_alias',array[${quote(source)}]);
${qa}
do $$ declare r record; v_count bigint; v_digest text; begin
  if (select to_jsonb(p)-'prosrc' from pg_proc p where oid=${quote(signature)}::regprocedure) is distinct from (select payload from release_function)
    or (select btrim(prosrc,chr(32)||chr(10)||chr(13)||chr(9)) from pg_proc where oid=${quote(signature)}::regprocedure)<>${quote(nextBody)} then
    raise exception 'FUNCTION_METADATA_OR_BODY_CHANGED_UNEXPECTEDLY';
  end if;
  for r in select * from release_rows loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',r.table_name) into v_count,v_digest;
    if v_count<>r.row_count or v_digest<>r.digest then raise exception 'BUSINESS_ROWS_CHANGED:%',r.table_name; end if;
  end loop;
  raise notice 'PASS: all public rows, function owner, signature, ACL and security settings preserved';
end $$;
select jsonb_build_object('preserved_tables',(select count(*) from release_rows),'version','119');
${mode === "--apply" ? "commit;" : "rollback;"}`;
const result = await sql(transaction);
console.log(result.stdout);
if (result.stderr) console.log(result.stderr);
const after = await state();
if (mode === "--apply") verifyApplied(after);
else if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("Dry run did not restore initial state.");
console.log(JSON.stringify({ status: mode === "--apply" ? "APPLIED_AND_VERIFIED" : "DRY_RUN_ROLLED_BACK_VERIFIED", target, version: "119" }));
