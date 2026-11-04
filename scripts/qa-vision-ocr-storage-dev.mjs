// Real Storage round trip, isolated paths and DEV credentials only. No guides.
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
const ref='gholwtklihaphoevosyb',url=process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
if(process.env.NEXT_PUBLIC_APP_ENV!=='DEV'||new URL(url).hostname!==`${ref}.supabase.co`||spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim()!=='feature/vision-ocr')throw Error('DEV feature branch only');
const options={auth:{autoRefreshToken:false,persistSession:false}};
const admin=createClient(url,process.env.SUPABASE_DEV_SERVICE_ROLE_KEY,options);
const browser=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY,options);
const run=`qa-vision-ocr/${randomUUID()}`,original=`${run}/original.png`,target=`${run}/evidence.png`;
const bytes=await readFile('public/app-icons/pro-app-black-192.png');
const hash=value=>createHash('sha256').update(value).digest('hex');
let success=false;
try{
 const signed=await admin.storage.from('vision-ocr-dev').createSignedUploadUrl(original,{upsert:false});if(signed.error||!signed.data)throw Error('Signed upload preparation failed');
 const uploaded=await browser.storage.from('vision-ocr-dev').uploadToSignedUrl(original,signed.data.token,bytes,{contentType:'image/png',upsert:false});if(uploaded.error)throw Error('Signed original upload failed');
 const copy=await admin.storage.from('vision-ocr-dev').copy(original,target,{destinationBucket:'private-documents'});if(copy.error)throw Error('Cross-bucket evidence copy failed');
 const downloaded=await admin.storage.from('private-documents').download(target);if(downloaded.error||!downloaded.data)throw Error('Evidence download failed');
 if(hash(new Uint8Array(await downloaded.data.arrayBuffer()))!==hash(bytes))throw Error('Original photo bytes changed');
 success=true;
}finally{
 for(const[bucket,path]of [['vision-ocr-dev',original],['private-documents',target]]){
  const removed=await admin.storage.from(bucket).remove([path]);if(removed.error)throw Error('QA Storage cleanup failed');
  const remaining=await admin.storage.from(bucket).list(run);if(remaining.error||remaining.data?.length)throw Error('QA Storage object remains');
 }
}
if(success)console.log(JSON.stringify({status:'DEV_STORAGE_PASS',ref,signedUpload:true,originalHashPreserved:true,evidenceCopy:true,testObjectsRemoved:true}));
