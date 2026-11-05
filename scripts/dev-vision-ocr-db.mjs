// Intentionally has NO PROD target. Keep OCR experiments on the feature branch.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
process.loadEnvFile('.env'); process.umask(0o077);
const mode=process.argv[2];
const version=process.argv[3]??'131';
if(!['131','132','135','136','137'].includes(version))throw Error('Only OCR migrations 131, 132, 135, 136 or 137');
if(!['--check','--dry-run','--apply','--qa'].includes(mode)||process.argv.length>4)throw Error('Use --check|--dry-run|--apply|--qa');
const branch=spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim();
if(branch!=='feature/vision-ocr')throw Error('Requires feature/vision-ocr');
const ref='gholwtklihaphoevosyb';
const uri=new URL(process.env.DEV_DB_URL);
const user=decodeURIComponent(uri.username);
if(uri.pathname!=='/postgres'||!((uri.hostname.endsWith('.pooler.supabase.com')&&user===`postgres.${ref}`)||(uri.hostname===`db.${ref}.supabase.co`&&user==='postgres')))throw Error('DEV database assertion failed');
const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||'5432',PGUSER:user,PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'};
function sql(input){const r=spawnSync('psql',['-XAtq','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8',timeout:90000,maxBuffer:20*1024*1024});if(r.status!==0)throw Error(r.stderr||'SQL failed');return r.stdout.trim();}
const migrationName=({131:'vision_ocr_guide_capture',132:'preserve_unpriced_ocr_description',135:'ocr_informational_source_identity',136:'guide_resident_fields_optional_units',137:'guide_manual_details'})[version];
const source=await readFile(`supabase/migrations/${version}_${migrationName}.sql`,'utf8');
const quote=s=>`'${s.replaceAll("'","''")}'`;
const digest=s=>createHash('sha256').update(s).digest('hex');
const state=()=>JSON.parse(sql(`begin read only;select jsonb_build_object('latest',(select max(version) from supabase_migrations.schema_migrations),
 'applied',exists(select 1 from supabase_migrations.schema_migrations where version='${version}'),
 'tables',(select jsonb_object_agg(name,digest) from (select c.relname name, (xpath('/row/digest/text()',query_to_xml(format('select md5(coalesce(jsonb_agg(%1$s order by (%1$s)::text)::text,''[]'')) as digest from public.%2$I t',case when '${version}'='137' and c.relname='dispatch_guides' then '(to_jsonb(t) - ''details'')' when '${version}'='136' and c.relname='dispatch_guides' then '(to_jsonb(t) - ''casting_element'' - ''laboratory_applied'')' else 'to_jsonb(t)' end,c.relname),false,true,'')))[1]::text digest
 from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname<>'guide_ocr_captures') t));rollback;`));
const qaFile=version==='137'?'supabase/qa/guide_manual_details.sql':version==='136'?'supabase/qa/guide_resident_optional_units.sql':'supabase/qa/vision_ocr_guides.sql';
const before=state();console.log(JSON.stringify({target:'DEV',ref,branch,latest:before.latest,applied:before.applied,migrationSha256:digest(source)}));
if(mode==='--check')process.exit(0);
if(mode==='--qa'){
 if(!before.applied)throw Error('Apply the reviewed DEV migration first');
 console.log(sql(await readFile(qaFile,'utf8')));
 const after=state();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('QA changed preserved data');
 console.log('DEV_QA_ROLLED_BACK_DATA_VERIFIED');process.exit(0);
}
if(before.applied){if(sql(`select statements[1] from supabase_migrations.schema_migrations where version='${version}'`)!==source.trim())throw Error('Applied source differs');console.log('ALREADY_APPLIED_DEV_VERIFIED');process.exit(0);}
if(before.latest!==({131:'130',132:'131',135:'134',136:'135',137:'136'})[version])throw Error('Requires the preceding migration, with no later migration');
if(mode==='--apply'){
 await mkdir('tmp',{recursive:true});const dir=await mkdtemp('tmp/vision-ocr-dev-backup-');
 const r=spawnSync('pg_dump',['--format=custom','--schema=public','--schema=app_private','--schema=supabase_migrations','--file',`${dir}/before.dump`],{env,encoding:'utf8',timeout:90000});
 if(r.status!==0)throw Error(r.stderr||'Backup failed');
 const verify=spawnSync('pg_restore',['--list',`${dir}/before.dump`],{encoding:'utf8'});
 if(verify.status!==0||!verify.stdout.includes('dispatch_guides'))throw Error('Backup verification failed');
 await writeFile(`${dir}/manifest.json`,JSON.stringify({ref,branch,migrationSha256:digest(source),backupSha256:digest(await readFile(`${dir}/before.dump`))},null,2));
 console.log(JSON.stringify({backup:dir,verified:true}));
}
const body=source.replace(/^begin;$/mu,'').replace(/^commit;$/mu,'');
const qa=mode==='--dry-run'&&['132','135','136','137'].includes(version)? (await readFile(qaFile,'utf8')).replace(/^begin;$/mu,'').replace(/^rollback;$/mu,''):'';
console.log(sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
 select pg_advisory_xact_lock(hashtextextended('DEV:vision-ocr:${version}',0));
 ${body}
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${migrationName}',array[${quote(source)}]);
 savepoint fixtures;${qa}rollback to savepoint fixtures;
 ${mode==='--apply'?'commit':'rollback'};`));
const after=state();
if(JSON.stringify(before.tables)!==JSON.stringify(after.tables))throw Error('Preserved data changed');
if(mode==='--dry-run'&&JSON.stringify(before)!==JSON.stringify(after))throw Error('Dry run did not roll back');
if(mode==='--apply'&&!after.applied)throw Error('Ledger missing');
console.log(mode==='--apply'?'APPLIED_DEV_ONLY_DATA_VERIFIED':'DRY_RUN_DEV_ROLLED_BACK_VERIFIED');
