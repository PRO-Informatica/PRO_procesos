// Release 122 only. Explicit targets, verified backups and data-preserving SQL.
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
const source = await readFile('supabase/migrations/122_approved_programming_historical_dates.sql','utf8');
function definitions(sql) {
  return [...sql.matchAll(/create(?: or replace)? function (\w+\.\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/gu)].map(m=>({name:m[1],body:m[2].trim()}));
}
const prior = (await Promise.all(['101_approved_programming_same_day.sql','115_programming_invoice_completion_policy.sql'].map(f=>readFile(`supabase/migrations/${f}`,'utf8')))).flatMap(definitions);
const next = definitions(source);
const functions = ['app_private.guard_programming_future_schedule()','public.create_programming_batch(uuid,jsonb)'].map(signature=>({
  signature, previous:prior.findLast(f=>signature.startsWith(`${f.name}(`))?.body,
  next:next.find(f=>signature.startsWith(`${f.name}(`))?.body,
}));
if (next.length !== 2 || functions.some(f=>!f.previous || !f.next)) throw Error('Missing reviewed function bodies');
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
    'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m where version>='121'),
    'functions',(select jsonb_object_agg(x.signature,jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef)) from (values ${functions.map(f=>`(${q(f.signature)})`).join(',')}) x(signature) left join pg_proc p on p.oid=to_regprocedure(x.signature)),
    'other_functions',(select md5(jsonb_agg(pg_get_functiondef(p.oid) order by p.oid)::text) from pg_proc p where p.pronamespace in ('public'::regnamespace,'app_private'::regnamespace) and p.prokind='f' and p.oid not in (select to_regprocedure(s) from unnest(array[${signatures}]) s)),
    'triggers',(select md5(jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) order by t.oid)::text) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace)
  );rollback;`));
}
function verifyApplied(s) {
  const m=s.ledger?.find(m=>m.version==='122');
  if (!m || m.name!=='approved_programming_historical_dates' || m.statements?.length!==1 || m.statements[0]!==source || functions.some(f=>s.functions[f.signature]?.body?.trim()!==f.next)) throw Error('Applied migration/source mismatch');
}
const before=state();
if (!before.ledger?.some(m=>m.version==='121') || before.ledger.some(m=>!['121','122'].includes(m.version))) throw Error('Requires 121 and no later migration');
if (before.ledger.some(m=>m.version==='122')) {
  verifyApplied(before);
  console.log(JSON.stringify({status:'ALREADY_APPLIED_VERIFIED',target,version:'122'}));
  process.exit(0);
}
if (functions.some(f=>before.functions[f.signature]?.body?.trim()!==f.previous || !before.functions[f.signature].definer)) throw Error('Function differs from reviewed prerequisites');
console.log(JSON.stringify({status:'PREFLIGHT_PASS',target,version:'122',sha256:hash(source)}));
if (mode==='--check') process.exit(0);
if (mode==='--apply') {
  await mkdir(path.join(root,'tmp'),{recursive:true});
  const directory=await mkdtemp(path.join(root,'tmp',`release-122-${target}-`));
  const archive=path.join(directory,'before.dump');
  const dump=spawnSync('pg_dump',['--format=custom','--schema=public','--schema=app_private','--schema=supabase_migrations','--file',archive],{env,encoding:'utf8',timeout:90000});
  if(dump.status!==0) throw Error(dump.stderr||'Backup failed');
  const restore=spawnSync('pg_restore',['--file=-',archive],{encoding:'utf8',maxBuffer:30*1024*1024});
  if(restore.status!==0 || !restore.stdout.includes('COPY public.programming (') || functions.some(f=>!restore.stdout.includes(f.previous))) throw Error('Incomplete backup');
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({target,ref,version:'122',head:git('rev-parse','HEAD'),migrationSha256:hash(source),archiveSha256:hash(await readFile(archive))},null,2),{mode:0o600});
  console.log(JSON.stringify({status:'BACKUP_VERIFIED',directory}));
}
if((source.match(/^begin;$/gmu)??[]).length!==1 || (source.match(/^commit;$/gmu)??[]).length!==1) throw Error('Unexpected migration boundaries');
const body=source.replace(/^begin;$/mu,'').replace(/^commit;$/mu,'');
let qa='';
if(mode==='--dry-run' && target==='DEV') {
  const test=await readFile('supabase/qa/approved_programming_historical_dates.sql','utf8');
  qa=`savepoint qa;${test.replace(/^begin;$/mu,'').replace(/^rollback;$/mu,'')}rollback to savepoint qa;release savepoint qa;`;
}
console.log(sql(`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';set local idle_in_transaction_session_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:${target}:122',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version>'121') then raise exception 'RELEASE_STATE_CHANGED'; end if;
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
insert into supabase_migrations.schema_migrations(version,name,statements) values('122','approved_programming_historical_dates',array[${q(source)}]);
${qa}
do $$ declare r record; n bigint; d text; begin
  for r in select * from release_rows loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',r.name) into n,d;
    if n<>r.count or d<>r.digest then raise exception 'ROWS_CHANGED:%',r.name; end if;
  end loop;
end $$;
select jsonb_build_object('preserved_public_tables',(select count(*) from release_rows),'version','122');
${mode==='--apply'?'commit':'rollback'};`));
const after=state();
if(mode==='--apply') {
  verifyApplied(after);
  if(before.other_functions!==after.other_functions || before.triggers!==after.triggers) throw Error('Unrelated functions/triggers changed');
  for(const f of functions) {
    const metadata=s=>Object.fromEntries(Object.entries(s.functions[f.signature]).filter(([k])=>k!=='body'));
    if(JSON.stringify(metadata(before))!==JSON.stringify(metadata(after))) throw Error('Owner/ACL/settings changed');
  }
} else if(JSON.stringify(after)!==JSON.stringify(before)) throw Error('Dry run failed to restore initial state');
console.log(JSON.stringify({status:mode==='--apply'?'APPLIED_AND_VERIFIED':'DRY_RUN_ROLLED_BACK_VERIFIED',target,version:'122'}));
