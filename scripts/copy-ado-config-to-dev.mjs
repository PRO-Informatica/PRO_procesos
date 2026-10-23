// Scoped configuration seed, NOT a database clone. PROD is always READ ONLY.
// Default: transactional dry run. Pass --apply to create ADO in DEV only.
// Existing ADO data aborts the operation: nothing is replaced or deleted.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

process.loadEnvFile(".env");
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported.");
const REFS = { DEV: "gholwtklihaphoevosyb", PROD: "jeyjblxfqqlypxiaznad" };
const ACTOR_EMAIL = "demidio@pro.com.gt";

function connection(environment) {
  const uri = new URL(process.env[`${environment}_DB_URL`]);
  const username = decodeURIComponent(uri.username);
  const ref = REFS[environment];
  const direct = uri.hostname === `db.${ref}.supabase.co`;
  const pooled = uri.hostname.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`;
  if ((!direct && !pooled) || uri.pathname !== "/postgres") throw new Error(`Unexpected ${environment} database.`);
  return { ...process.env, PGHOST: uri.hostname, PGPORT: uri.port || "5432", PGUSER: username,
    PGPASSWORD: decodeURIComponent(uri.password), PGDATABASE: "postgres", PGSSLMODE: "require", PGCONNECT_TIMEOUT: "10" };
}

async function sql(environment, query, { readOnly = true } = {}) {
  if (environment === "PROD" && !readOnly) throw new Error("PROD writes are forbidden.");
  const input = readOnly
    ? `begin isolation level repeatable read read only;
       do $$ begin if current_setting('transaction_read_only') <> 'on' then raise exception 'READ_ONLY_REQUIRED'; end if; end $$;
       ${query}\nrollback;`
    : query;
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env: connection(environment) });
    let output = "";
    let errors = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { errors += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors || `psql failed (${environment}).`)));
    child.stdin.end(input);
  });
}

// Whitelist of business configuration. No credentials, identities, memberships,
// operational records, documents, Storage objects or production audits.
const snapshotQuery = `select jsonb_build_object(
 'sourceCompanyId',c.id,'company',jsonb_build_object('code',c.code,'name',c.name,'status',c.status),
 'suppliers',coalesce((select jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'tax_id',s.tax_id,
   'active',s.active,'is_preconfigured',s.is_preconfigured) order by s.code) from public.suppliers s where s.company_id=c.id),'[]'),
 'incidents',coalesce((select jsonb_agg(jsonb_build_object('code',i.code,'name',i.name,'active',i.active)
   order by i.code) from public.incident_types i where i.company_id=c.id),'[]'),
 'projects',coalesce((select jsonb_agg(jsonb_build_object('sourceId',p.id,'code',p.code,'name',p.name,
   'status',p.status,'address',p.address,'timezone',p.timezone,'start_date',p.start_date,
   'estimated_end_date',p.estimated_end_date,'billing_legal_name',p.billing_legal_name,'billing_tax_id',p.billing_tax_id,
   'suppliers',coalesce((select jsonb_agg(jsonb_build_object('code',s.code,'active',ps.active,'is_default',ps.is_default)
     order by s.code) from public.project_suppliers ps join public.suppliers s on s.id=ps.supplier_id
     where ps.project_id=p.id and ps.company_id=c.id),'[]'),
   'workItems',coalesce((select jsonb_agg(jsonb_build_object('code',w.code,'name',w.name,'active',w.active)
     order by w.code) from public.project_work_items w where w.project_id=p.id),'[]'),
   'products',coalesce((select jsonb_agg(jsonb_build_object('code',pp.code,'reference',pp.reference,'price',pp.price::text)
     order by pp.code,pp.reference) from public.project_product_prices pp where pp.project_id=p.id),'[]'),
   'services',coalesce((select jsonb_agg(jsonb_build_object('code',sp.code,'price',sp.price::text,
     'description',to_jsonb(sp)->>'description','unit_code',to_jsonb(sp)->>'unit_code','observations',to_jsonb(sp)->>'observations')
     order by sp.code,to_jsonb(sp)->>'observations')
     from public.project_service_prices sp where sp.project_id=p.id),'[]')
   ) order by p.code) from public.projects p where p.company_id=c.id),'[]')
) from public.companies c where c.code='PRO-ADO'`;

function business(snapshot) {
  const config = { ...snapshot };
  delete config.sourceCompanyId;
  config.projects = config.projects.map((project) => {
    const copy = { ...project };
    delete copy.sourceId;
    return copy;
  });
  return config;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

const sourceText = await sql("PROD", `${snapshotQuery};`);
if (!sourceText) throw new Error("PRO-ADO is absent in PROD.");
const source = JSON.parse(sourceText);
if (source.sourceCompanyId !== "7de72297-5ec9-4167-8f3b-fae742cd4745" || source.company.code !== "PRO-ADO"
  || source.projects.length !== 1 || source.projects[0].code !== "ADO-PRO") {
  throw new Error("ADO scope changed. Review the source before copying.");
}
const fingerprint = digest(business(source));
const blockTag = `$ado_copy_${fingerprint}$`;
if (JSON.stringify(source).includes(blockTag)) throw new Error("Unsafe SQL block delimiter.");
const actorText = await sql("DEV", `select p.id from public.profiles p join public.platform_admins a
  on a.user_id=p.id and a.active join auth.users u on u.id=p.id
  where lower(u.email)=${literal(ACTOR_EMAIL)} and p.active;`);
if (!/^[0-9a-f-]{36}$/i.test(actorText)) throw new Error("The existing DEV administrator could not be verified.");
if (apply && process.env.NEXT_PUBLIC_APP_ENV !== "DEV") throw new Error("Local app must target DEV.");

const masterPreservation = `select jsonb_build_object(
 'companies',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.companies x where id is distinct from v_company),
 'projects',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.projects x where company_id is distinct from v_company),
 'suppliers',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.suppliers x where company_id is distinct from v_company),
 'incidents',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.incident_types x where company_id is distinct from v_company),
 'project_suppliers',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by project_id,supplier_id)::text,'')) from public.project_suppliers x where company_id is distinct from v_company),
 'products',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from public.project_product_prices x join public.projects p on p.id=x.project_id where p.company_id is distinct from v_company),
 'services',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from public.project_service_prices x join public.projects p on p.id=x.project_id where p.company_id is distinct from v_company),
 'work_items',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from public.project_work_items x join public.projects p on p.id=x.project_id where p.company_id is distinct from v_company))`;
const preservedTables = ["programming", "programming_lines", "dispatches", "dispatch_guides", "dispatch_guide_lines",
  "dispatch_incidents", "batches", "batch_dispatches", "invoices", "invoice_lines", "documents", "document_versions",
  "dispatch_reconciliations", "company_members", "company_member_roles", "project_members", "project_member_roles"];
const operationalCounts = `select jsonb_build_object(${preservedTables.map((table) => `${literal(table)},(select count(*) from public.${table})`).join(",")})`;

const transaction = `begin isolation level serializable;
set local lock_timeout='5s'; set local statement_timeout='30s'; set local standard_conforming_strings=on;
select pg_advisory_xact_lock(hashtextextended('dev-copy-config:PRO-ADO',0));
create temp table ado_copy_result(payload jsonb) on commit drop;
do ${blockTag}
declare
 v_payload jsonb := ${literal(JSON.stringify(source))}::jsonb;
 v_company uuid := null; v_project uuid; v_actor uuid := ${literal(actorText)}::uuid;
 v_p jsonb; v_supplier jsonb; v_incident jsonb; v_expected jsonb; v_actual jsonb;
 v_before_masters jsonb; v_after_masters jsonb; v_before_operations jsonb; v_after_operations jsonb;
begin
 if exists(select 1 from public.companies where upper(code)='PRO-ADO' or upper(name)='ADO')
    or exists(select 1 from public.projects where upper(code)='ADO-PRO') then
   raise exception 'DEV_ADO_ALREADY_EXISTS_NO_OVERWRITE';
 end if;
 if not exists(select 1 from public.platform_admins where user_id=v_actor and active) then raise exception 'DEV_ACTOR_NOT_AUTHORIZED'; end if;
 perform set_config('request.jwt.claim.sub',v_actor::text,true);
 v_before_masters := (${masterPreservation});
 v_before_operations := (${operationalCounts});
 insert into public.companies(code,name,status)
 values(v_payload->'company'->>'code',v_payload->'company'->>'name',(v_payload->'company'->>'status')::public.company_status)
 returning id into v_company;
 for v_supplier in select * from jsonb_array_elements(v_payload->'suppliers') loop
   insert into public.suppliers(company_id,code,name,tax_id,active,is_preconfigured)
   values(v_company,v_supplier->>'code',v_supplier->>'name',v_supplier->>'tax_id',
     (v_supplier->>'active')::boolean,(v_supplier->>'is_preconfigured')::boolean)
   on conflict(company_id,code) do update set name=excluded.name,tax_id=excluded.tax_id,
     active=excluded.active,is_preconfigured=excluded.is_preconfigured;
 end loop;
 for v_incident in select * from jsonb_array_elements(v_payload->'incidents') loop
   insert into public.incident_types(company_id,code,name,active)
   values(v_company,v_incident->>'code',v_incident->>'name',(v_incident->>'active')::boolean)
   on conflict(company_id,code) do update set name=excluded.name,active=excluded.active;
 end loop;
 for v_p in select * from jsonb_array_elements(v_payload->'projects') loop
   insert into public.projects(company_id,name,code,address,timezone,status,start_date,estimated_end_date,billing_legal_name,billing_tax_id)
   values(v_company,v_p->>'name',v_p->>'code',v_p->>'address',v_p->>'timezone',(v_p->>'status')::public.project_status,
     (v_p->>'start_date')::date,(v_p->>'estimated_end_date')::date,v_p->>'billing_legal_name',v_p->>'billing_tax_id')
   returning id into v_project;
   insert into public.project_suppliers(company_id,project_id,supplier_id,active,is_default)
   select v_company,v_project,s.id,r.active,r.is_default from jsonb_to_recordset(v_p->'suppliers') as r(code text,active boolean,is_default boolean)
   join public.suppliers s on s.company_id=v_company and s.code=r.code;
   insert into public.project_work_items(project_id,code,name,active)
   select v_project,r.code,r.name,r.active from jsonb_to_recordset(v_p->'workItems') as r(code text,name text,active boolean);
   insert into public.project_product_prices(project_id,code,reference,price)
   select v_project,r.code,r.reference,r.price::numeric(18,4) from jsonb_to_recordset(v_p->'products') as r(code text,reference text,price text);
   insert into public.project_service_prices(project_id,code,price,description,unit_code,observations)
   select v_project,r.code,r.price::numeric(18,4),r.description,r.unit_code,r.observations
   from jsonb_to_recordset(v_p->'services') as r(code text,price text,description text,unit_code text,observations text);
   insert into public.audit_events(actor_user_id,company_id,project_id,entity_type,entity_id,action,new_values,comment)
   values(v_actor,v_company,v_project,'project',v_project,'DEV_CONFIGURATION_COPIED_FROM_PROD',
     jsonb_build_object('source_company_id',v_payload->>'sourceCompanyId','source_project_id',v_p->>'sourceId',
       'source','PROD','target','DEV','config_sha256',${literal(fingerprint)},
       'products',jsonb_array_length(v_p->'products'),'services',jsonb_array_length(v_p->'services')),
     'Configuration only. New DEV IDs. No production users, roles, credentials, operations, documents or audit history copied.');
 end loop;
 v_expected := v_payload-'sourceCompanyId';
 v_expected := jsonb_set(v_expected,'{projects}',(select jsonb_agg(value-'sourceId' order by value->>'code') from jsonb_array_elements(v_expected->'projects')));
 v_actual := (${snapshotQuery});
 v_actual := v_actual-'sourceCompanyId';
 v_actual := jsonb_set(v_actual,'{projects}',(select jsonb_agg(value-'sourceId' order by value->>'code') from jsonb_array_elements(v_actual->'projects')));
 if v_actual is distinct from v_expected then raise exception 'CONFIGURATION_COMPARISON_FAILED'; end if;
 v_after_masters := (${masterPreservation});
 v_after_operations := (${operationalCounts});
 if v_before_masters is distinct from v_after_masters then raise exception 'UNRELATED_DEV_CONFIGURATION_CHANGED'; end if;
 if v_before_operations is distinct from v_after_operations then raise exception 'OPERATIONAL_DATA_OR_MEMBERSHIPS_CHANGED'; end if;
 insert into ado_copy_result values(jsonb_build_object('mode',${literal(apply ? "APPLIED" : "ROLLBACK_DRY_RUN")},
   'companyId',v_company,'projectId',v_project,'company','PRO-ADO','project','ADO-PRO',
   'products',jsonb_array_length(v_payload->'projects'->0->'products'),
   'services',jsonb_array_length(v_payload->'projects'->0->'services'),
   'suppliers',jsonb_array_length(v_payload->'suppliers'),'incidentTypes',jsonb_array_length(v_payload->'incidents'),
   'configurationMatch',true,'unrelatedDevConfigPreserved',true,'operationalCounts',v_after_operations,
   'productionReadOnly',true,'configSha256',${literal(fingerprint)}));
end;
${blockTag};
select payload from ado_copy_result;
${apply ? "commit" : "rollback"};`;

const output = await sql("DEV", transaction, { readOnly: false });
const reportLine = output.split("\n").find((line) => line.startsWith("{"));
if (!reportLine) throw new Error("No copy verification result was returned.");
const result = JSON.parse(reportLine);
if (apply) {
  const copied = JSON.parse(await sql("DEV", `${snapshotQuery};`));
  if (digest(business(copied)) !== fingerprint) throw new Error("Post-commit configuration verification failed.");
  result.postCommitVerification = "PASS";
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
