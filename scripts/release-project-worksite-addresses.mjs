// Release 129 only: additive schema, atomic platform RPC, preserved operational data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

process.loadEnvFile(".env");
process.umask(0o077);
const args = process.argv.slice(2);
const target = args.find((arg) => /^--target=(DEV|PROD)$/u.test(arg))?.slice(9);
const mode = args.find((arg) => ["--check", "--dry-run", "--apply"].includes(arg));
assert.ok(target && mode && args.length === 2, "Use --target=DEV|PROD --check|--dry-run|--apply");
const ref = target === "DEV" ? "gholwtklihaphoevosyb" : "jeyjblxfqqlypxiaznad";
const uri = new URL(process.env[`${target}_DB_URL`]);
const username = decodeURIComponent(uri.username);
assert.equal(uri.pathname, "/postgres");
assert.ok((uri.hostname.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`) || (uri.hostname === `db.${ref}.supabase.co` && username === "postgres"));
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: username, PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
const q = (s) => `'${s.replaceAll("'", "''")}'`;
const sha = (s) => createHash("sha256").update(s).digest("hex");
function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
assert.equal(process.cwd(), git("rev-parse", "--show-toplevel"));
if (mode === "--apply" && target === "PROD") {
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(git("status", "--porcelain"), "");
}
function sql(input) {
  const result = spawnSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env, input, encoding: "utf8", timeout: 90000, maxBuffer: 35 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  if (result.stderr.trim()) console.log(result.stderr.trim());
  return result.stdout.trim();
}
const source = await readFile("supabase/migrations/129_project_worksite_addresses.sql", "utf8");
const priorSource = await readFile("supabase/migrations/099_not_dispatched_incident_programmed_quantity.sql", "utf8");
const priorBody = [...priorSource.matchAll(/create or replace function public\.reconcile_dispatch\([\s\S]*?as \$\$([\s\S]*?)\$\$;/gu)][0]?.[1].trim();
assert.ok(priorBody, "Missing reviewed product reconciliation prerequisite");
const anchor = "project.billing_tax_id, v_payload ->> 'billing_tax_id', project.address,";
const replacement = "project.billing_tax_id, v_payload ->> 'billing_tax_id',\n    case when (v_payload ->> 'matched_project_address') = any(array[project.address] || project.additional_addresses)\n      then v_payload ->> 'matched_project_address' else project.address end,";
const newSignatures = ["app_private.valid_project_additional_addresses(text[])", "public.platform_save_company_project(uuid,uuid,text,text,text,text[],text,text,date,date,text,text)"];
function state() {
  return JSON.parse(sql(`begin read only;select jsonb_build_object(
    'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
    'column',(select to_jsonb(c)from information_schema.columns c where table_schema='public'and table_name='projects'and column_name='additional_addresses'),
    'functions',(select jsonb_object_agg(signature,jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef))from unnest(array['public.reconcile_dispatch(uuid)',${newSignatures.map(q).join(",")}])signature left join pg_proc p on p.oid=to_regprocedure(signature)),
    'other_functions',(select md5(jsonb_agg(pg_get_functiondef(oid)order by oid)::text)from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace)and prokind='f'and oid not in(select to_regprocedure(s)from unnest(array['public.reconcile_dispatch(uuid)',${newSignatures.map(q).join(",")}])s where to_regprocedure(s)is not null)),
    'constraints',(select md5(jsonb_agg(jsonb_build_array(conrelid,conname,pg_get_constraintdef(oid),convalidated)order by oid)::text)from pg_constraint where connamespace='public'::regnamespace and conname<>'projects_additional_addresses_ck'),
    'triggers',(select md5(jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled)order by t.oid)::text)from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace)
  );rollback;`));
}
function verifyApplied(s) {
  const ledger = s.ledger.find((m) => m.version === "129");
  assert.deepEqual(ledger?.statements, [source]);
  assert.equal(ledger.name, "project_worksite_addresses");
  assert.equal(s.column?.udt_name, "_text");
  assert.equal(s.column?.is_nullable, "NO");
  assert.equal(s.functions["public.reconcile_dispatch(uuid)"].body.trim(), priorBody.replace(anchor, replacement));
  const save = s.functions[newSignatures[1]];
  assert.equal(save.definer, true);
  assert.ok(save.acl.some((entry) => entry.startsWith("authenticated=X/")));
  assert.ok(!save.acl.some((entry) => /^(anon|)=/u.test(entry)));
  assert.ok(save.config.includes("search_path=pg_catalog, public, app_private"));
}
const before = state();
assert.ok(before.ledger.some((m) => m.version === "128"));
assert.ok(!before.ledger.some((m) => m.version > "129"));
if (before.ledger.some((m) => m.version === "129")) {
  verifyApplied(before);
  console.log(JSON.stringify({ status: "ALREADY_APPLIED_VERIFIED", target, version: "129" }));
  process.exit();
}
assert.equal(before.column, null);
assert.equal(before.functions["public.reconcile_dispatch(uuid)"].body.trim(), priorBody);
for (const signature of newSignatures) assert.equal(before.functions[signature].body, null);
console.log(JSON.stringify({ status: "PREFLIGHT_PASS", target, version: "129" }));
if (mode === "--check") process.exit();
const directory = await mkdtemp(`${process.cwd()}/tmp/release-129-${target}-`);
await writeFile(`${directory}/before.json`, JSON.stringify(before), { mode: 0o600 });
if (mode === "--apply") {
  const archive = `${directory}/before.dump`;
  const dump = spawnSync("pg_dump", ["--format=custom", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--file", archive], { env, encoding: "utf8", timeout: 90000 });
  assert.equal(dump.status, 0, dump.stderr);
  const restored = spawnSync("pg_restore", ["--file=-", archive], { encoding: "utf8", maxBuffer: 35 * 1024 * 1024 });
  assert.equal(restored.status, 0, restored.stderr);
  assert.ok(restored.stdout.includes("COPY public.projects (") && restored.stdout.includes("COPY public.dispatches (") && restored.stdout.includes(priorBody));
  await writeFile(`${directory}/backup.json`, JSON.stringify({ target, ref, head: git("rev-parse", "HEAD"), migrationSha256: sha(source), archiveSha256: sha(await readFile(archive)) }), { mode: 0o600 });
}
let qa = "";
if (mode === "--dry-run" && target === "DEV") {
  const configQa = await readFile("supabase/qa/project_worksite_addresses.sql", "utf8");
  let invoiceQa = await readFile("supabase/qa/service_invoice_total_reconciliation.sql", "utf8");
  const alias = "QA SECONDARY WORKSITE 129 ZONA 9";
  const invoiceAnchor = "'validations',jsonb_build_object('document_valid',true";
  assert.ok(invoiceQa.includes(invoiceAnchor));
  invoiceQa = invoiceQa.replace(invoiceAnchor, `'shipping_address',${q(alias)},'matched_project_address',${q(alias)},${invoiceAnchor}`);
  const projectAnchor = "v_today := (clock_timestamp() at time zone v_timezone)::date;";
  assert.ok(invoiceQa.includes(projectAnchor));
  invoiceQa = invoiceQa.replace(projectAnchor, `update public.projects set additional_addresses=array_append(additional_addresses,${q(alias)})where id=v_project;${projectAnchor}`);
  const snapshotCheck = `do $$ begin if not exists(select 1 from public.dispatch_reconciliation_attempts where expected_order_number like 'QA-validator-%'and expected_project_address=${q(alias)})then raise exception 'QA_MATCHED_SECONDARY_ADDRESS_SNAPSHOT_FAILED';end if;end $$;`;
  const unwrap = (body) => body.replace(/^begin;$/mu, "").replace(/^rollback;$/mu, "");
  qa = `savepoint config_qa;${unwrap(configQa)}rollback to savepoint config_qa;release savepoint config_qa;
savepoint invoice_qa;${unwrap(invoiceQa)}${snapshotCheck}rollback to savepoint invoice_qa;release savepoint invoice_qa;`;
  await writeFile(`${directory}/qa.sql`, qa, { mode: 0o600 });
}
assert.equal((source.match(/^begin;$/gmu) ?? []).length, 1);
assert.equal((source.match(/^commit;$/gmu) ?? []).length, 1);
const body = source.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
console.log(sql(`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:129',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin if exists(select 1 from supabase_migrations.schema_migrations where version>'128')then raise exception 'RELEASE_STATE_CHANGED';end if;end $$;
create temp table release_rows(name text primary key,n bigint,digest text)on commit drop;
do $$ declare r record;n bigint;d text;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage')and c.relkind in('r','p')loop
execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-''additional_addresses''order by(to_jsonb(t)-''additional_addresses'')::text)::text,''[]''))from %I.%I t',r.nspname,r.relname)into n,d;insert into release_rows values(format('%I.%I',r.nspname,r.relname),n,d);end loop;end $$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)values('129','project_worksite_addresses',array[${q(source)}]);
${qa}
do $$ declare r record;n bigint;d text;begin for r in select *from release_rows loop
execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-''additional_addresses''order by(to_jsonb(t)-''additional_addresses'')::text)::text,''[]''))from %s t',r.name)into n,d;if n<>r.n or d<>r.digest then raise exception 'PRESERVED_ROWS_CHANGED:%',r.name;end if;end loop;
if exists(select 1 from public.projects where cardinality(additional_addresses)<>0)then raise exception 'EXISTING_PROJECT_ADDRESSES_CHANGED';end if;end $$;
select jsonb_build_object('preserved_tables',(select count(*)from release_rows),'existing_primary_addresses_preserved',true,'version','129');
${mode === "--apply" ? "commit" : "rollback"};`));
const after = state();
if (mode === "--apply") {
  verifyApplied(after);
  for (const key of ["other_functions", "constraints", "triggers"]) assert.equal(after[key], before[key], `Unrelated ${key} changed`);
  const metadata = (s) => Object.fromEntries(Object.entries(s.functions["public.reconcile_dispatch(uuid)"]).filter(([key]) => key !== "body"));
  assert.deepEqual(metadata(after), metadata(before));
  assert.deepEqual(after.ledger.filter((m) => m.version !== "129"), before.ledger);
} else assert.deepEqual(after, before);
await writeFile(`${directory}/after.json`, JSON.stringify(after), { mode: 0o600 });
console.log(JSON.stringify({ status: mode === "--apply" ? "APPLIED_AND_VERIFIED" : "DRY_RUN_ROLLED_BACK_VERIFIED", target, version: "129", directory }));
