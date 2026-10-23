// Reviewed release only: 110..115, DEV parity, exact PROD target, atomic apply.
// --target=PROD --check | --dry-run | --apply (apply requires clean local main).
// No QA fixtures, cleanup scripts, Storage calls or historical migrations run.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(".env");
process.umask(0o077);
const args = process.argv.slice(2);
const modes = args.filter((arg) => ["--check", "--dry-run", "--apply"].includes(arg));
if (!args.includes("--target=PROD") || modes.length !== 1 || args.length !== 2) {
  throw new Error("Use --target=PROD and exactly one of --check, --dry-run, --apply.");
}
const mode = modes[0];
const refs = { DEV: "gholwtklihaphoevosyb", PROD: "jeyjblxfqqlypxiaznad" };
const files = [
  "110_company_project_status_cascade.sql",
  "111_fix_dispatch_evidence_removal.sql",
  "112_service_catalog_description_unit.sql",
  "113_service_catalog_dose_unit.sql",
  "114_monthly_batch_segments_invoice_grace.sql",
  "115_programming_invoice_completion_policy.sql",
];
const git = (...arguments_) => {
  const result = spawnSync("git", arguments_, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git preflight failed.");
  return result.stdout.trim();
};
const root = git("rev-parse", "--show-toplevel");
if (path.resolve(process.cwd()) !== root) throw new Error("Run from repository root.");
const head = git("rev-parse", "HEAD");
if (mode === "--apply") {
  if (git("branch", "--show-current") !== "main" || git("status", "--porcelain")) {
    throw new Error("Apply requires clean, committed main.");
  }
  git("merge-base", "--is-ancestor", "development", "HEAD");
}
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function body(source) {
  // Only remove the reviewed files' OUTER transaction. Function bodies remain.
  const begins = source.match(/^begin;\s*$/gmu) ?? [];
  const commits = source.match(/^commit;\s*$/gmu) ?? [];
  if (begins.length !== 1 || commits.length !== 1) throw new Error("Unexpected migration transaction boundaries.");
  return source.replace(/^begin;\s*$/mu, "").replace(/^commit;\s*$/mu, "").trim();
}
const migrations = await Promise.all(files.map(async (file) => {
  const source = await readFile(path.join(root, "supabase/migrations", file), "utf8");
  if (mode === "--apply" && git("show", `HEAD:supabase/migrations/${file}`) !== source.trim()) {
    throw new Error(`Uncommitted migration source: ${file}`);
  }
  return { file, source, body: body(source), version: file.slice(0, 3), name: file.slice(4, -4), sha256: sha256(source) };
}));

function connection(environment) {
  const uri = new URL(process.env[`${environment}_DB_URL`]);
  const user = decodeURIComponent(uri.username), ref = refs[environment];
  const direct = uri.hostname === `db.${ref}.supabase.co` && user === "postgres";
  const pooled = uri.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`;
  if ((!direct && !pooled) || uri.pathname !== "/postgres") throw new Error(`Unexpected ${environment} database.`);
  return { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: user,
    PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
}
function command(program, arguments_, environment, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(program, arguments_, { env: connection(environment) });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${program} failed (${environment}).`)));
    child.stdin.end(input);
  });
}
const sql = async (environment, query) => (await command("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], environment, query)).stdout.trim();
const readOnly = (environment, query) => sql(environment, `begin read only; set local statement_timeout='30s'; ${query}\nrollback;`);
async function ledger(environment) {
  return JSON.parse(await readOnly(environment, `select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]') from supabase_migrations.schema_migrations m;`));
}
const [dev, prod] = await Promise.all([ledger("DEV"), ledger("PROD")]);
const registryDifferences = [];
for (const migration of migrations) {
  const applied = dev.find((entry) => entry.version === migration.version);
  // Two known serialization-only discrepancies in the pre-release DEV ledger:
  // 114 recorded the SQL without its outer transaction; 115 recorded dollar
  // delimiters as a single '$'. Never execute those recorded strings. Require
  // exact known variants AND compare all final live function bodies below.
  const accepted = [migration.source.trim(), migration.body];
  if (migration.version === "114") accepted.push(migration.source.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "").trim());
  if (migration.version === "115") accepted.push(migration.source.replaceAll("$$", "$").trim());
  if (!applied || applied.name !== migration.name || applied.statements?.length !== 1
    || !accepted.includes(applied.statements[0].trim())) {
    throw new Error(`DEV/source parity failed: ${migration.file}`);
  }
  if (applied.statements[0].trim() !== migration.source.trim()) registryDifferences.push(migration.version);
}
const definitions = new Map();
for (const migration of migrations) {
  const pattern = /\bcreate(?:\s+or\s+replace)?\s+function\s+((?:public|app_private)\.[a-z_]+)\s*\(([^)]*)\)(?:\s|--[^\n]*(?:\n|$))*returns\b[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/giu;
  for (const match of migration.source.matchAll(pattern)) {
    definitions.set(match[1], { body: match[3].trim(), argumentCount: match[2].trim() ? match[2].split(",").length : 0 });
  }
}
const liveDefinitions = JSON.parse(await readOnly("DEV", `select jsonb_agg(jsonb_build_object(
  'name',n.nspname||'.'||p.proname,'argumentCount',p.pronargs,'body',p.prosrc))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname||'.'||p.proname in (${[...definitions.keys()].map(quote).join(",")});`));
for (const [name, expected] of definitions) {
  if (!liveDefinitions.some((entry) => entry.name === name && entry.argumentCount === expected.argumentCount && entry.body.trim() === expected.body)) {
    throw new Error(`DEV live function/source mismatch: ${name}`);
  }
}
console.log(JSON.stringify({ status: "DEV_FUNCTIONS_VERIFIED", functions: definitions.size, registrySerializationDifferences: registryDifferences }));
const baseVersions = Array.from({ length: 109 - 44 + 1 }, (_, index) => String(index + 44).padStart(3, "0"));
for (const version of baseVersions) {
  if (!prod.some((entry) => entry.version === version)) throw new Error(`PROD prerequisite migration missing: ${version}`);
}
const existing = migrations.filter((migration) => prod.some((entry) => entry.version === migration.version));
if (existing.length && existing.length !== migrations.length) throw new Error("Partial release in PROD: review before continuing.");
if (prod.some((entry) => !baseVersions.includes(entry.version) && !migrations.some((migration) => migration.version === entry.version))) {
  throw new Error("Unexpected PROD migration history.");
}
if (existing.length) {
  for (const migration of migrations) {
    const applied = prod.find((entry) => entry.version === migration.version);
    if (applied.name !== migration.name || applied.statements?.length !== 1 || applied.statements[0] !== migration.source) {
      throw new Error(`PROD/source parity failed: ${migration.file}`);
    }
  }
  console.log(JSON.stringify({ status: "ALREADY_APPLIED_VERIFIED", versions: migrations.map((migration) => migration.version), head }));
  process.exit(0);
}
const affected = JSON.parse(await readOnly("PROD", `select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')
  from public.projects p join public.companies c on c.id=p.company_id where p.status='ACTIVE' and c.status='INACTIVE';`));
console.log(JSON.stringify({ status: "PREFLIGHT_PASS", target: "PROD", pending: migrations.map((migration) => migration.version),
  projectsToDisable: affected.length, manifest: migrations.map(({ file, sha256 }) => ({ file, sha256 })), head }));
if (mode === "--check") process.exit(0);

let backupDirectory = null;
if (mode === "--apply") {
  await mkdir(path.join(root, "tmp"), { recursive: true });
  backupDirectory = await mkdtemp(path.join(root, "tmp", "prod-release-110-115-"));
  await chmod(backupDirectory, 0o700);
  await command("pg_dump", ["--format=custom", "--schema-only", "--schema=public", "--schema=app_private",
    "--schema=supabase_migrations", "--file", path.join(backupDirectory, "before-schema.dump")], "PROD");
  await writeFile(path.join(backupDirectory, "affected-projects-before.json"), JSON.stringify(affected, null, 2), { mode: 0o600 });
  await writeFile(path.join(backupDirectory, "release-manifest.json"), JSON.stringify({ head, migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })) }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "BACKUP_CREATED", directory: backupDirectory }));
}

const baseline = `
create temp table release_preserved(table_name text primary key, row_count bigint, digest text) on commit drop;
create temp table release_projects on commit drop as
  select p.id, to_jsonb(p) payload, (p.status='ACTIVE' and c.status='INACTIVE') affected
  from public.projects p join public.companies c on c.id=p.company_id;
create temp table release_units on commit drop as select code,to_jsonb(u) payload from public.units_of_measure u;
create temp table release_audit on commit drop as select id,to_jsonb(a) payload from public.audit_events a;
do $preserve$
declare r record; v_count bigint; v_digest text; v_excluded text[];
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname not in ('projects','units_of_measure','audit_events')
  loop
    v_excluded := case when r.relname in ('programming','programming_revisions') then array['delivery_modes']
      when r.relname='project_service_prices' then array['description','unit_code'] else '{}'::text[] end;
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-$1
      order by (to_jsonb(t)-$1)::text)::text,''[]'')) from public.%I t',r.relname)
      into v_count,v_digest using v_excluded;
    insert into release_preserved values(r.relname,v_count,v_digest);
  end loop;
end;
$preserve$;
`;
const assertions = `
do $verify$
declare r record; v_count bigint; v_digest text; v_period record; v_project uuid; v_excluded text[];
begin
  for r in select * from release_preserved loop
    v_excluded := case when r.table_name in ('programming','programming_revisions') then array['delivery_modes']
      when r.table_name='project_service_prices' then array['description','unit_code'] else '{}'::text[] end;
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-$1
      order by (to_jsonb(t)-$1)::text)::text,''[]'')) from public.%I t',r.table_name)
      into v_count,v_digest using v_excluded;
    if v_count<>r.row_count or v_digest<>r.digest then raise exception 'RELEASE_CHANGED_BUSINESS_DATA:%',r.table_name; end if;
  end loop;
  if (select count(*) from release_projects)<>(select count(*) from public.projects) or exists (
    select 1 from release_projects b left join public.projects p on p.id=b.id where p.id is null
      or (not b.affected and to_jsonb(p)<>b.payload)
      or (b.affected and (p.status<>'INACTIVE' or p.updated_at<>transaction_timestamp()
        or to_jsonb(p)-array['status','updated_at']<>b.payload-array['status','updated_at']))
  ) then raise exception 'RELEASE_PROJECT_BACKFILL_INVALID'; end if;
  if exists(select 1 from release_units b left join public.units_of_measure u on u.code=b.code
      where u.code is null or to_jsonb(u)<>b.payload)
    or exists(select 1 from public.units_of_measure u left join release_units b on b.code=u.code
      where b.code is null and u.code not in ('SERVICIO','COMBO','RECARGO','DOSIS/M3')) then
    raise exception 'RELEASE_UNITS_CHANGED_UNEXPECTEDLY'; end if;
  if exists(select 1 from release_audit b left join public.audit_events a on a.id=b.id where a.id is null or to_jsonb(a)<>b.payload)
    or (select count(*) from public.audit_events a left join release_audit b on b.id=a.id where b.id is null)
      <> (select count(*) from release_projects where affected)
    or exists(select 1 from public.audit_events a left join release_audit b on b.id=a.id where b.id is null
      and (a.action<>'PROJECT_DISABLED_WITH_COMPANY' or not exists(select 1 from release_projects p where p.id=a.entity_id and p.affected))) then
    raise exception 'RELEASE_AUDIT_BACKFILL_INVALID'; end if;
  if exists(select 1 from public.projects p join public.companies c on c.id=p.company_id where p.status='ACTIVE' and c.status='INACTIVE') then
    raise exception 'RELEASE_COMPANY_INVARIANT_FAILED'; end if;
  if exists(select 1 from public.programming where delivery_modes<>'{}'::text[])
    or exists(select 1 from public.programming_revisions where delivery_modes<>'{}'::text[])
    or exists(select 1 from public.project_service_prices where description is not null or unit_code is not null) then
    raise exception 'RELEASE_INVENTED_HISTORICAL_METADATA'; end if;
  if app_private.fifth_business_day('2026-11-01')<>date '2026-11-06'
    or not app_private.invoice_period_valid('2028-10-30','2028-11-01','2028-11-07')
    or app_private.invoice_period_valid('2028-10-30','2028-11-01','2028-11-08') then
    raise exception 'RELEASE_GRACE_POLICY_FAILED'; end if;
  select id into strict v_project from public.projects where status='ACTIVE' order by id limit 1;
  select * into v_period from app_private.resolve_weekly_batch_period(v_project,'2028-10-31');
  if v_period.period_start<>date '2028-10-30' or v_period.period_end<>date '2028-10-31' then
    raise exception 'RELEASE_BATCH_MONTH_SEGMENT_FAILED'; end if;
  if to_regprocedure('public.create_weekly_batches(uuid,text,date)') is null
    or to_regprocedure('public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text,text[])') is null
    or to_regprocedure('app_private.dispatch_billing_complete(uuid)') is null
    or has_function_privilege('anon','public.create_weekly_batches(uuid,text,date)','execute')
    or not has_function_privilege('authenticated','public.create_weekly_batches(uuid,text,date)','execute')
    or has_function_privilege('authenticated','app_private.dispatch_billing_complete(uuid)','execute')
    or has_function_privilege('authenticated','app_private.require_active_project_company()','execute') then
    raise exception 'RELEASE_RPC_OR_PRIVILEGES_FAILED'; end if;
  raise notice 'PASS: all business tables preserved; only expected project cascade, audits and units changed; calendar/RPC/privilege checks passed';
end;
$verify$;
select jsonb_build_object('preserved_tables',(select count(*) from release_preserved),
  'projects_disabled',(select count(*) from release_projects where affected),
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version between '110' and '115'));
`;
const transaction = `begin isolation level serializable;
set local lock_timeout='5s'; set local statement_timeout='90s'; set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:PROD:110-115',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin if exists(select 1 from supabase_migrations.schema_migrations where version>'109') then raise exception 'RELEASE_HISTORY_CHANGED'; end if; end $$;
${baseline}
${migrations.map((migration) => `${migration.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
values(${quote(migration.version)},${quote(migration.name)},array[${quote(migration.source)}]);
do $$ begin raise notice 'STAGED migration ${migration.version}'; end $$;`).join("\n")}
${assertions}
${mode === "--apply" ? "commit;" : "rollback;"}`;
const execution = await command("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], "PROD", transaction);
console.log(execution.stdout.trim());
console.log(execution.stderr.trim());
const after = await ledger("PROD");
const expectedCount = prod.length + (mode === "--apply" ? 6 : 0);
if (after.length !== expectedCount) throw new Error("Post-execution migration history mismatch.");
console.log(JSON.stringify({ status: mode === "--apply" ? "APPLIED_AND_VERIFIED" : "DRY_RUN_ROLLED_BACK_VERIFIED", head,
  backupDirectory, versions: migrations.map((migration) => migration.version) }));
