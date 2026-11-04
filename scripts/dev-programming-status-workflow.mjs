// This review phase has no PROD target. Preserve the OCR-only DEV schema.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
process.loadEnvFile('.env');process.umask(0o077);
const mode=process.argv[2];assert.ok(['--check','--enum-dry-run','--enum-apply','--dry-run','--apply','--qa'].includes(mode)&&process.argv.length===3);
const branch=spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim();assert.equal(branch,'development');
const ref='gholwtklihaphoevosyb',uri=new URL(process.env.DEV_DB_URL),user=decodeURIComponent(uri.username);
assert.equal(uri.pathname,'/postgres');assert.ok((uri.hostname.endsWith('.pooler.supabase.com')&&user===`postgres.${ref}`)||(uri.hostname===`db.${ref}.supabase.co`&&user==='postgres'));
const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||'5432',PGUSER:user,PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'};
const q=v=>`'${v.replaceAll("'","''")}'`,sha=v=>createHash('sha256').update(v).digest('hex');
function sql(input){const r=spawnSync('psql',['-XAtq','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8',timeout:90000,maxBuffer:45*1024*1024});assert.equal(r.status,0,r.stderr);if(r.stderr.trim())console.log(r.stderr.trim());return r.stdout.trim();}
function state(){return JSON.parse(sql(`begin isolation level repeatable read read only;
select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
 'enum',(select jsonb_agg(enumlabel order by enumsortorder)from pg_enum where enumtypid='public.programming_status'::regtype),
 'functions',(select jsonb_object_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef))from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private')and p.prokind='f'),
 'tables',(select jsonb_object_agg(name,digest)from(select c.relname name,(xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text)::text,''[]''))as digest from public.%I t',c.relname),false,true,'')))[1]::text digest from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r')t),
 'programming',(select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(p),'expected',case when p.status='PENDING_CONFIRMATION' then 'CONFIRMED' when p.status='IN_EXECUTION' and exists(select 1 from public.dispatches d where d.programming_id=p.id)and not exists(select 1 from public.dispatches d where d.programming_id=p.id and d.status<>'COMPLETED')then case when not exists(select 1 from public.dispatches d where d.programming_id=p.id and not app_private.dispatch_billing_complete(d.id))then 'COMPLETED' else 'DISPATCH_COMPLETED' end else p.status::text end)order by p.id),'[]')from public.programming p),
 'history',jsonb_build_object('programming_revisions',(select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')from public.programming_revisions t),'programming_revision_lines',(select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')from public.programming_revision_lines t),'audit_events',(select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')from public.audit_events t))
);rollback;`));}
const before=state();console.log(JSON.stringify({target:'DEV',ref,branch,mode,latest:before.ledger.at(-1)?.version,programming:before.programming.length,states:before.programming.reduce((counts,p)=>(counts[p.row.status]=(counts[p.row.status]||0)+1,counts),{})}));
if(mode==='--check')process.exit(0);
const enumStage=mode.startsWith('--enum-'),version=enumStage?'133':'134',name=enumStage?'programming_dispatch_completed_status':'programming_automatic_confirmation';
const source=await readFile(`supabase/migrations/${version}_${name}.sql`,'utf8');
if(mode==='--qa'){
 assert.ok(before.ledger.some(m=>m.version==='134'));console.log(sql(await readFile('supabase/qa/programming_status_workflow.sql','utf8')));assert.deepEqual(state(),before);console.log('DEV_QA_ROLLED_BACK_VERIFIED');process.exit();
}
if(before.ledger.some(m=>m.version===version)){assert.deepEqual(before.ledger.find(m=>m.version===version).statements,[source]);console.log('ALREADY_APPLIED_DEV_VERIFIED');process.exit();}
assert.ok(before.ledger.some(m=>m.version==='130'));assert.ok(!before.ledger.some(m=>m.version>version));
if(!enumStage)assert.ok(before.enum.includes('DISPATCH_COMPLETED'),'Commit migration 133 first');
const apply=['--enum-apply','--apply'].includes(mode),directory=await mkdtemp(`tmp/programming-status-${version}-DEV-`);
await writeFile(`${directory}/before.json`,JSON.stringify(before),{mode:0o600});
if(apply){
 const r=spawnSync('pg_dump',['--format=custom','--schema=public','--schema=app_private','--schema=supabase_migrations','--file',`${directory}/before.dump`],{env,encoding:'utf8',timeout:90000});assert.equal(r.status,0,r.stderr);
 const verify=spawnSync('pg_restore',['--list',`${directory}/before.dump`],{encoding:'utf8'});assert.equal(verify.status,0);assert.ok(verify.stdout.includes('dispatch_guides'));
 await writeFile(`${directory}/backup.json`,JSON.stringify({ref,version,sourceSha256:sha(source),backupSha256:sha(await readFile(`${directory}/before.dump`))}),{mode:0o600});
}
const unwrap=s=>s.replace(/^begin;$/gmi,'').replace(/^(commit|rollback);$/gmi,'');
const qa=!enumStage&&!apply?`savepoint qa;${unwrap(await readFile('supabase/qa/programming_status_workflow.sql','utf8'))}rollback to savepoint qa;`:'';
console.log(sql(`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';select pg_advisory_xact_lock(hashtextextended('development-programming-status-review',0));
${unwrap(source)}
insert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','${name}',array[${q(source)}]);
${qa}
${apply?'commit':'rollback'};`));
const after=state();
if(!apply)assert.deepEqual(after,before);
else{
 assert.deepEqual(after.ledger.find(m=>m.version===version).statements,[source]);assert.deepEqual(after.ledger.filter(m=>m.version!==version),before.ledger);
 const allowed=new Set(enumStage?[]:['programming','programming_revisions','programming_revision_lines','audit_events']);
 for(const[table,digest]of Object.entries(before.tables))if(!allowed.has(table))assert.equal(after.tables[table],digest,`${table} changed`);
 assert.equal(after.programming.length,before.programming.length);
 const mutable=new Set(['status','confirmed_quantity','confirmed_at','confirmed_by','version','updated_at']);
 const immutable=p=>Object.fromEntries(Object.entries(p).filter(([key])=>!mutable.has(key)));
 let changed=0;
 for(const old of before.programming){const next=after.programming.find(p=>p.row.id===old.row.id);assert.ok(next);assert.deepEqual(immutable(next.row),immutable(old.row));
  if(enumStage||old.row.status===old.expected)assert.deepEqual(next.row,old.row);
  else{changed++;assert.equal(next.row.status,old.expected);assert.equal(next.row.version,old.row.version+1);if(old.row.status==='PENDING_CONFIRMATION'){assert.equal(next.row.confirmed_quantity,next.row.requested_quantity);assert.equal(next.row.confirmed_by,next.row.created_by);}}
 }
 for(const[table,records]of Object.entries(before.history)){const rows=new Map(after.history[table].map(row=>[row.id,row]));for(const row of records)assert.deepEqual(rows.get(row.id),row,`Historical ${table} changed`);}
 console.log(JSON.stringify({updatedProgramming:changed,states:after.programming.reduce((counts,p)=>(counts[p.row.status]=(counts[p.row.status]||0)+1,counts),{})}));
}
await writeFile(`${directory}/after.json`,JSON.stringify(after),{mode:0o600});console.log(JSON.stringify({status:apply?'APPLIED_DEV_ONLY_VERIFIED':'DRY_RUN_DEV_ROLLED_BACK_VERIFIED',version,directory}));
