// Release 130: verified function-only migration, backups and rolled-back DEV QA.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";

process.loadEnvFile(".env");process.umask(0o077);
const args=process.argv.slice(2),target=args.find(a=>/^--target=(DEV|PROD)$/u.test(a))?.slice(9);
const mode=args.find(a=>["--check","--dry-run","--apply"].includes(a));
assert.ok(target&&mode&&args.length===2,"Use --target=DEV|PROD --check|--dry-run|--apply");
const ref=target==="DEV"?"gholwtklihaphoevosyb":"jeyjblxfqqlypxiaznad";
const uri=new URL(process.env[`${target}_DB_URL`]),username=decodeURIComponent(uri.username);
assert.equal(uri.pathname,"/postgres");assert.ok((uri.hostname.endsWith(".pooler.supabase.com")&&username===`postgres.${ref}`)||(uri.hostname===`db.${ref}.supabase.co`&&username==="postgres"));
const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||"5432",PGUSER:username,PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:"postgres",PGSSLMODE:"require",PGCONNECT_TIMEOUT:"10"};
const q=s=>`'${s.replaceAll("'","''")}'`,sha=s=>createHash("sha256").update(s).digest("hex");
function git(...args){const r=spawnSync("git",args,{encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(process.cwd(),git("rev-parse","--show-toplevel"));
if(mode==="--apply"&&target==="PROD"){assert.equal(git("branch","--show-current"),"main");assert.equal(git("status","--porcelain"),"");}
function sql(input){const r=spawnSync("psql",["-XAtq","-v","ON_ERROR_STOP=1"],{env,input,encoding:"utf8",timeout:90000,maxBuffer:40*1024*1024});assert.equal(r.status,0,r.stderr);if(r.stderr.trim())console.log(r.stderr.trim());return r.stdout.trim();}
const source=await readFile("supabase/migrations/130_cancel_unstarted_programming_dispatch.sql","utf8");
function body(text,name){const escaped=name.replaceAll(".","\\.");const r=new RegExp(`create(?: or replace)? function ${escaped}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,"iu").exec(text);assert.ok(r,`Missing function ${name}`);return r[1].trim();}
const signatures=["public.cancel_programming(uuid,integer,text)","app_private.sync_completed_dispatch_reconciliation()","public.add_dispatch_to_batch(uuid,uuid)"];
const previous={};
for(const [signature,file]of [[signatures[0],"052_programming_detail_workflow.sql"],[signatures[1],"090_universal_invoice_pipeline.sql"],[signatures[2],"083_phase3_batch_dispatch_membership.sql"]])previous[signature]=body(await readFile(`supabase/migrations/${file}`,"utf8"),signature.split("(")[0]);
function state(){return JSON.parse(sql(`begin read only;select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
 'functions',(select jsonb_object_agg(s,jsonb_build_object('body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef))from unnest(array[${signatures.map(q).join(",")}])s join pg_proc p on p.oid=to_regprocedure(s)),
 'other_functions',(select md5(jsonb_agg(pg_get_functiondef(oid)order by oid)::text)from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace)and prokind='f'and oid not in(select to_regprocedure(s)from unnest(array[${signatures.map(q).join(",")}])s)),
 'constraints',(select md5(jsonb_agg(jsonb_build_array(conrelid,conname,pg_get_constraintdef(oid),convalidated)order by oid)::text)from pg_constraint where connamespace='public'::regnamespace),
 'triggers',(select md5(jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled)order by t.oid)::text)from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace));rollback;`));}
function verifyApplied(s){const ledger=s.ledger.find(m=>m.version==="130");assert.equal(ledger?.name,"cancel_unstarted_programming_dispatch");assert.deepEqual(ledger.statements,[source]);
 for(const signature of signatures.slice(0,2))assert.equal(s.functions[signature].body.trim(),body(source,signature.split("(")[0]));
 assert.ok(s.functions[signatures[2]].body.includes("DISPATCH_PROGRAMMING_CANCELLED"));
 assert.equal(s.functions[signatures[0]].definer,true);assert.ok(s.functions[signatures[0]].acl.some(a=>a.startsWith("authenticated=X/")));assert.ok(!s.functions[signatures[0]].acl.some(a=>/^(anon|)=/u.test(a)));
}
const before=state();assert.ok(before.ledger.some(m=>m.version==="129"));assert.ok(!before.ledger.some(m=>m.version>"130"));
if(before.ledger.some(m=>m.version==="130")){verifyApplied(before);console.log(JSON.stringify({status:"ALREADY_APPLIED_VERIFIED",target,version:"130"}));process.exit();}
for(const signature of signatures)assert.equal(before.functions[signature].body.trim(),previous[signature],`Unexpected prerequisite ${signature}`);
console.log(JSON.stringify({status:"PREFLIGHT_PASS",target,version:"130"}));if(mode==="--check")process.exit();
const directory=await mkdtemp(`${process.cwd()}/tmp/release-130-${target}-`);await writeFile(`${directory}/before.json`,JSON.stringify(before),{mode:0o600});
if(mode==="--apply"){
 const archive=`${directory}/before.dump`;const dump=spawnSync("pg_dump",["--format=custom","--schema=public","--schema=app_private","--schema=supabase_migrations","--file",archive],{env,encoding:"utf8",timeout:90000});assert.equal(dump.status,0,dump.stderr);
 const restored=spawnSync("pg_restore",["--file=-",archive],{encoding:"utf8",maxBuffer:40*1024*1024});assert.equal(restored.status,0,restored.stderr);assert.ok(restored.stdout.includes("COPY public.programming (")&&restored.stdout.includes("COPY public.dispatches (")&&restored.stdout.includes(previous[signatures[0]]));
 await writeFile(`${directory}/backup.json`,JSON.stringify({target,ref,head:git("rev-parse","HEAD"),migrationSha256:sha(source),archiveSha256:sha(await readFile(archive))}),{mode:0o600});
}
const unwrap=text=>text.replace(/^begin;$/mu,"").replace(/^(commit|rollback);$/mu,"");
const qa=mode==="--dry-run"&&target==="DEV"?`savepoint qa;${unwrap(await readFile("supabase/qa/cancel_unstarted_programming_dispatch.sql","utf8"))}rollback to savepoint qa;release savepoint qa;`:"";
console.log(sql(`begin isolation level serializable;set local lock_timeout='5s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('release:130',0));lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ begin if exists(select 1 from supabase_migrations.schema_migrations where version>'129')then raise exception 'RELEASE_STATE_CHANGED';end if;end $$;
create temp table release_rows(name text primary key,n bigint,digest text)on commit drop;
do $$ declare r record;n bigint;d text;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage')and c.relkind in('r','p')loop
execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text)::text,''[]''))from %I.%I t',r.nspname,r.relname)into n,d;insert into release_rows values(format('%I.%I',r.nspname,r.relname),n,d);end loop;end $$;
${unwrap(source)}
insert into supabase_migrations.schema_migrations(version,name,statements)values('130','cancel_unstarted_programming_dispatch',array[${q(source)}]);
${qa}
do $$ declare r record;n bigint;d text;begin for r in select *from release_rows loop
execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text)::text,''[]''))from %s t',r.name)into n,d;if n<>r.n or d<>r.digest then raise exception 'PRESERVED_ROWS_CHANGED:%',r.name;end if;end loop;end $$;
select jsonb_build_object('version','130','preserved_tables',(select count(*)from release_rows));${mode==="--apply"?"commit":"rollback"};`));
const after=state();if(mode==="--apply"){
 verifyApplied(after);for(const key of ["other_functions","constraints","triggers"])assert.equal(after[key],before[key],`Unrelated ${key} changed`);
 for(const signature of signatures){const metadata=s=>Object.fromEntries(Object.entries(s.functions[signature]).filter(([k])=>k!=="body"));assert.deepEqual(metadata(after),metadata(before));}
 assert.deepEqual(after.ledger.filter(m=>m.version!=="130"),before.ledger);
}else assert.deepEqual(after,before);
await writeFile(`${directory}/after.json`,JSON.stringify(after),{mode:0o600});console.log(JSON.stringify({status:mode==="--apply"?"APPLIED_AND_VERIFIED":"DRY_RUN_ROLLED_BACK_VERIFIED",target,version:"130",directory}));
