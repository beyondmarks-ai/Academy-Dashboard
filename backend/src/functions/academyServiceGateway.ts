import { app,type HttpRequest,type HttpResponseInit,type InvocationContext } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { resolveAcademyCredential } from "../academyCredentials.js";
import { ensureProfile,requireAuth } from "../auth.js";
import { query,transaction } from "../db.js";
import { errorResponse,HttpError } from "../http.js";
import { deleteAcademyServiceBlob,downloadAcademyServiceBlob,listAcademyServiceBlobs,uploadAcademyServiceBlob } from "../storage.js";

const serviceTypes=new Set(["blob_storage","container_compute","machine_learning","database","functions","document_intelligence","speech_vision","messaging","monitoring"]);
const serviceAliases:Record<string,string>={storage:"blob_storage",blob:"blob_storage","blob-storage":"blob_storage",db:"database"};
type Entitlement={id:string;user_id:string;service_type:string;quota_limit:number;quota_unit:string;usage_count:number;status:string;expires_at:string|null};

function academyKey(request:HttpRequest){
  const direct=request.headers.get("x-academy-key")?.trim();
  const authorization=request.headers.get("authorization");
  const bearer=authorization?.toLowerCase().startsWith("bearer ")?authorization.slice(7).trim():"";
  const key=direct||bearer;
  if(!key?.startsWith("bm_live_"))throw new HttpError(401,"A valid Academy key is required.","GATEWAY_UNAUTHENTICATED");
  return key;
}

async function entitlementFor(request:HttpRequest,serviceType:string){
  const credential=await resolveAcademyCredential(academyKey(request));
  if(!credential||credential.status!=="active")throw new HttpError(401,"The Academy key is invalid or inactive.","GATEWAY_UNAUTHENTICATED");
  const result=await query<Entitlement>(`
    SELECT entitlement.id,entitlement.user_id,entitlement.service_type,
      entitlement.quota_limit::float8 quota_limit,entitlement.quota_unit,
      entitlement.usage_count::float8 usage_count,entitlement.status,entitlement.expires_at
    FROM service_entitlements entitlement
    JOIN academy_credential_scopes scope ON scope.source_id=entitlement.id
      AND scope.credential_id=$1 AND scope.scope_type='service' AND scope.scope_key=$2
    JOIN user_profiles profile ON profile.id=entitlement.user_id
    WHERE entitlement.user_id=$3 AND entitlement.service_type=$2
      AND entitlement.status='active' AND scope.status='active' AND profile.status='active'
    ORDER BY entitlement.updated_at DESC LIMIT 1
  `,[credential.id,serviceType,credential.user_id]);
  const item=result.rows[0];
  if(!item)throw new HttpError(403,`Active ${serviceType.replaceAll("_"," ")} access is not assigned to this Academy key.`,"SERVICE_NOT_ALLOWED");
  if(item.expires_at&&new Date(item.expires_at)<=new Date()){
    await query(`UPDATE service_entitlements SET status='expired',updated_at=now() WHERE id=$1`,[item.id]);
    await query(`UPDATE academy_credential_scopes SET status='expired',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[item.id]);
    throw new HttpError(403,"This service allowance has expired.","SERVICE_EXPIRED");
  }
  return item;
}

async function consoleEntitlementFor(request:HttpRequest,serviceType:string){
  const profile=await ensureProfile(await requireAuth(request));
  const result=await query<Entitlement>(`
    SELECT id,user_id,service_type,quota_limit::float8 quota_limit,quota_unit,
      usage_count::float8 usage_count,status,expires_at
    FROM service_entitlements
    WHERE user_id=$1 AND service_type=$2 AND status='active'
    ORDER BY updated_at DESC LIMIT 1
  `,[profile!.id,serviceType]);
  const item=result.rows[0];
  if(!item)throw new HttpError(403,`You do not have active ${serviceType.replaceAll("_"," ")} access.`,"SERVICE_NOT_ALLOWED");
  if(item.expires_at&&new Date(item.expires_at)<=new Date()){
    await query(`UPDATE service_entitlements SET status='expired',updated_at=now() WHERE id=$1`,[item.id]);
    await query(`UPDATE academy_credential_scopes SET status='expired',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[item.id]);
    throw new HttpError(403,"This service allowance has expired.","SERVICE_EXPIRED");
  }
  return item;
}

async function consume(item:Entitlement,quantity:number,operation:string,request:HttpRequest,metadata:Record<string,unknown>={}){
  const amount=Math.max(1,Math.ceil(quantity));
  const idempotency=request.headers.get("idempotency-key")?.trim()||randomUUID();
  return transaction(async client=>{
    const existing=await client.query(`SELECT quantity::float8 quantity FROM service_usage_events WHERE idempotency_key=$1`,[idempotency]);
    if(existing.rows[0])return Number(existing.rows[0].quantity);
    const locked=await client.query<Entitlement>(`SELECT id,user_id,quota_limit::float8 quota_limit,quota_unit,usage_count::float8 usage_count,status,expires_at,service_type FROM service_entitlements WHERE id=$1 FOR UPDATE`,[item.id]);
    const current=locked.rows[0]!;
    if(current.status!=="active")throw new HttpError(403,"This service allowance is not active.","SERVICE_INACTIVE");
    if(current.usage_count+amount>current.quota_limit)throw new HttpError(429,`Allowance exhausted. ${Math.max(0,current.quota_limit-current.usage_count).toLocaleString()} ${current.quota_unit} remain.`,"SERVICE_QUOTA_EXHAUSTED");
    await client.query(`UPDATE service_entitlements SET usage_count=usage_count+$1,updated_at=now() WHERE id=$2`,[amount,current.id]);
    await client.query(`
      INSERT INTO service_usage_events(entitlement_id,user_id,idempotency_key,operation,quantity,quota_unit,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
    `,[current.id,current.user_id,idempotency,operation,amount,current.quota_unit,JSON.stringify(metadata)]);
    return amount;
  });
}

async function jsonBody(request:HttpRequest){
  try{return await request.json() as Record<string,unknown>;}catch{throw new HttpError(400,"A valid JSON request body is required.");}
}
function safeName(value:string){
  const name=value.trim().replace(/^\/+/,"");
  if(!name||name.length>500||name.includes(".."))throw new HttpError(422,"A safe object name is required.");
  return name;
}
function jsonResponse(status:number,data:unknown,item:Entitlement,charged=0):HttpResponseInit{
  const remaining=Math.max(0,item.quota_limit-item.usage_count-charged);
  return {status,jsonBody:{data},headers:{"cache-control":"no-store","x-academy-quota-unit":item.quota_unit,"x-academy-usage-charged":String(charged),"x-academy-usage-remaining":String(remaining)}};
}

async function gateway(request:HttpRequest,context:InvocationContext,resolveEntitlement=entitlementFor,meterReads=true):Promise<HttpResponseInit>{
  try{
    const requestedServiceType=request.params.serviceType||"";
    const serviceType=serviceAliases[requestedServiceType]||requestedServiceType;
    const operation=request.params.operation||"status";
    const resourceId=request.params.resourceId||"";
    if(!serviceTypes.has(serviceType))throw new HttpError(404,"Unknown Academy Azure service.");
    const item=await resolveEntitlement(request,serviceType);
    const charge=(quantity:number,chargedOperation:string,metadata:Record<string,unknown>={})=>
      !meterReads&&request.method==="GET"?Promise.resolve(0):consume(item,quantity,chargedOperation,request,metadata);
    if(operation==="status")return jsonResponse(200,{serviceType,status:"active",quota:{limit:item.quota_limit,used:item.usage_count,remaining:Math.max(0,item.quota_limit-item.usage_count),unit:item.quota_unit},expiresAt:item.expires_at},item);

    if(serviceType==="blob_storage"){
      if((operation==="upload"||operation==="objects")&&["PUT","POST"].includes(request.method)){
        const name=safeName(resourceId||request.query.get("name")||"");
        const blobName=`${item.user_id}/${item.id}/${name}`;
        const data=Buffer.from(await request.arrayBuffer());
        const charged=await charge(data.byteLength,"blob.upload",{name});
        await uploadAcademyServiceBlob(blobName,data,request.headers.get("content-type")||"application/octet-stream");
        return jsonResponse(201,{name,size:data.byteLength},item,charged);
      }
      if((operation==="download"||(operation==="objects"&&!!resourceId))&&request.method==="GET"){
        const name=safeName(resourceId||request.query.get("name")||"");
        const blobName=`${item.user_id}/${item.id}/${name}`;
        const blob=await downloadAcademyServiceBlob(blobName);
        const charged=await charge(blob.data.byteLength,"blob.download",{name});
        return {status:200,body:blob.data,headers:{"content-type":blob.contentType,"content-disposition":`inline; filename="${name.split("/").at(-1)?.replaceAll('"',"")||"download"}"`,"cache-control":"private, no-store","x-academy-usage-charged":String(charged)}};
      }
      if((operation==="delete"||operation==="objects")&&request.method==="DELETE"){
        const name=safeName(resourceId||request.query.get("name")||"");
        const blobName=`${item.user_id}/${item.id}/${name}`;
        await deleteAcademyServiceBlob(blobName);const charged=await charge(1,"blob.delete",{name});
        return jsonResponse(200,{deleted:true,name},item,charged);
      }
      if((operation==="list"||(operation==="objects"&&!resourceId))&&request.method==="GET"){
        const prefix=`${item.user_id}/${item.id}/${request.query.get("prefix")||""}`;
        const blobs=await listAcademyServiceBlobs(prefix);const charged=await charge(1,"blob.list");
        return jsonResponse(200,{objects:blobs},item,charged);
      }
    }

    if(serviceType==="database"){
      if(operation==="records"&&["PUT","POST"].includes(request.method)){
        const body=await jsonBody(request),collection=String(body.collection||"default"),key=String(body.key||"");
        const recordKey=resourceId||key;
        if(!recordKey||recordKey.length>200)throw new HttpError(422,"A record key is required in the URL or request body.");
        const value=body.value??null,bytes=Buffer.byteLength(JSON.stringify(value));
        const charged=await charge(Math.max(1,bytes/1_048_576),"database.upsert",{collection,key:recordKey,bytes});
        await query(`INSERT INTO academy_service_records(entitlement_id,collection,record_key,value) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(entitlement_id,collection,record_key) DO UPDATE SET value=excluded.value,updated_at=now()`,[item.id,collection,recordKey,JSON.stringify(value)]);
        return jsonResponse(200,{collection,key:recordKey,value},item,charged);
      }
      if(operation==="records"&&request.method==="GET"){
        const collection=request.query.get("collection")||"default",key=resourceId||request.query.get("key");
        const result=key
          ?await query(`SELECT record_key key,value,created_at,updated_at FROM academy_service_records WHERE entitlement_id=$1 AND collection=$2 AND record_key=$3`,[item.id,collection,key])
          :await query(`SELECT record_key key,value,created_at,updated_at FROM academy_service_records WHERE entitlement_id=$1 AND collection=$2 ORDER BY updated_at DESC LIMIT 200`,[item.id,collection]);
        const charged=await charge(1,"database.read",{collection});
        return jsonResponse(200,{records:result.rows},item,charged);
      }
      if(operation==="records"&&request.method==="DELETE"){
        const collection=request.query.get("collection")||"default",key=resourceId||request.query.get("key")||"";
        if(!key)throw new HttpError(422,"A record key is required in the URL or query string.");
        const result=await query(`DELETE FROM academy_service_records WHERE entitlement_id=$1 AND collection=$2 AND record_key=$3 RETURNING record_key key`,[item.id,collection,key]);
        if(!result.rows[0])throw new HttpError(404,"Database record not found.");
        const charged=await charge(1,"database.delete",{collection,key});
        return jsonResponse(200,{deleted:true,collection,key},item,charged);
      }
    }

    if(serviceType==="messaging"){
      if(operation==="publish"&&request.method==="POST"){
        const body=await jsonBody(request),topic=String(body.topic||"default");
        const result=await query(`INSERT INTO academy_service_messages(entitlement_id,topic,payload) VALUES($1,$2,$3::jsonb) RETURNING id,topic,payload,status,created_at`,[item.id,topic,JSON.stringify(body.payload??null)]);
        const charged=await charge(1,"messaging.publish",{topic});
        return jsonResponse(201,result.rows[0],item,charged);
      }
      if(operation==="receive"&&request.method==="GET"){
        const topic=request.query.get("topic")||"default";
        const result=await query(`SELECT id,topic,payload,status,created_at FROM academy_service_messages WHERE entitlement_id=$1 AND topic=$2 AND status='available' ORDER BY created_at LIMIT 100`,[item.id,topic]);
        const charged=await charge(Math.max(1,result.rowCount||0),"messaging.receive",{topic});
        return jsonResponse(200,{messages:result.rows},item,charged);
      }
      if(operation==="ack"&&request.method==="POST"){
        const body=await jsonBody(request),id=String(body.id||"");
        const result=await query(`UPDATE academy_service_messages SET status='acknowledged',acknowledged_at=now() WHERE id=$1 AND entitlement_id=$2 RETURNING id,status,acknowledged_at`,[id,item.id]);
        if(!result.rows[0])throw new HttpError(404,"Message not found.");
        const charged=await charge(1,"messaging.ack",{id});
        return jsonResponse(200,result.rows[0],item,charged);
      }
    }

    if(serviceType==="monitoring"&&operation==="events"){
      if(request.method==="POST"){
        const body=await jsonBody(request),key=randomUUID(),bytes=Buffer.byteLength(JSON.stringify(body));
        const charged=await charge(Math.max(1,bytes/1_048_576),"monitoring.ingest",{bytes});
        await query(`INSERT INTO academy_service_records(entitlement_id,collection,record_key,value) VALUES($1,'events',$2,$3::jsonb)`,[item.id,key,JSON.stringify(body)]);
        return jsonResponse(202,{id:key,accepted:true},item,charged);
      }
      const result=await query(`SELECT record_key id,value,created_at FROM academy_service_records WHERE entitlement_id=$1 AND collection='events' ORDER BY created_at DESC LIMIT 200`,[item.id]);
      const charged=await charge(1,"monitoring.query");
      return jsonResponse(200,{events:result.rows},item,charged);
    }

    if(["container_compute","machine_learning","functions","document_intelligence","speech_vision"].includes(serviceType)){
      if(operation==="jobs"&&request.method==="POST"){
        const body=await jsonBody(request);
        const result=await query(`INSERT INTO academy_service_jobs(entitlement_id,service_type,operation,input,status) VALUES($1,$2,$3,$4::jsonb,'queued') RETURNING id,service_type,operation,status,created_at`,[item.id,serviceType,String(body.operation||"run"),JSON.stringify(body.input??body)]);
        const quantity=serviceType==="document_intelligence"?Number(body.pages||1):serviceType==="speech_vision"?Number(body.minutes||1):1;
        const charged=await charge(quantity,`${serviceType}.submit`);
        return jsonResponse(202,result.rows[0],item,charged);
      }
      if(operation==="jobs"&&request.method==="GET"){
        const result=await query(`SELECT id,service_type,operation,status,output,error_message,created_at,started_at,completed_at FROM academy_service_jobs WHERE entitlement_id=$1 ORDER BY created_at DESC LIMIT 100`,[item.id]);
        const charged=await charge(1,`${serviceType}.list`);
        return jsonResponse(200,{jobs:result.rows},item,charged);
      }
    }
    throw new HttpError(404,"This operation is not available for the selected service.");
  }catch(error){
    context.error("Academy Azure gateway failed",error);
    return errorResponse(error,context.invocationId);
  }
}

app.http("academyAzureServiceGateway",{
  route:"v1/gateway/azure/v1/{serviceType}/{operation?}",
  methods:["GET","POST","PUT","DELETE"],
  authLevel:"anonymous",
  handler:(request,context)=>gateway(request,context),
});
app.http("academyAzureServiceResourceGateway",{
  route:"v1/gateway/azure/v1/{serviceType}/{operation}/{resourceId}",
  methods:["GET","POST","PUT","DELETE"],
  authLevel:"anonymous",
  handler:(request,context)=>gateway(request,context),
});
app.http("academyServiceConsole",{
  route:"v1/service-console/{serviceType}/{operation?}",
  methods:["GET","POST","PUT","DELETE"],
  authLevel:"anonymous",
  handler:(request,context)=>gateway(request,context,consoleEntitlementFor,false),
});
app.http("academyServiceConsoleResource",{
  route:"v1/service-console/{serviceType}/{operation}/{resourceId}",
  methods:["GET","POST","PUT","DELETE"],
  authLevel:"anonymous",
  handler:(request,context)=>gateway(request,context,consoleEntitlementFor,false),
});
