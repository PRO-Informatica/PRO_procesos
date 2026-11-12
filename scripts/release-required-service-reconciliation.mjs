// Publish the reviewed migration 143 and the specifically audited PROD repair.
// Never run synthetic DEV QA on PROD. Dry runs roll back the entire operation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

process.loadEnvFile(".env"); process.umask(0o077);
const mode = process.argv[2];
assert.ok(["--check", "--dry-run", "--apply", "--verify"].includes(mode) && process.argv.length === 3,
  "Use --check|--dry-run|--apply|--verify (PROD only)");
const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
assert.equal(process.cwd(), git("rev-parse", "--show-toplevel"));
const ref = "jeyjblxfqqlypxiaznad", uri = new URL(process.env.PROD_DB_URL), username = decodeURIComponent(uri.username);
assert.equal(uri.pathname, "/postgres");
assert.ok((uri.hostname.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`) ||
  (uri.hostname === `db.${ref}.supabase.co` && username === "postgres"), "Unexpected PROD target");
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: username,
  PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
const q = (value) => `'${value.replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
function sql(input) {
  const result = spawnSync("/opt/homebrew/bin/psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"],
    { env, input, encoding: "utf8", timeout: 90000, maxBuffer: 30 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  if (result.stderr) process.stderr.write(result.stderr); return result.stdout.trim();
}
const migration = await readFile("supabase/migrations/143_required_service_reconciliation_completion.sql", "utf8");
assert.equal(sha(migration), "e7e27a48bd238b2f64eb03f20e40f49bf59d2aa5c3d579b71901477aeb245339", "Reviewed migration changed");
const repair = await readFile("scripts/lib/repair-prod-required-service-batches.sql", "utf8");
const body = migration.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
const definitions = [...migration.matchAll(/create(?: or replace)? function (\w+\.\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/gu)]
  .map((match) => ({ name: match[1], body: match[2].trim() }));
assert.equal(definitions.length, 4);
const tableDigests = `select jsonb_object_agg(name,digest)from(select format('%I.%I',n.nspname,c.relname)name,
 (xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text)::text,''[]''))digest from %I.%I t',n.nspname,c.relname),false,true,'')))[1]::text digest
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage')and c.relkind in('r','p'))s`;
const schemaFields = `
 'schema',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl)order by p.oid::regprocedure::text)::text)from pg_proc p where p.prokind='f'and p.pronamespace in('public'::regnamespace,'app_private'::regnamespace)),
 'columns',(select md5(jsonb_agg(to_jsonb(c)order by table_name,ordinal_position)::text)from information_schema.columns c where table_schema='public'),
 'constraints',(select md5(jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated)order by conrelid::regclass::text,conname)::text)from pg_constraint where connamespace='public'::regnamespace),
 'other_functions',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl)order by p.oid::regprocedure::text)::text)from pg_proc p where p.prokind='f'and p.pronamespace in('public'::regnamespace,'app_private'::regnamespace)and p.pronamespace::regnamespace::text||'.'||p.proname<>all(array[${definitions.map((d) => q(d.name)).join(",")}])),
 'other_triggers',(select md5(jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)order by t.tgrelid::regclass::text,t.tgname)::text)from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and t.tgname<>'programming_completion_from_reconciliation')`;
const state = () => JSON.parse(sql(`begin isolation level repeatable read read only;set local statement_timeout='45s';
select jsonb_build_object('version',(select max(version)from supabase_migrations.schema_migrations),
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),'tables',(${tableDigests}),${schemaFields});rollback;`));
function verifyApplied(current) {
  const ledger = current.ledger.find((entry) => entry.version === "143");
  assert.equal(ledger?.statements?.[0], migration, "Applied migration differs from reviewed source");
  for (const definition of definitions) {
    const argument = definition.name === "public.get_dispatch_billing_completion" ? "uuid[]" : "uuid";
    assert.equal(sql(`select prosrc from pg_proc where oid=to_regprocedure(${q(`${definition.name}(${argument})`)});`), definition.body);
  }
  const result = JSON.parse(sql(`begin read only;select jsonb_build_object(
    'audit_count',(select count(*)from public.audit_events where entity_id='f154750a-c306-4c1b-b101-fda78ab18b0c'and action='PROD_REQUIRED_SERVICE_COMPLETION_REPAIRED'),
    'open_dispatches',(select count(*)from public.batch_dispatches where batch_id='f154750a-c306-4c1b-b101-fda78ab18b0c'and removed_at is null),
    'stranded',(select count(*)from public.batch_dispatches where batch_id in('170a3723-90a5-40b2-adb4-21b5fc752b53','f5eca458-a464-443e-9bdb-b2337b9ee57c')and removed_at is null),
    'pending_programmings',(select count(*)from public.batch_dispatches bd join public.dispatches d on d.id=bd.dispatch_id join public.programming p on p.id=d.programming_id where bd.batch_id='f154750a-c306-4c1b-b101-fda78ab18b0c'and bd.removed_at is null and p.status='DISPATCH_COMPLETED'and not app_private.dispatch_billing_complete(d.id)));rollback;`));
  assert.deepEqual(result, { audit_count: 1, open_dispatches: 6, stranded: 0, pending_programmings: 6 });
  return result;
}
const before = state();
assert.ok(["142", "143"].includes(before.version), "Unexpected PROD migration state");
console.log(JSON.stringify({ target: "PROD", ref, version: before.version, mode, migrationSha256: sha(migration), repairSha256: sha(repair) }));
if (mode === "--verify" || before.version === "143") {
  assert.equal(before.version, "143"); console.log(JSON.stringify({ status: "PROD_RELEASE_VERIFIED", ...verifyApplied(before) })); process.exit();
}
if (mode === "--check") process.exit();
if (mode === "--apply") {
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(git("status", "--porcelain"), "", "Commit the reviewed release first");
  git("merge-base", "--is-ancestor", "development", "HEAD");
}
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp("tmp/required-service-PROD-release-");
await writeFile(`${directory}/before.json`, JSON.stringify(before));
await writeFile(`${directory}/manifest.json`, JSON.stringify({ ref, mode, head: git("rev-parse", "HEAD"), migrationSha256: sha(migration), repairSha256: sha(repair) }, null, 2));
if (mode === "--apply") {
  const file = `${directory}/before.dump`;
  const dump = spawnSync("/opt/homebrew/bin/pg_dump", ["--format=custom", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--schema=auth", "--schema=storage", "--file", file], { env, encoding: "utf8", timeout: 90000 });
  assert.equal(dump.status, 0, dump.stderr);
  const list = spawnSync("/opt/homebrew/bin/pg_restore", ["--list", file], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  assert.equal(list.status, 0, list.stderr);
  for (const table of ["batch_dispatches", "programming", "invoices", "dispatch_guides", "users", "objects"]) assert.ok(list.stdout.includes(table));
  await writeFile(`${directory}/backup.json`, JSON.stringify({ verified: true, sha256: sha(await readFile(file)) }));
  assert.deepEqual(state(), before, "PROD changed during backup; retry preflight");
  console.log(JSON.stringify({ status: "BACKUP_VERIFIED", directory }));
}
const assertTables = (excluded = []) => `do $$declare actual jsonb;k text;begin actual:=(${tableDigests});
 for k in select jsonb_object_keys(${q(JSON.stringify(before.tables))}::jsonb)loop
 if not(k=any(array[${excluded.map(q).join(",")}]::text[]))and actual->>k is distinct from ${q(JSON.stringify(before.tables))}::jsonb->>k
 then raise exception 'PRESERVED_DATA_CHANGED:%',k;end if;end loop;end $$;`;
const transaction = `begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='75s';set local idle_in_transaction_session_timeout='75s';
select pg_advisory_xact_lock(hashtextextended('PROD:required-service-reconciliation',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$declare r record;begin for r in select c.oid::regclass name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'order by c.oid loop execute format('lock table %s in share row exclusive mode',r.name);end loop;
if (select max(version)from supabase_migrations.schema_migrations)<>'142'then raise exception 'PROD_RELEASE_STATE_CHANGED';end if;end $$;
${assertTables()}
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)values('143','required_service_reconciliation_completion',array[${q(migration)}]);
${assertTables()}
select set_config('app.required_service_repair_prod_guard','jeyjblxfqqlypxiaznad',true);
${repair}
${assertTables(["public.programming", "public.programming_revisions", "public.programming_revision_lines", "public.batch_dispatches", "public.audit_events"])}
${mode === "--apply" ? "commit" : "rollback"};`;
await writeFile(`${directory}/transaction.sql`, transaction);
console.log(sql(transaction));
const after = state(); await writeFile(`${directory}/after.json`, JSON.stringify(after));
if (mode === "--dry-run") assert.deepEqual(after, before, "PROD dry run did not fully roll back");
else {
  for (const field of ["columns", "constraints", "other_functions", "other_triggers"]) assert.equal(after[field], before[field], `Unrelated schema changed: ${field}`);
  assert.deepEqual(after.ledger.filter((entry) => entry.version !== "143"), before.ledger);
  console.log(JSON.stringify(verifyApplied(after)));
}
console.log(JSON.stringify({ status: mode === "--apply" ? "PROD_APPLIED_DATA_AND_HISTORY_PRESERVED" : "PROD_DRY_RUN_ROLLBACK_VERIFIED", directory }));
