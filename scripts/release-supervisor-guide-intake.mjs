// Release migration 144 only. Preserve historical data and role assignments.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

process.loadEnvFile(process.env.RELEASE_ENV_FILE ?? ".env");
process.umask(0o077);
const [target, mode] = process.argv.slice(2);
const refs = { DEV: "gholwtklihaphoevosyb", PROD: "jeyjblxfqqlypxiaznad" };
assert.ok(Object.hasOwn(refs, target) && ["--check", "--dry-run", "--apply", "--verify"].includes(mode) && process.argv.length === 4,
  "Use DEV|PROD --check|--dry-run|--apply|--verify");
const ref = refs[target], uri = new URL(process.env[`${target}_DB_URL`]), username = decodeURIComponent(uri.username);
assert.equal(uri.pathname, "/postgres");
assert.ok((uri.hostname.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`) ||
  (uri.hostname === `db.${ref}.supabase.co` && username === "postgres"), "Unexpected database target");
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: username,
  PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
const quote = value => `'${value.replaceAll("'", "''")}'`;
const sha = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
function sql(input) {
  const result = spawnSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"],
    { env, input, encoding: "utf8", timeout: 90000, maxBuffer: 40 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
const migration = await readFile("supabase/migrations/144_supervisor_guide_intake_only.sql", "utf8");
assert.equal(sha(migration), "5bfd0762e05a7723c1f64392c0552ea850401562421a4a0af5b52f45a8d2afe2", "Reviewed migration changed");
const signatures = [
  "public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time without time zone,time without time zone)",
  "public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time without time zone,time without time zone)",
  "app_private.save_guide_resident(uuid,text,boolean)",
  "app_private.save_guide_details(uuid,jsonb)",
  "app_private.record_guide_catalog_incident(uuid)",
  "public.commit_vision_ocr_guide(uuid,integer,text)",
  "public.prepare_guide_document_upload(uuid,text,text,bigint,text,uuid)",
  "app_private.resolve_dispatch_document_mutation(uuid)",
];
const tableDigests = `select jsonb_object_agg(name,digest)from(select format('%I.%I',n.nspname,c.relname)name,
 (xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text)::text,''[]''))digest from %I.%I t',n.nspname,c.relname),false,true,'')))[1]::text digest
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage')and c.relkind in('r','p'))s`;
const functions = `select jsonb_object_agg(s.signature,jsonb_build_object('definition',pg_get_functiondef(p.oid),
 'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef))
 from(values ${signatures.map(s => `(${quote(s)})`).join(",")})s(signature)join pg_proc p on p.oid=to_regprocedure(s.signature)`;
const stateQuery = `select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
 'tables',(${tableDigests}),'functions',(${functions}),
 'schema',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef)order by p.oid::regprocedure::text)::text)from pg_proc p where p.prokind='f'and p.pronamespace in('public'::regnamespace,'app_private'::regnamespace)and p.oid<>all(array[${signatures.map(s => `to_regprocedure(${quote(s)})`).join(",")}])),
 'columns',(select md5(jsonb_agg(to_jsonb(c)order by table_name,ordinal_position)::text)from information_schema.columns c where table_schema='public'),
 'constraints',(select md5(jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated)order by conrelid::regclass::text,conname)::text)from pg_constraint where connamespace='public'::regnamespace),
 'triggers',(select md5(jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)order by t.tgrelid::regclass::text,t.tgname)::text)from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace),
 'roles',(select jsonb_agg(to_jsonb(r)order by id)from public.roles r),
 'permissions',(select jsonb_object_agg(r.code,coalesce((select jsonb_agg(p.code order by p.code)from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id),'[]'))from public.roles r));`;
const state = () => JSON.parse(sql(`begin isolation level repeatable read read only;set local statement_timeout='60s';${stateQuery}rollback;`));
const allowed = ["programming.view", "dispatch.view", "document.view", "dispatch.create", "dispatch.manage_guides"];
function verifyApplied(current) {
  const entry = current.ledger.find(row => row.version === "144");
  assert.deepEqual(entry?.statements, [migration], "Applied migration differs from source");
  assert.equal(Object.keys(current.functions).length, signatures.length);
  for (const role of ["SUPERVISOR", "RECEPTION"].filter(code => Object.hasOwn(current.permissions, code))) {
    assert.deepEqual(current.permissions[role], allowed.toSorted(), `${role} grants differ`);
  }
  for (const signature of signatures.slice(0, -1)) {
    assert.ok(current.functions[signature].definition.includes("'dispatch.manage_guides'"));
    assert.ok(!current.functions[signature].definition.includes("'dispatch.modify'"));
  }
  const finalizer = current.functions[signatures.at(-1)].definition;
  assert.ok(finalizer.includes("'GUIDE_DOCUMENT_PERMISSION_DENIED'"));
  assert.ok(finalizer.includes("'dispatch.modify'"));
}
function verifyPreserved(before, after) {
  verifyApplied(after);
  assert.deepEqual(after.ledger.filter(row => row.version !== "144"), before.ledger);
  for (const field of ["schema", "columns", "constraints", "triggers", "roles"]) assert.deepEqual(after[field], before[field], `Unrelated change: ${field}`);
  for (const [table, digest] of Object.entries(before.tables)) {
    if (!["public.permissions", "public.role_permissions"].includes(table)) assert.equal(after.tables[table], digest, `${table} data changed`);
  }
  for (const [role, codes] of Object.entries(before.permissions)) {
    let expected = codes.includes("dispatch.modify") ? [...new Set([...codes, "dispatch.manage_guides"])] : codes;
    if (["SUPERVISOR", "RECEPTION"].includes(role)) expected = expected.filter(code => allowed.includes(code));
    assert.deepEqual(after.permissions[role], expected.toSorted(), `Unexpected grants: ${role}`);
  }
  for (const signature of signatures) {
    for (const field of ["owner", "acl", "config", "definer"]) assert.deepEqual(after.functions[signature][field], before.functions[signature][field]);
    if (signature !== signatures.at(-1)) assert.equal(after.functions[signature].definition,
      before.functions[signature].definition.replace("'dispatch.modify'", "'dispatch.manage_guides'"));
  }
}
const before = state(), latest = before.ledger.at(-1)?.version;
console.log(JSON.stringify({ target, ref, mode, latest, migrationSha256: sha(migration) }));
assert.ok(["143", "144"].includes(latest), "Unexpected migration state");
if (latest === "144") { verifyApplied(before); console.log("RELEASE_144_VERIFIED"); process.exit(); }
assert.notEqual(mode, "--verify", "Migration 144 is not applied");
assert.equal(Object.keys(before.functions).length, signatures.length);
if (mode === "--check") process.exit();
const body = migration.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
function transaction(commit) {
  return `begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='75s';
  do $$declare r record;begin perform pg_advisory_xact_lock(hashtextextended(${quote(`${target}:supervisor-guide-intake`)},0));
  for r in select c.oid::regclass name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'order by c.oid loop execute format('lock table %s in share row exclusive mode',r.name);end loop;
  if (select max(version)from supabase_migrations.schema_migrations)<>'143'then raise exception 'RELEASE_STATE_CHANGED';end if;
  if (${tableDigests})is distinct from ${quote(JSON.stringify(before.tables))}::jsonb then raise exception 'RELEASE_DATA_CHANGED_RETRY';end if;end $$;
  lock table supabase_migrations.schema_migrations in share row exclusive mode;
  ${body}
  insert into supabase_migrations.schema_migrations(version,name,statements)values('144','supervisor_guide_intake_only',array[${quote(migration)}]);
  ${stateQuery}${commit ? "commit" : "rollback"};`;
}
// Always prove the actual migration can be rolled back before applying it.
const rehearsal = JSON.parse(sql(transaction(false)));
verifyPreserved(before, rehearsal);
assert.deepEqual(state(), before, "Dry run did not fully roll back or database changed; retry");
console.log("DRY_RUN_144_ROLLBACK_AND_DATA_PRESERVATION_VERIFIED");
if (mode === "--dry-run") process.exit();
assert.equal(git("branch", "--show-current"), target === "DEV" ? "development" : "main");
assert.equal(git("status", "--porcelain"), "", "Commit the reviewed release first");
if (target === "PROD") git("merge-base", "--is-ancestor", "origin/development", "HEAD");
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(`tmp/supervisor-guide-intake-${target}-`);
await writeFile(`${directory}/before.json`, JSON.stringify(before));
const backup = `${directory}/before.dump`;
const dump = spawnSync("pg_dump", ["--format=custom", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--schema=auth", "--schema=storage", "--file", backup],
  { env, encoding: "utf8", timeout: 90000 });
assert.equal(dump.status, 0, dump.stderr);
const list = spawnSync("pg_restore", ["--list", backup], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
assert.equal(list.status, 0, list.stderr);
for (const table of ["programming", "dispatches", "dispatch_guides", "invoices", "project_member_roles", "users", "objects"]) assert.ok(list.stdout.includes(table));
await writeFile(`${directory}/manifest.json`, JSON.stringify({ target, ref, head: git("rev-parse", "HEAD"), migrationSha256: sha(migration), backupSha256: sha(await readFile(backup)) }));
assert.deepEqual(state(), before, "Database changed during backup; retry preflight");
await writeFile(`${directory}/transaction.sql`, transaction(true));
const applied = JSON.parse(sql(transaction(true)));
verifyPreserved(before, applied);
const after = state(); verifyApplied(after);
await writeFile(`${directory}/after.json`, JSON.stringify(after));
console.log(JSON.stringify({ status: `${target}_144_APPLIED_AND_VERIFIED`, operationalDataPreserved: true, assignmentsPreserved: true, directory }));
