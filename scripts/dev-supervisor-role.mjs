// DEV only. Renames the existing role without changing user assignments.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

process.loadEnvFile(".env");
process.umask(0o077);
const mode = process.argv[2];
assert.ok(["--check", "--dry-run", "--apply", "--qa"].includes(mode) && process.argv.length === 3);
const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
assert.equal(branch, "feature/vision-ocr");
const ref = "gholwtklihaphoevosyb", uri = new URL(process.env.DEV_DB_URL), user = decodeURIComponent(uri.username);
assert.equal(uri.pathname, "/postgres");
assert.ok((uri.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`) || (uri.hostname === `db.${ref}.supabase.co` && user === "postgres"));
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: user, PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
const quote = value => `'${value.replaceAll("'", "''")}'`;
const sha = value => createHash("sha256").update(value).digest("hex");
const unwrap = value => value.replace(/^begin;$/gmi, "").replace(/^(commit|rollback);$/gmi, "");
function sql(input) {
  const result = spawnSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env, input, encoding: "utf8", timeout: 90000, maxBuffer: 45 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function state() {
  return JSON.parse(sql(`begin isolation level repeatable read read only;
select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m),
 'functions',(select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef)) from pg_proc p where p.oid in ('public.complete_dispatch(uuid,integer)'::regprocedure,'public.finalize_dispatch(uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text)'::regprocedure)),
 'tables',(select jsonb_object_agg(name,digest) from(select c.relname name,(xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) as digest from public.%I t',c.relname),false,true,'')))[1]::text digest from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r')t),
 'auth',(select md5(coalesce(jsonb_agg(to_jsonb(u) order by id)::text,'[]')) from auth.users u),
 'roles',(select jsonb_agg(to_jsonb(r) order by id) from public.roles r),
 'permissions',(select jsonb_object_agg(r.code,coalesce((select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id),'[]')) from public.roles r)
);rollback;`));
}
const source = await readFile("supabase/migrations/138_supervisor_dispatch_permissions.sql", "utf8");
const qa = await readFile("supabase/qa/supervisor_dispatch_permissions.sql", "utf8");
const before = state();
console.log(JSON.stringify({ target: "DEV", ref, branch, mode, latest: before.ledger.at(-1)?.version }));
if (mode === "--check") process.exit();
if (mode === "--qa") {
  assert.ok(before.ledger.some(row => row.version === "138"));
  console.log(sql(qa));
  assert.deepEqual(state(), before);
  console.log("DEV_QA_ROLLED_BACK_VERIFIED");
  process.exit();
}
if (before.ledger.some(row => row.version === "138")) {
  assert.deepEqual(before.ledger.find(row => row.version === "138").statements, [source]);
  console.log("ALREADY_APPLIED_DEV_VERIFIED");
  process.exit();
}
assert.equal(before.ledger.at(-1)?.version, "137");
const migration = `${unwrap(source)}
insert into supabase_migrations.schema_migrations(version,name,statements) values('138','supervisor_dispatch_permissions',array[${quote(source)}]);`;
const transaction = `begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';select pg_advisory_xact_lock(hashtextextended('dev-supervisor-role',0));${migration}
savepoint qa;${unwrap(qa)}rollback to savepoint qa;`;
// Every application first exercises all RPC assertions and proves full rollback.
console.log(sql(`${transaction}rollback;`));
assert.deepEqual(state(), before);
if (mode === "--dry-run") {
  console.log("DRY_RUN_DEV_ROLLED_BACK_VERIFIED");
  process.exit();
}
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp("tmp/supervisor-role-DEV-");
await writeFile(`${directory}/before.json`, JSON.stringify(before), { mode: 0o600 });
const dump = spawnSync("pg_dump", ["--format=custom", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--file", `${directory}/before.dump`], { env, encoding: "utf8", timeout: 90000 });
assert.equal(dump.status, 0, dump.stderr);
const verify = spawnSync("pg_restore", ["--list", `${directory}/before.dump`], { encoding: "utf8" });
assert.equal(verify.status, 0);
assert.ok(verify.stdout.includes("project_member_roles"));
await writeFile(`${directory}/backup.json`, JSON.stringify({ ref, migration: "138", sourceSha256: sha(source), backupSha256: sha(await readFile(`${directory}/before.dump`)) }), { mode: 0o600 });
assert.deepEqual(state(), before, "DEV changed during backup; retry the migration");
console.log(sql(`${transaction}commit;`));
const after = state();
assert.deepEqual(after.ledger.find(row => row.version === "138").statements, [source]);
assert.deepEqual(after.ledger.filter(row => row.version !== "138"), before.ledger);
assert.equal(after.auth, before.auth);
for (const [table, digest] of Object.entries(before.tables)) {
  if (!["roles", "permissions", "role_permissions"].includes(table)) assert.equal(after.tables[table], digest, `${table} changed`);
}
assert.deepEqual(after.roles, before.roles.map(role => role.code === "RECEPTION" ? { ...role, code: "SUPERVISOR", name: "Supervisor" } : role));
assert.deepEqual(after.permissions.SUPERVISOR, after.permissions.RESIDENT.filter(code => code !== "dispatch.complete"));
assert.ok(after.permissions.RESIDENT.includes("dispatch.complete"));
assert.ok(after.permissions.COMPANY_ADMIN.includes("dispatch.complete"));
for (const [signature, old] of Object.entries(before.functions)) {
  const next = after.functions[signature];
  for (const key of ["owner", "acl", "config", "definer"]) assert.deepEqual(next[key], old[key]);
  assert.ok(next.body.includes("'dispatch.complete'"));
}
await writeFile(`${directory}/after.json`, JSON.stringify(after), { mode: 0o600 });
console.log(JSON.stringify({ status: "APPLIED_DEV_ONLY_VERIFIED", migration: "138", membershipsPreserved: true, operationalDataPreserved: true, directory }));
