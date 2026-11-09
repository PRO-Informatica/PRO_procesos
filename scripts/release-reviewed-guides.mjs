// Release only the reviewed guide/radar migrations; preserve original business rows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { historicalGuideMigration, migrationBody } from "./lib/historical-guide-migrations.mjs";

process.loadEnvFile(".env"); process.umask(0o077);
const args = process.argv.slice(2);
const target = args.find((arg) => /^--target=(DEV|PROD)$/u.test(arg))?.slice(9);
const mode = args.find((arg) => ["--check", "--dry-run", "--apply"].includes(arg));
assert.ok(target && mode && args.length === 2, "Use --target=DEV|PROD --check|--dry-run|--apply");
const ref = target === "DEV" ? "gholwtklihaphoevosyb" : "jeyjblxfqqlypxiaznad";
const uri = new URL(process.env[`${target}_DB_URL`]), username = decodeURIComponent(uri.username);
assert.equal(uri.pathname, "/postgres");
assert.ok((uri.hostname.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`) || (uri.hostname === `db.${ref}.supabase.co` && username === "postgres"));
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: username, PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
const q = (value) => `'${value.replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
function git(...values) { const r = spawnSync("git", values, { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function sql(input) {
  const r = spawnSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env, input, encoding: "utf8", timeout: 90000, maxBuffer: 45 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
assert.equal(process.cwd(), git("rev-parse", "--show-toplevel"));
if (mode === "--apply") {
  assert.equal(git("branch", "--show-current"), target === "PROD" ? "main" : "development");
  assert.equal(git("status", "--porcelain"), "", "Commit the reviewed release before applying");
}
function state() {
  return JSON.parse(sql(`begin isolation level repeatable read read only;
select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m),
 'columns',(select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from information_schema.columns c where table_schema='public' and table_name in ('dispatch_guides','programming','programming_revisions')),
 'schema',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl) order by p.oid::regprocedure::text)::text) from pg_proc p where p.prokind='f' and p.pronamespace in ('public'::regnamespace,'app_private'::regnamespace)),
 'tables',(select jsonb_object_agg(name,digest) from (select format('%I.%I',n.nspname,c.relname) name,
 (xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) as digest from %I.%I t',n.nspname,c.relname),false,true,'')))[1]::text digest
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind in ('r','p')) s)
);rollback;`));
}
const before = state(), applied = new Set(before.ledger.map((row) => row.version));
for (const required of ["130", "133", "134"]) assert.ok(applied.has(required), `Missing prerequisite ${required}`);
assert.ok(!before.ledger.some((row) => row.version > "142"), "Unexpected later migration");
const versions = ["131", "132", "135", "136", "137", "138", "139", "140", "141", "142"];
const names = await readdir("supabase/migrations");
const plan = [];
for (const version of versions) {
  if (applied.has(version)) continue;
  const name = names.find((file) => file.startsWith(`${version}_`)); assert.ok(name);
  const canonical = await readFile(`supabase/migrations/${name}`, "utf8");
  const effective = target === "PROD" ? historicalGuideMigration(version, canonical) : canonical;
  plan.push({ version, name: name.slice(4, -4), canonical, effective });
}
function verifyColumns(s) {
  for (const name of ["laboratory_applied", "details"]) {
    const column = s.columns.find((row) => row.table_name === "dispatch_guides" && row.column_name === name);
    assert.equal(column?.is_nullable, "YES"); assert.equal(column.column_default, null);
  }
}
if (!plan.length) { verifyColumns(before); console.log(JSON.stringify({ status: "ALREADY_APPLIED_VERIFIED", target, version: "142" })); process.exit(); }
if (target === "DEV") assert.deepEqual(plan.map((row) => row.version), ["141", "142"]);
else {
  assert.deepEqual(plan.map((row) => row.version), versions);
  for (const column of before.columns) assert.ok(!["casting_element", "laboratory_applied", "details"].includes(column.column_name), "PROD historical fields already exist; review instead of overwriting");
}
console.log(JSON.stringify({ status: "PREFLIGHT_PASS", target, pending: plan.map((row) => row.version), historicalValues: target === "PROD" ? "NULL" : "preserved" }));
if (mode === "--check") process.exit();
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(`tmp/release-reviewed-guides-${target}-`);
await writeFile(`${directory}/before.json`, JSON.stringify(before));
await writeFile(`${directory}/manifest.json`, JSON.stringify({ target, ref, head: git("rev-parse", "HEAD"), migrations: plan.map((row) => ({ version: row.version, canonicalSha256: sha(row.canonical), effectiveSha256: sha(row.effective) })) }, null, 2));
if (mode === "--apply") {
  const file = `${directory}/before.dump`;
  const dump = spawnSync("pg_dump", ["--format=custom", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--schema=auth", "--schema=storage", "--file", file], { env, encoding: "utf8", timeout: 90000 });
  assert.equal(dump.status, 0, dump.stderr);
  const list = spawnSync("pg_restore", ["--list", file], { encoding: "utf8", maxBuffer: 15 * 1024 * 1024 });
  assert.equal(list.status, 0, list.stderr);
  for (const table of ["dispatch_guides", "programming", "users", "objects"]) assert.ok(list.stdout.includes(table));
  await writeFile(`${directory}/backup.json`, JSON.stringify({ verified: true, archiveSha256: sha(await readFile(file)) }));
  assert.deepEqual(state(), before, "Database changed during backup; retry preflight");
  console.log(JSON.stringify({ status: "BACKUP_VERIFIED", target, directory }));
}
const isProd = target === "PROD";
const snapshot = `
create temp table release_rows(name text primary key,n bigint,digest text,columns text[]) on commit drop;
do $$ declare r record;n bigint;d text;cols text[];begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind in ('r','p') loop
  if format('%I.%I',r.nspname,r.relname)='storage.buckets' or (${isProd} and format('%I.%I',r.nspname,r.relname) in ('public.roles','public.permissions','public.role_permissions')) then continue;end if;
  select array_agg(attname order by attnum) into cols from pg_attribute where attrelid=format('%I.%I',r.nspname,r.relname)::regclass and attnum>0 and not attisdropped;
  execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from %I.%I t',r.nspname,r.relname) into n,d;
  insert into release_rows values(format('%I.%I',r.nspname,r.relname),n,d,cols);
 end loop;
end $$;
create temp table release_roles on commit drop as select id,code,to_jsonb(r) row_data from public.roles r;
create temp table release_permissions on commit drop as select id,code,to_jsonb(p) row_data from public.permissions p;
create temp table release_role_permissions on commit drop as select role_id,permission_id from public.role_permissions;
create temp table release_buckets on commit drop as select id,to_jsonb(b) row_data from storage.buckets b;
`;
const validate = `
do $$ declare r record;n bigint;d text;added text[];begin
 for r in select * from release_rows loop
  select coalesce(array_agg(attname),'{}') into added from pg_attribute where attrelid=r.name::regclass and attnum>0 and not attisdropped and attname<>all(r.columns);
  if cardinality(added)>0 and not (${isProd} and ((r.name='public.dispatch_guides' and added<@array['casting_element','laboratory_applied','details']) or (r.name in ('public.programming','public.programming_revisions') and added=array['casting_element']))) then raise exception 'UNEXPECTED_COLUMNS:%',r.name;end if;
  execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-$1 order by (to_jsonb(t)-$1)::text)::text,''[]'')) from %s t',r.name) into n,d using added;
  if n<>r.n or d<>r.digest then raise exception 'PRESERVED_ROWS_CHANGED:%',r.name;end if;
 end loop;
 if ${isProd} then
  if exists(select 1 from public.dispatch_guides where casting_element is not null or laboratory_applied is not null or details is not null)
   or exists(select 1 from public.programming where casting_element is not null)
   or exists(select 1 from public.programming_revisions where casting_element is not null) then raise exception 'HISTORICAL_FIELDS_NOT_NULL';end if;
  if exists(select 1 from public.guide_ocr_captures) then raise exception 'HISTORICAL_CAPTURE_CREATED';end if;
  if (select count(*) from public.roles)<>(select count(*) from release_roles) or exists(select 1 from release_roles old left join public.roles deployed_role using(id)
   where deployed_role.id is null or (to_jsonb(deployed_role)-array['code','name','updated_at'])<>(old.row_data-array['code','name','updated_at'])
    or deployed_role.code<>case old.code when 'RECEPTION' then 'SUPERVISOR' else old.code end
    or deployed_role.name<>case old.code when 'RECEPTION' then 'Supervisor' else old.row_data->>'name' end) then raise exception 'ROLE_IDS_OR_ASSIGNMENTS_CHANGED';end if;
  if exists(select 1 from release_permissions old left join public.permissions p using(id) where p.id is null or (old.code<>'dispatch.complete' and to_jsonb(p)<>old.row_data))
   or exists(select 1 from public.permissions p where p.id not in(select id from release_permissions) and p.code<>'dispatch.complete') then raise exception 'UNRELATED_PERMISSIONS_CHANGED';end if;
  if exists(select 1 from release_buckets old left join storage.buckets b using(id) where b.id is null or to_jsonb(b)<>old.row_data)
   or exists(select 1 from storage.buckets b where b.id not in(select id from release_buckets) and b.id not in ('vision-ocr-dev','vision-ocr-prod'))
   or not exists(select 1 from storage.buckets where id='vision-ocr-dev' and not public) then raise exception 'EXISTING_STORAGE_CHANGED';end if;
 end if;
 if exists(select 1 from release_buckets old left join storage.buckets b using(id) where b.id is null or to_jsonb(b)<>old.row_data)
  or not exists(select 1 from storage.buckets where id='vision-ocr-prod' and not public) then raise exception 'EXISTING_STORAGE_CHANGED';end if;
end $$;
${isProd ? `
create temp table expected_role_permissions on commit drop as
with prior as (
 select role_id,permission_id from release_role_permissions where role_id<>(select id from release_roles where code='RECEPTION')
 union select (select id from release_roles where code='RESIDENT'),permission_id from release_role_permissions where role_id=(select id from release_roles where code='RECEPTION')
), completed as (
 select * from prior union select distinct role_id,(select id from public.permissions where code='dispatch.complete') from prior where permission_id=(select id from public.permissions where code='dispatch.modify')
)
select * from completed union select (select id from release_roles where code='RECEPTION'),permission_id from completed where role_id=(select id from release_roles where code='RESIDENT') and permission_id<>(select id from public.permissions where code='dispatch.complete');
do $$ begin if exists((select role_id,permission_id from public.role_permissions except select * from expected_role_permissions) union all (select * from expected_role_permissions except select role_id,permission_id from public.role_permissions)) then raise exception 'UNEXPECTED_ROLE_PERMISSIONS';end if;end $$;` : ""}
select jsonb_build_object('preserved_tables',(select count(*) from release_rows),'guides',(select count(*) from public.dispatch_guides),'dispatches',(select count(*) from public.dispatches),'historical_guides_all_new_fields_null',${isProd} and not exists(select 1 from public.dispatch_guides where casting_element is not null or laboratory_applied is not null or details is not null),'version','142');
`;
const transaction = `begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:reviewed-guides',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ declare r record;begin for r in select c.oid::regclass name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by c.oid loop execute format('lock table %s in share row exclusive mode',r.name);end loop;end $$;
do $$ begin if (select array_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from array[${before.ledger.map((row) => q(row.version)).sort().join(",")}]::text[] then raise exception 'RELEASE_STATE_CHANGED';end if;end $$;
${snapshot}
${plan.map((row) => `${migrationBody(row.effective)}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${q(row.version)},${q(row.name)},array[${q(row.effective)}]);`).join("\n")}
${validate}
${mode === "--apply" ? "commit" : "rollback"};`;
await writeFile(`${directory}/transaction.sql`, transaction);
console.log(sql(transaction));
const after = state();
await writeFile(`${directory}/after.json`, JSON.stringify(after));
if (mode === "--dry-run") assert.deepEqual(after, before, "Dry-run did not fully roll back");
else {
  verifyColumns(after);
  for (const row of plan) assert.deepEqual(after.ledger.find((entry) => entry.version === row.version)?.statements, [row.effective]);
}
console.log(JSON.stringify({ status: mode === "--apply" ? "APPLIED_AND_PRESERVED_VERIFIED" : "DRY_RUN_ROLLED_BACK_VERIFIED", target, directory }));
