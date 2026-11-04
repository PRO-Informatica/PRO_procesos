// Release 123-124 only. Explicit targets, verified backups and data-preserving SQL.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

process.loadEnvFile('.env');
process.umask(0o077);
const args = process.argv.slice(2);
const target = args.find(a => /^--target=(DEV|PROD)$/u.test(a))?.slice(9);
const mode = args.find(a => ['--check','--dry-run','--apply'].includes(a));
if (!target || !mode || args.length !== 2) throw Error('Use --target=DEV|PROD --check|--dry-run|--apply');
const q = s => `'${s.replaceAll("'", "''")}'`;
const hash = s => createHash('sha256').update(s).digest('hex');
function git(...args) {
  const r = spawnSync('git',args,{encoding:'utf8'});
  if (r.status !== 0) throw Error(r.stderr || 'Git failed');
  return r.stdout.trim();
}
const root = git('rev-parse','--show-toplevel');
if (process.cwd() !== root) throw Error('Run from repository root');
const migrations = await Promise.all([
  ['123','service_only_guides_independent_truck_times'],
  ['124','programming_edit_until_dispatch'],
].map(async([version,name])=>({version,name,source:await readFile(`supabase/migrations/${version}_${name}.sql`,'utf8')})));
const source = migrations.map(m=>m.source).join('\n');
function definitions(sql) {
  return [...sql.matchAll(/create(?: or replace)? function (\w+\.\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/gu)].map(m=>({name:m[1],body:m[2].trim()}));
}
const prior = (await Promise.all(['120_service_catalog_square_metre.sql','121_dispatch_guide_truck_times.sql','115_programming_invoice_completion_policy.sql','122_approved_programming_historical_dates.sql'].map(f=>readFile(`supabase/migrations/${f}`,'utf8')))).flatMap(definitions);
const next = definitions(source);
const functions = [
  'app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)',
  'public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time)',
  'public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time)',
  'app_private.guard_dispatch_programming_day()',
  'public.update_dispatch(uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text)',
  'app_private.guard_programming_future_schedule()',
  'app_private.guard_programming_delivery_modes()',
  'public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text,text,text[])',
].map(signature=>({
  signature, previous:prior.filter(f=>signature.startsWith(`${f.name}(`)).findLast(f=>!f.body.startsWith('begin\n  return public.'))?.body,
  next:next.find(f=>signature.startsWith(`${f.name}(`))?.body,
}));
if (next.length !== 8 || functions.some(f=>!f.previous || !f.next)) throw Error('Missing reviewed function bodies');
if (mode === '--apply' && (git('status','--porcelain') || git('branch','--show-current') !== (target === 'DEV' ? 'development' : 'main'))) throw Error('Apply requires clean target branch');
if (mode === '--apply' && target === 'PROD') git('merge-base','--is-ancestor','development','HEAD');
const ref = target === 'DEV' ? 'gholwtklihaphoevosyb' : 'jeyjblxfqqlypxiaznad';
const uri = new URL(process.env[`${target}_DB_URL`]);
const user = decodeURIComponent(uri.username);
if (uri.pathname !== '/postgres' || !((uri.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`) || (uri.hostname === `db.${ref}.supabase.co` && user === 'postgres'))) throw Error('Unexpected database target');
const env = {...process.env, PGHOST:uri.hostname,PGPORT:uri.port||'5432',PGUSER:user,PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'};
function sql(input) {
  const r = spawnSync('psql',['-XAtq','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8',timeout:90000,maxBuffer:20*1024*1024});
  if (r.status !== 0) throw Error(r.stderr || 'SQL failed');
  if (r.stderr.trim()) console.log(r.stderr.trim());
  return r.stdout.trim();
}
const signatures = functions.map(f=>q(f.signature)).join(',');
function state() {
  return JSON.parse(sql(`begin read only;set local statement_timeout='30s';select jsonb_build_object(
    'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m where version>='122'),
    'functions',(select jsonb_object_agg(x.signature,jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef)) from (values ${functions.map(f=>`(${q(f.signature)})`).join(',')}) x(signature) left join pg_proc p on p.oid=to_regprocedure(x.signature)),
    'other_functions',(select md5(jsonb_agg(pg_get_functiondef(p.oid) order by p.oid)::text) from pg_proc p where p.pronamespace in ('public'::regnamespace,'app_private'::regnamespace) and p.prokind='f' and p.oid not in (select to_regprocedure(s) from unnest(array[${signatures}]) s)),
    'guide_quantity',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.dispatch_guides'::regclass and conname='dispatch_guides_quantity_ck'),
    'dispatch_sequence',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.dispatches'::regclass and conname='dispatches_time_sequence_ck'),
    'other_constraints',(select md5(jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated) order by conrelid,conname)::text) from pg_constraint where connamespace='public'::regnamespace and not (conrelid='public.dispatches'::regclass and conname='dispatches_time_sequence_ck') and not(conrelid='public.dispatch_guides'::regclass and conname='dispatch_guides_quantity_ck')),
    'triggers',(select md5(jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) order by t.oid)::text) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace)
  );rollback;`));
}
function verifyApplied(s) {
  for(const migration of migrations) {
    const m=s.ledger?.find(m=>m.version===migration.version);
    if (!m || m.name!==migration.name || m.statements?.length!==1 || m.statements[0]!==migration.source) throw Error('Applied migration/source mismatch');
  }
  if(functions.some(f=>s.functions[f.signature]?.body?.trim()!==f.next) || s.guide_quantity!=='CHECK ((quantity >= (0)::numeric))' || s.dispatch_sequence!==null) throw Error('Applied function/constraint mismatch');
}
const before=state();
if (!before.ledger?.some(m=>m.version==='122') || before.ledger.some(m=>!['122','123','124'].includes(m.version))) throw Error('Requires 122 and no later migration');
if (before.ledger.some(m=>m.version==='123'||m.version==='124')) {
  verifyApplied(before);
  console.log(JSON.stringify({status:'ALREADY_APPLIED_VERIFIED',target,versions:['123','124']}));
  process.exit(0);
}
if (functions.some(f=>before.functions[f.signature]?.body?.trim()!==f.previous || !before.functions[f.signature].definer)) throw Error('Function differs from reviewed prerequisites');
if(before.guide_quantity!=='CHECK ((quantity > (0)::numeric))' || before.dispatch_sequence!=='CHECK (((arrival_at IS NULL) OR (departure_at IS NULL) OR (arrival_at <= departure_at)))') throw Error('Unexpected existing constraints');
console.log(JSON.stringify({status:'PREFLIGHT_PASS',target,versions:['123','124'],sha256:hash(source)}));
if (mode==='--check') process.exit(0);
if (mode==='--apply') {
  await mkdir(path.join(root,'tmp'),{recursive:true});
  const directory=await mkdtemp(path.join(root,'tmp',`release-123-124-${target}-`));
  const archive=path.join(directory,'before.dump');
  const dump=spawnSync('pg_dump',['--format=custom','--schema=public','--schema=app_private','--schema=supabase_migrations','--file',archive],{env,encoding:'utf8',timeout:90000});
  if(dump.status!==0) throw Error(dump.stderr||'Backup failed');
  const restore=spawnSync('pg_restore',['--file=-',archive],{encoding:'utf8',maxBuffer:30*1024*1024});
  if(restore.status!==0 || !restore.stdout.includes('COPY public.programming (') || functions.some(f=>!restore.stdout.includes(f.previous))) throw Error('Incomplete backup');
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({target,ref,versions:['123','124'],head:git('rev-parse','HEAD'),migrationSha256:hash(source),archiveSha256:hash(await readFile(archive))},null,2),{mode:0o600});
  console.log(JSON.stringify({status:'BACKUP_VERIFIED',directory}));
}
for(const migration of migrations) if((migration.source.match(/^begin;$/gmu)??[]).length!==1 || (migration.source.match(/^commit;$/gmu)??[]).length!==1) throw Error('Unexpected migration boundaries');
const body=migrations.map(m=>m.source.replace(/^begin;$/mu,'').replace(/^commit;$/mu,'')).join('\n');
let qa='';
if(mode==='--dry-run' && target==='DEV') {
  const test=await readFile('supabase/qa/guide_flexibility_programming_edits.sql','utf8');
  qa=`savepoint qa;${test.replace(/^begin;$/mu,'').replace(/^rollback;$/mu,'')}rollback to savepoint qa;release savepoint qa;`;
}
console.log(sql(`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:${target}:123-124',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version>'122') then raise exception 'RELEASE_STATE_CHANGED'; end if;
  ${functions.map(f=>`if (select prosrc from pg_proc where oid=to_regprocedure(${q(f.signature)})) is distinct from ${q(before.functions[f.signature].body)} then raise exception 'FUNCTION_CHANGED'; end if;`).join('\n')}
end $$;
create temp table release_rows(name text primary key,count bigint,digest text) on commit drop;
do $$ declare r record; n bigint; d text; begin
  for r in select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',r.relname) into n,d;
    insert into release_rows values(r.relname,n,d);
  end loop;
end $$;
${body}
${migrations.map(m=>`insert into supabase_migrations.schema_migrations(version,name,statements) values(${q(m.version)},${q(m.name)},array[${q(m.source)}]);`).join('\n')}
${qa}
do $$ declare r record; n bigint; d text; begin
  for r in select * from release_rows loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',r.name) into n,d;
    if n<>r.count or d<>r.digest then raise exception 'ROWS_CHANGED:%',r.name; end if;
  end loop;
end $$;
select jsonb_build_object('preserved_public_tables',(select count(*) from release_rows),'versions',jsonb_build_array('123','124'));
${mode==='--apply'?'commit':'rollback'};`));
const after=state();
if(mode==='--apply') {
  verifyApplied(after);
  if(before.other_functions!==after.other_functions || before.triggers!==after.triggers || before.other_constraints!==after.other_constraints) throw Error('Unrelated functions/triggers changed');
  for(const f of functions) {
    const metadata=s=>Object.fromEntries(Object.entries(s.functions[f.signature]).filter(([k])=>k!=='body'));
    if(JSON.stringify(metadata(before))!==JSON.stringify(metadata(after))) throw Error('Owner/ACL/settings changed');
  }
} else if(JSON.stringify(after)!==JSON.stringify(before)) throw Error('Dry run failed to restore initial state');
console.log(JSON.stringify({status:mode==='--apply'?'APPLIED_AND_VERIFIED':'DRY_RUN_ROLLED_BACK_VERIFIED',target,versions:['123','124']}));
