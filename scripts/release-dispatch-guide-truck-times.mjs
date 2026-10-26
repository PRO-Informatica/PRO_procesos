// Release 121 only. Explicit target; no production fixtures or historical backfill.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(".env");
process.umask(0o077);
const args = process.argv.slice(2);
const target = args.find(arg => /^--target=(DEV|PROD)$/u.test(arg))?.slice(9);
const mode = args.find(arg => ["--check", "--dry-run", "--apply"].includes(arg));
if (!target || !mode || args.length !== 2) throw Error("Use --target=DEV|PROD --check|--dry-run|--apply");
const q = value => `'${value.replaceAll("'", "''")}'`;
function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr || "Git failed");
  return r.stdout.trim();
}
const root = git("rev-parse", "--show-toplevel");
if (process.cwd() !== root) throw Error("Run from repository root");
const file = "supabase/migrations/121_dispatch_guide_truck_times.sql";
const source = await readFile(file, "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
function definitions(sql) {
  return [...sql.matchAll(/create(?: or replace)? function (\w+\.\w+)\(([\s\S]*?)\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/gu)].map(m => ({ name: m[1], args: m[2], body: m[3].trim() }));
}
const old = (await Promise.all(["108_dispatch_catalog_estimates.sql", "082_dispatch_operation_day_and_evidence.sql", "085_phase3_legacy_cleanup.sql"].map(file => readFile(`supabase/migrations/${file}`, "utf8")))).flatMap(definitions);
const next = definitions(source);
const signatures = [
  ["public.create_dispatch_guide_with_lines", "uuid,integer,text,date,jsonb", false],
  ["public.update_dispatch_guide_with_lines", "uuid,integer,text,date,jsonb", false],
  ["public.update_dispatch", "uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text", false],
  ["app_private.guard_dispatch_programming_day", "", false],
  ["public.create_dispatch_guide_with_lines", "uuid,integer,text,date,jsonb,time,time", true],
  ["public.update_dispatch_guide_with_lines", "uuid,integer,text,date,jsonb,time,time", true],
  ["app_private.dispatch_guide_truck_timestamps", "uuid,time,time", true],
  ["app_private.guard_dispatch_guide_truck_times", "", true],
  ["app_private.sync_dispatch_guide_departure", "", true],
].map(([name, args, added]) => ({ name, signature: `${name}(${args})`, added,
  previous: added ? null : old.find(d => d.name === name)?.body,
  next: next.find(d => d.name === name && (name.endsWith("_with_lines") ? d.args.includes("p_truck_arrival_time") === added : true))?.body,
}));
if (signatures.some(r => !r.next || (!r.added && !r.previous))) throw Error("Missing reviewed function body");
if (mode === "--apply" && (git("status", "--porcelain") || git("branch", "--show-current") !== (target === "DEV" ? "development" : "main"))) throw Error("Apply requires clean target branch");
if (mode === "--apply" && target === "PROD") git("merge-base", "--is-ancestor", "development", "HEAD");
const ref = target === "DEV" ? "gholwtklihaphoevosyb" : "jeyjblxfqqlypxiaznad";
const uri = new URL(process.env[`${target}_DB_URL`]);
const user = decodeURIComponent(uri.username);
if (uri.pathname !== "/postgres" || !((uri.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`) || (uri.hostname === `db.${ref}.supabase.co` && user === "postgres"))) throw Error("Unexpected database target");
const env = { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: user, PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
function sql(query) {
  const r = spawnSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env, input: query, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 90000 });
  if (r.status !== 0) throw Error(r.stderr || "SQL failed");
  if (r.stderr.trim()) console.log(r.stderr.trim());
  return r.stdout.trim();
}
const functionRows = `select jsonb_object_agg(x.signature,jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef)) from (values ${signatures.map(r => `(${q(r.signature)})`).join(",")}) x(signature) left join pg_proc p on p.oid=to_regprocedure(x.signature)`;
function state() {
  return JSON.parse(sql(`begin read only;set local statement_timeout='30s';select jsonb_build_object(
    'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m where version>='120'),
    'functions',(${functionRows}),
    'columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',udt_name,'nullable',is_nullable) order by column_name) from information_schema.columns where table_schema='public' and table_name='dispatch_guides' and column_name in ('truck_arrival_at','truck_departure_at')),
    'constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.dispatch_guides'::regclass and conname='dispatch_guides_truck_times_valid'),
    'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.dispatch_guides'::regclass and tgname in ('dispatch_guides_truck_times_guard','dispatch_guides_departure_rollup'))
  );rollback;`));
}
function verifyApplied(s) {
  const entry = s.ledger?.find(m => m.version === "121");
  if (!entry || entry.name !== "dispatch_guide_truck_times" || entry.statements?.length !== 1 || entry.statements[0] !== source || s.columns?.length !== 2 || s.columns.some(c => c.type !== "timestamptz" || c.nullable !== "YES") || !s.constraint || s.triggers?.length !== 2 || signatures.some(r => s.functions[r.signature]?.body?.trim() !== r.next)) throw Error("Applied schema/source mismatch");
  for (const r of signatures) if (!s.functions[r.signature].definer) throw Error("Security definer contract changed");
  const acl = JSON.parse(sql(`select jsonb_build_object('public_rpc',${signatures.filter(r => r.added && r.name.startsWith("public.")).map(r => `(has_function_privilege('authenticated',${q(r.signature)},'EXECUTE') and has_function_privilege('service_role',${q(r.signature)},'EXECUTE') and not has_function_privilege('anon',${q(r.signature)},'EXECUTE'))`).join(" and ")},'private_helpers',${signatures.filter(r => r.added && r.name.startsWith("app_private.")).map(r => `(not has_function_privilege('authenticated',${q(r.signature)},'EXECUTE') and not has_function_privilege('anon',${q(r.signature)},'EXECUTE'))`).join(" and ")});`));
  if (!acl.public_rpc || !acl.private_helpers) throw Error("Function privileges mismatch");
}
const before = state();
if (!before.ledger?.some(m => m.version === "120") || before.ledger.some(m => !["120", "121"].includes(m.version))) throw Error("Requires 120 and no later migration");
if (before.ledger.some(m => m.version === "121")) { verifyApplied(before); console.log(JSON.stringify({ status: "ALREADY_APPLIED_VERIFIED", target, version: "121" })); process.exit(0); }
if (before.columns || before.constraint || before.triggers || signatures.some(r => r.added ? before.functions[r.signature].body !== null : before.functions[r.signature]?.body?.trim() !== r.previous)) throw Error("Schema differs from reviewed prerequisites");
console.log(JSON.stringify({ status: "PREFLIGHT_PASS", target, version: "121", sha256 }));
if (mode === "--check") process.exit(0);
if (mode === "--apply") {
  await mkdir(path.join(root, "tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(root, "tmp", `release-121-${target}-`));
  const archive = path.join(directory, "before.dump");
  const dump = spawnSync("pg_dump", ["--format=custom", "--schema=public", "--schema=app_private", "--schema=supabase_migrations", "--file", archive], { env, encoding: "utf8", timeout: 90000 });
  if (dump.status !== 0) throw Error(dump.stderr || "Backup failed");
  const restore = spawnSync("pg_restore", ["--file=-", archive], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (restore.status !== 0 || !restore.stdout.includes("COPY public.dispatch_guides (") || signatures.filter(r => !r.added).some(r => !restore.stdout.includes(r.previous))) throw Error("Incomplete backup");
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ target, ref, version: "121", head: git("rev-parse", "HEAD"), sha256 }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "BACKUP_CREATED", directory }));
}
if ((source.match(/^begin;$/gmu) ?? []).length !== 1 || (source.match(/^commit;$/gmu) ?? []).length !== 1) throw Error("Unexpected migration boundaries");
const body = source.replace(/^begin;$/mu, "").replace(/^commit;$/mu, "");
let qa = "";
if (mode === "--dry-run" && target === "DEV") {
  const test = await readFile("supabase/qa/dispatch_guide_truck_times.sql", "utf8");
  qa = `savepoint qa;${test.replace(/^begin;$/mu, "").replace(/^rollback;$/mu, "")}rollback to savepoint qa;release savepoint qa;`;
}
const result = sql(`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:${target}:121',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin if exists(select 1 from supabase_migrations.schema_migrations where version>'120') then raise exception 'RELEASE_STATE_CHANGED'; end if; end $$;
create temp table release_rows(name text primary key,count bigint,digest text) on commit drop;
do $$ declare r record; n bigint; d text; begin
  for r in select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)%s order by (to_jsonb(t)%s)::text)::text,''[]'')) from public.%I t',case when r.relname='dispatch_guides' then '-''truck_arrival_at''-''truck_departure_at''' else '' end,case when r.relname='dispatch_guides' then '-''truck_arrival_at''-''truck_departure_at''' else '' end,r.relname) into n,d;
    insert into release_rows values(r.relname,n,d);
  end loop;
end $$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements) values('121','dispatch_guide_truck_times',array[${q(source)}]);
${qa}
do $$ declare r record; n bigint; d text; begin
  for r in select * from release_rows loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)%s order by (to_jsonb(t)%s)::text)::text,''[]'')) from public.%I t',case when r.name='dispatch_guides' then '-''truck_arrival_at''-''truck_departure_at''' else '' end,case when r.name='dispatch_guides' then '-''truck_arrival_at''-''truck_departure_at''' else '' end,r.name) into n,d;
    if n<>r.count or d<>r.digest then raise exception 'HISTORICAL_ROWS_CHANGED:%',r.name; end if;
  end loop;
  if exists(select 1 from public.dispatch_guides where truck_arrival_at is not null or truck_departure_at is not null) then raise exception 'HISTORICAL_TIMES_INVENTED'; end if;
end $$;
select jsonb_build_object('preserved_public_tables',(select count(*) from release_rows),'version','121');
${mode === "--apply" ? "commit" : "rollback"};`);
console.log(result);
const after = state();
if (mode === "--apply") {
  verifyApplied(after);
  for (const r of signatures.filter(r => !r.added)) {
    const oldMetadata = Object.fromEntries(Object.entries(before.functions[r.signature]).filter(([key]) => key !== "body"));
    const nextMetadata = Object.fromEntries(Object.entries(after.functions[r.signature]).filter(([key]) => key !== "body"));
    if (JSON.stringify(oldMetadata) !== JSON.stringify(nextMetadata)) throw Error("Existing owner/ACL/settings changed");
  }
} else if (JSON.stringify(after) !== JSON.stringify(before)) throw Error("Dry run did not restore initial state");
console.log(JSON.stringify({ status: mode === "--apply" ? "APPLIED_AND_VERIFIED" : "DRY_RUN_ROLLED_BACK_VERIFIED", target, version: "121" }));
