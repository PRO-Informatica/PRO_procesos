// Guarded DEV-only schema release and correction of the four reported batch memberships.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
process.loadEnvFile('.env');process.umask(0o077);
const mode=process.argv[2];
assert.ok(['--check','--dry-run','--apply','--qa','--repair-dry-run','--repair-apply'].includes(mode)&&process.argv.length===3,'Use --check|--dry-run|--apply|--qa|--repair-dry-run|--repair-apply');
const git=(...args)=>{const r=spawnSync('git',args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);if(r.stderr)process.stderr.write(r.stderr);return r.stdout.trim();};
assert.equal(git('branch','--show-current'),'development','DEV release requires development');
const ref='gholwtklihaphoevosyb',uri=new URL(process.env.DEV_DB_URL),user=decodeURIComponent(uri.username);
assert.equal(uri.pathname,'/postgres');assert.ok((uri.hostname.endsWith('.pooler.supabase.com')&&user===`postgres.${ref}`)||(uri.hostname===`db.${ref}.supabase.co`&&user==='postgres'),'Wrong DEV target');
const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||'5432',PGUSER:user,PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'};
const sql=input=>{const r=spawnSync('/opt/homebrew/bin/psql',['-XAtq','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8',timeout:90000,maxBuffer:25*1024*1024});assert.equal(r.status,0,r.stderr);if(r.stderr)process.stderr.write(r.stderr);return r.stdout.trim();};
const q=value=>`'${value.replaceAll("'","''")}'`,sha=value=>createHash('sha256').update(value).digest('hex');
const source=await readFile('supabase/migrations/143_required_service_reconciliation_completion.sql','utf8');
const qa=await readFile('supabase/qa/required_service_reconciliation_completion.sql','utf8');
const monetaryQa=await readFile('supabase/qa/service_invoice_total_reconciliation.sql','utf8');
const qaBody=()=>`savepoint monetary_qa;${body(monetaryQa)}\nrollback to savepoint monetary_qa;${body(qa)}`;
const body=value=>value.replace(/^begin;$/mu,'').replace(/^(commit|rollback);$/mu,'');
const tableDigests=`select jsonb_object_agg(name,digest) from(select format('%I.%I',n.nspname,c.relname)name,(xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) digest from %I.%I t',n.nspname,c.relname),false,true,'')))[1]::text digest from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage')and c.relkind in('r','p'))s`;
const state=()=>JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object('version',(select max(version)from supabase_migrations.schema_migrations),'tables',(${tableDigests}),'schema',(select md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl)order by p.oid::regprocedure::text)::text)from pg_proc p where p.prokind='f'and p.pronamespace in('public'::regnamespace,'app_private'::regnamespace)));rollback;`));
const before=state(),repair=mode.startsWith('--repair-'),apply=mode==='--apply'||mode==='--repair-apply';
assert.ok(['142','143'].includes(before.version),'Unexpected DEV migration state');
if(before.version==='143')assert.equal(sql("select statements[1]from supabase_migrations.schema_migrations where version='143'"),source.trim(),'Applied migration differs from reviewed source');
console.log(JSON.stringify({target:'DEV',ref,version:before.version,mode,migrationSha256:sha(source)}));
if(mode==='--check')process.exit();
if(apply)assert.equal(git('status','--porcelain'),'','Commit reviewed files before applying');
if(mode==='--apply'&&before.version==='143'){console.log('ALREADY_APPLIED_DEV_VERIFIED');process.exit();}
if(repair||mode==='--qa')assert.equal(before.version,'143','Apply migration 143 first');else assert.equal(before.version,'142');
await mkdir('tmp',{recursive:true});const directory=await mkdtemp(`tmp/required-service-DEV-${repair?'repair-':'release-'}`);
await writeFile(`${directory}/before.json`,JSON.stringify(before));
await writeFile(`${directory}/manifest.json`,JSON.stringify({target:'DEV',ref,head:git('rev-parse','HEAD'),mode,migrationSha256:sha(source)},null,2));
if(apply){
 const file=`${directory}/before.dump`,r=spawnSync('/opt/homebrew/bin/pg_dump',['--format=custom','--schema=public','--schema=app_private','--schema=supabase_migrations','--schema=auth','--schema=storage','--file',file],{env,encoding:'utf8',timeout:90000});assert.equal(r.status,0,r.stderr);
 const list=spawnSync('/opt/homebrew/bin/pg_restore',['--list',file],{encoding:'utf8',maxBuffer:15*1024*1024});assert.equal(list.status,0,list.stderr);for(const table of['batch_dispatches','programming','invoices','users','objects'])assert.ok(list.stdout.includes(table));
 await writeFile(`${directory}/backup.json`,JSON.stringify({verified:true,sha256:sha(await readFile(file))}));assert.deepEqual(state(),before,'DEV changed during backup; retry');console.log(JSON.stringify({status:'BACKUP_VERIFIED',directory}));
}
const lock=`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='75s';select pg_advisory_xact_lock(hashtextextended('DEV:required-service-reconciliation',0));do $$declare r record;begin for r in select c.oid::regclass name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'order by c.oid loop execute format('lock table %s in share row exclusive mode',r.name);end loop;end $$;`;
const assertTables=(expected,excluded=[])=>`do $$declare actual jsonb;k text;begin actual:=(${tableDigests});for k in select jsonb_object_keys(${q(JSON.stringify(expected))}::jsonb)loop if not(k=any(array[${excluded.map(q).join(',')}]::text[]))and actual->>k is distinct from ${q(JSON.stringify(expected))}::jsonb->>k then raise exception 'PRESERVED_DATA_CHANGED:%',k;end if;end loop;end $$;`;
let operation;
if(repair){
 operation="select set_config('app.required_service_repair_dev_guard','gholwtklihaphoevosyb',true);\n"+await readFile('scripts/lib/repair-dev-required-service-batch.sql','utf8');
}else if(mode==='--qa')operation=qaBody();
else operation=`${body(source)}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values('143','required_service_reconciliation_completion',array[${q(source)}]);${mode==='--dry-run'?`savepoint fixtures;${qaBody()}\nrollback to savepoint fixtures;`:''}`;
const excluded=repair?['public.programming','public.programming_revisions','public.programming_revision_lines','public.batch_dispatches','public.audit_events']:[];
const transaction=`${lock}\n${assertTables(before.tables)}\n${operation}\n${assertTables(before.tables,excluded)}\n${apply?'commit':'rollback'};`;
await writeFile(`${directory}/transaction.sql`,transaction);console.log(sql(transaction));
const after=state();await writeFile(`${directory}/after.json`,JSON.stringify(after));
if(!apply)assert.deepEqual(after,before,'Dry run or QA did not fully roll back');
else if(!repair)assert.equal(after.version,'143');
console.log(JSON.stringify({status:apply?(repair?'DEV_REPAIR_APPLIED_HISTORY_PRESERVED':'DEV_MIGRATION_APPLIED_DATA_PRESERVED'):'DEV_ROLLBACK_VERIFIED',directory}));
