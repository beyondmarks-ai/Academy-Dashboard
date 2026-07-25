import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { query, transaction } from "../db.js";
import { foundryToken } from "../foundryAuth.js";
import { errorResponse, HttpError } from "../http.js";
import { hashOpaqueToken } from "../security.js";

app.setup({ enableHttpStream: true });

type Operation =
  | "chat/completions"
  | "responses"
  | "embeddings"
  | "images/generations"
  | "audio/speech"
  | "audio/transcriptions"
  | "videos";
type QuotaUnit = "requests" | "tokens" | "images" | "minutes" | "seconds";
type GatewaySubscription = {
  id:string; user_id:string; quota_limit:number|null; quota_unit:QuotaUnit;
  usage_count:number; status:string; expires_at:string|null; allowed_deployments:string[];
  academy_id:string; user_status:string;
};
type Usage = { inputTokens:number; outputTokens:number; totalTokens:number; details:Record<string,unknown> };
type Reservation = { id:string; unit:QuotaUnit; remainingBefore:number; reservedUnits:number };

function academyCredential(request:HttpRequest){
  const direct=request.headers.get("x-academy-key")?.trim();
  const authorization=request.headers.get("authorization");
  const bearer=authorization?.toLowerCase().startsWith("bearer ")?authorization.slice(7).trim():"";
  const value=direct||bearer;
  if(!value||!value.startsWith("bm_live_"))throw new HttpError(401,"A valid Academy gateway key is required.","GATEWAY_UNAUTHENTICATED");
  return value;
}

function number(value:unknown){return typeof value==="number"&&Number.isFinite(value)&&value>=0?Math.floor(value):0;}
export function usageFrom(payload:Record<string,unknown>):Usage{
  const source=(payload.usage&&typeof payload.usage==="object"?payload.usage:{}) as Record<string,unknown>;
  const inputTokens=number(source.input_tokens??source.prompt_tokens);
  const outputTokens=number(source.output_tokens??source.completion_tokens);
  const totalTokens=number(source.total_tokens)||(inputTokens+outputTokens);
  return {inputTokens,outputTokens,totalTokens,details:source};
}
export function compatible(unit:QuotaUnit,operation:Operation){
  if(unit==="requests")return true;
  if(operation==="images/generations")return unit==="images";
  if(operation==="videos")return unit==="seconds"||unit==="minutes";
  if(operation==="audio/speech"||operation==="audio/transcriptions")return false;
  return unit==="tokens";
}
export function upperTokenBudget(body:Record<string,unknown>,operation:Operation,fallback=0){
  const output=number(body.max_completion_tokens??body.max_output_tokens??body.max_tokens);
  if(!output&&operation!=="embeddings"){
    if(fallback>0)return fallback;
    throw new HttpError(422,"Token-limited calls must include max_completion_tokens, max_output_tokens, or max_tokens.");
  }
  const inputUpperBound=Buffer.byteLength(JSON.stringify(body),"utf8");
  return inputUpperBound+output;
}

async function subscriptionFor(request:HttpRequest){
  const result=await query<GatewaySubscription>(`
    SELECT subscription.id,subscription.user_id,subscription.quota_limit::float8 quota_limit,
      subscription.quota_unit,subscription.usage_count::float8 usage_count,subscription.status,
      subscription.expires_at,subscription.allowed_deployments,profile.academy_id,
      profile.status user_status
    FROM api_subscriptions subscription JOIN user_profiles profile ON profile.id=subscription.user_id
    WHERE subscription.credential_hash=$1 AND subscription.credential_kind='academy_gateway'
  `,[hashOpaqueToken(academyCredential(request))]);
  const subscription=result.rows[0];
  if(!subscription||subscription.user_status!=="active")throw new HttpError(401,"The Academy gateway key is invalid or inactive.","GATEWAY_UNAUTHENTICATED");
  return subscription;
}

function unitsRequested(unit:QuotaUnit,operation:Operation,body:Record<string,unknown>,remaining:number){
  if(unit==="tokens")return upperTokenBudget(body,operation,remaining);
  if(unit==="images")return Math.max(1,number(body.n)||1);
  if(unit==="seconds"){
    return Math.max(1,number(body.seconds)||4);
  }
  if(unit==="minutes"){
    return Math.max(1,Math.ceil(Math.max(1,number(body.seconds)||4)/60));
  }
  return 1;
}

async function reserve(subscription:GatewaySubscription,deployment:string,operation:Operation,body:Record<string,unknown>){
  return transaction(async client=>{
    const locked=await client.query<GatewaySubscription>(`
      SELECT id,user_id,quota_limit::float8 quota_limit,quota_unit,
        usage_count::float8 usage_count,status,expires_at,allowed_deployments
      FROM api_subscriptions WHERE id=$1 FOR UPDATE
    `,[subscription.id]);
    const item=locked.rows[0]!;
    if(item.status!=="active")throw new HttpError(403,"This Academy gateway access is not active.","GATEWAY_INACTIVE");
    if(item.expires_at&&new Date(item.expires_at)<=new Date()){
      await client.query(`UPDATE api_subscriptions SET status='expired' WHERE id=$1`,[item.id]);
      throw new HttpError(403,"This Academy gateway access has expired.","GATEWAY_EXPIRED");
    }
    if(!item.allowed_deployments.includes(deployment))throw new HttpError(403,"This model deployment is not assigned to your Academy access.","MODEL_NOT_ALLOWED");
    if(!compatible(item.quota_unit,operation))throw new HttpError(409,`This access is metered in ${item.quota_unit}, which is incompatible with ${operation}.`,"QUOTA_UNIT_MISMATCH");
    if(!item.quota_limit)throw new HttpError(403,"No usage allowance is assigned.","QUOTA_NOT_ASSIGNED");
    await client.query(`DELETE FROM api_gateway_reservations WHERE subscription_id=$1 AND expires_at<=now()`,[item.id]);
    const held=await client.query<{total:number}>(`SELECT coalesce(sum(reserved_units),0)::float8 total FROM api_gateway_reservations WHERE subscription_id=$1`,[item.id]);
    const remaining=Math.max(0,item.quota_limit-item.usage_count-(held.rows[0]?.total||0));
    const requested=unitsRequested(item.quota_unit,operation,body,remaining);
    if(requested>remaining)throw new HttpError(403,`Usage limit reached. ${remaining.toLocaleString()} ${item.quota_unit} remain, but this call can use up to ${requested.toLocaleString()}.`,"QUOTA_EXHAUSTED");
    const reservationId=randomUUID();
    await client.query(`INSERT INTO api_gateway_reservations(id,subscription_id,reserved_units,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')`,[reservationId,item.id,requested]);
    return {id:reservationId,unit:item.quota_unit,remainingBefore:remaining,reservedUnits:requested};
  });
}

function endpoint(){
  const value=getConfig().AZURE_FOUNDRY_ENDPOINT?.replace(/\/$/,"");
  if(!value)throw new Error("Azure Foundry endpoint is not configured.");
  return value;
}
function upstreamUrl(operation:Operation,deployment:string){
  if(operation==="images/generations"||operation==="audio/speech"||operation==="audio/transcriptions"){
    return `${endpoint()}/openai/deployments/${encodeURIComponent(deployment)}/${operation}?api-version=2025-04-01-preview`;
  }
  if(operation==="videos")return `${endpoint()}/openai/v1/videos`;
  return `${endpoint()}/openai/v1/${operation}`;
}
async function authorizedHeaders(context:InvocationContext,contentType?:string){
  return {
    Authorization:`Bearer ${await foundryToken()}`,
    ...(contentType?{"content-type":contentType}:{}),
    "x-ms-client-request-id":context.invocationId,
  };
}

async function finalize(input:{
  subscription:GatewaySubscription; reservationId:string; operation:Operation; deployment:string;
  requestId:string; status:number; latency:number; upstreamRequestId:string|null;
  payload:Record<string,unknown>; ok:boolean; chargeOverride?:number; extraDetails?:Record<string,unknown>;
}){
  const measured=usageFrom(input.payload);
  const imageCount=Array.isArray(input.payload.data)?input.payload.data.length:0;
  const rawCharge=!input.ok?0:input.chargeOverride??(input.subscription.quota_unit==="tokens"
    ?measured.totalTokens
    :input.subscription.quota_unit==="images"
      ?imageCount
      :1);
  return transaction(async client=>{
    await client.query(`SELECT id FROM api_subscriptions WHERE id=$1 FOR UPDATE`,[input.subscription.id]);
    await client.query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[input.reservationId,input.subscription.id]);
    const current=await client.query<{quota_limit:number|null;usage_count:number}>(`SELECT quota_limit::float8 quota_limit,usage_count::float8 usage_count FROM api_subscriptions WHERE id=$1`,[input.subscription.id]);
    const available=Math.max(0,(current.rows[0]!.quota_limit||0)-current.rows[0]!.usage_count);
    const charged=Math.min(rawCharge,available);
    if(charged)await client.query(`UPDATE api_subscriptions SET usage_count=usage_count+$1 WHERE id=$2`,[charged,input.subscription.id]);
    await client.query(`
      INSERT INTO api_usage_events(subscription_id,user_id,request_id,deployment,operation,quota_unit,
        units_charged,input_tokens,output_tokens,total_tokens,status_code,latency_ms,upstream_request_id,usage_details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
      ON CONFLICT(request_id) DO NOTHING
    `,[input.subscription.id,input.subscription.user_id,input.requestId,input.deployment,input.operation,input.subscription.quota_unit,charged,measured.inputTokens,measured.outputTokens,measured.totalTokens,input.status,input.latency,input.upstreamRequestId,JSON.stringify({...measured.details,...input.extraDetails,actualUnits:rawCharge,chargedUnits:charged})]);
    return {charged,remaining:Math.max(0,available-charged),measured};
  });
}

async function recordFailure(input:{subscription:GatewaySubscription;requestId:string;deployment:string;operation:Operation;status:number;latency:number;code:string}){
  await query(`
    INSERT INTO api_usage_events(subscription_id,user_id,request_id,deployment,operation,quota_unit,
      units_charged,status_code,latency_ms,usage_details)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9::jsonb)
    ON CONFLICT(request_id) DO NOTHING
  `,[input.subscription.id,input.subscription.user_id,input.requestId,input.deployment,input.operation,input.subscription.quota_unit,input.status,input.latency,JSON.stringify({blocked:true,code:input.code})]);
}

function parseJsonText(raw:string){
  try{return JSON.parse(raw) as Record<string,unknown>;}
  catch{return {error:{message:"Foundry returned a non-JSON response."}};}
}

function inspectSse(buffer:string,current:Record<string,unknown>|null){
  let rest=buffer.replace(/\r\n/g,"\n");
  let completed=current;
  let boundary=rest.indexOf("\n\n");
  while(boundary>=0){
    const block=rest.slice(0,boundary);
    rest=rest.slice(boundary+2);
    const data=block.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
    if(data&&data!=="[DONE]"){
      try{
        const event=JSON.parse(data) as Record<string,unknown>;
        if(event.type==="response.completed"&&event.response&&typeof event.response==="object")completed=event.response as Record<string,unknown>;
      }catch{}
    }
    boundary=rest.indexOf("\n\n");
  }
  return {rest,completed};
}

function streamedBody(input:{
  upstream:Response; subscription:GatewaySubscription; reservation:Reservation; operation:Operation;
  deployment:string; requestId:string; started:number; context:InvocationContext;
}):AsyncIterable<Uint8Array>{
  return {
    async *[Symbol.asyncIterator](){
      const reader=input.upstream.body!.getReader();
      const decoder=new TextDecoder();
      let pending="";
      let completed:Record<string,unknown>|null=null;
      let finalized=false;
      try{
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          const inspected=inspectSse(pending+decoder.decode(value,{stream:true}),completed);
          pending=inspected.rest;
          completed=inspected.completed;
          yield value;
        }
        const inspected=inspectSse(pending+decoder.decode(),completed);
        completed=inspected.completed;
        const usageMissing=input.subscription.quota_unit==="tokens"&&(!completed||!usageFrom(completed).totalTokens);
        await finalize({
          subscription:input.subscription,reservationId:input.reservation.id,operation:input.operation,
          deployment:input.deployment,requestId:input.requestId,status:usageMissing?502:input.upstream.status,
          latency:Date.now()-input.started,upstreamRequestId:input.upstream.headers.get("x-request-id")||input.upstream.headers.get("apim-request-id"),
          payload:completed||{},ok:!usageMissing,extraDetails:{streamed:true},
        });
        finalized=true;
        if(usageMissing)input.context.error("Foundry stream completed without token usage.");
      }catch(error){
        input.context.error(`Foundry gateway ${input.operation} stream failed`,error);
        try{await recordFailure({subscription:input.subscription,requestId:input.requestId,deployment:input.deployment,operation:input.operation,status:502,latency:Date.now()-input.started,code:"STREAM_FAILURE"});}catch{}
        throw error;
      }finally{
        if(!finalized){
          try{await query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[input.reservation.id,input.subscription.id]);}catch{}
        }
        reader.releaseLock();
      }
    },
  };
}

function proxiedBody(body:ReadableStream<Uint8Array>):AsyncIterable<Uint8Array>{
  return {
    async *[Symbol.asyncIterator](){
      const reader=body.getReader();
      try{
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          yield value;
        }
      }finally{reader.releaseLock();}
    },
  };
}

function createJsonHandler(operation:Extract<Operation,"chat/completions"|"responses"|"embeddings"|"images/generations">){
  return async(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>=>{
    const started=Date.now();
    let reservation:Reservation|undefined;
    let subscription:GatewaySubscription|undefined;
    let deployment="unknown";
    try{
      subscription=await subscriptionFor(request);
      const text=await request.text();
      if(Buffer.byteLength(text,"utf8")>2_000_000)throw new HttpError(413,"Gateway request exceeds 2 MB.");
      let body:Record<string,unknown>;
      try{body=JSON.parse(text) as Record<string,unknown>;}catch{throw new HttpError(400,"A valid JSON request body is required.");}
      deployment=typeof body.model==="string"?body.model.trim():"";
      if(!deployment)throw new HttpError(422,"The Foundry deployment must be supplied in the model field.");
      body={...body,user:subscription.academy_id};
      reservation=await reserve(subscription,deployment,operation,body);
      const upstream=await fetch(upstreamUrl(operation,deployment),{
        method:"POST",
        headers:{...(await authorizedHeaders(context,"application/json")),accept:body.stream===true?"text/event-stream":"application/json"},
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(operation==="images/generations"?300_000:600_000),
      });
      if(body.stream===true&&upstream.ok&&upstream.body&&(operation==="responses"||operation==="chat/completions")){
        return {
          status:upstream.status,
          body:streamedBody({upstream,subscription,reservation,operation,deployment,requestId:context.invocationId,started,context}),
          headers:{
            "content-type":upstream.headers.get("content-type")||"text/event-stream; charset=utf-8",
            "cache-control":"no-cache, no-store","x-accel-buffering":"no",
            "x-academy-quota-unit":subscription.quota_unit,"x-academy-request-id":context.invocationId,
          },
        };
      }
      const payload=parseJsonText(await upstream.text());
      const usageMissing=upstream.ok&&subscription.quota_unit==="tokens"&&!usageFrom(payload).totalTokens;
      const result=await finalize({
        subscription,reservationId:reservation.id,operation,deployment,requestId:context.invocationId,
        status:usageMissing?502:upstream.status,latency:Date.now()-started,
        upstreamRequestId:upstream.headers.get("x-request-id")||upstream.headers.get("apim-request-id"),
        payload,ok:upstream.ok&&!usageMissing,
      });
      if(usageMissing)throw new HttpError(502,"Foundry did not return token usage, so the response could not be metered exactly.","USAGE_MISSING");
      return {status:upstream.status,jsonBody:payload,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-academy-quota-unit":subscription.quota_unit,"x-academy-usage-charged":String(result.charged),"x-academy-usage-remaining":String(result.remaining),"x-academy-request-id":context.invocationId}};
    }catch(error){
      if(subscription&&reservation){
        try{await query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[reservation.id,subscription.id]);}catch(cleanup){context.error("Gateway reservation cleanup failed",cleanup);}
      }
      if(subscription){
        try{await recordFailure({subscription,requestId:context.invocationId,deployment,operation,status:error instanceof HttpError?error.status:502,latency:Date.now()-started,code:error instanceof HttpError?error.code:"UPSTREAM_FAILURE"});}
        catch(ledgerError){context.error("Gateway failure ledger write failed",ledgerError);}
      }
      context.error(`Foundry gateway ${operation} failed`,error);
      return errorResponse(error,context.invocationId);
    }
  };
}

async function audioSpeech(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  const operation:Operation="audio/speech",started=Date.now();
  let subscription:GatewaySubscription|undefined,reservation:Reservation|undefined,deployment="unknown";
  try{
    subscription=await subscriptionFor(request);
    const text=await request.text();
    if(Buffer.byteLength(text,"utf8")>100_000)throw new HttpError(413,"Speech request exceeds 100 KB.");
    const body=JSON.parse(text) as Record<string,unknown>;
    deployment=typeof body.model==="string"?body.model.trim():"";
    if(!deployment)throw new HttpError(422,"The speech deployment must be supplied in the model field.");
    reservation=await reserve(subscription,deployment,operation,body);
    const upstream=await fetch(upstreamUrl(operation,deployment),{method:"POST",headers:await authorizedHeaders(context,"application/json"),body:JSON.stringify(body),signal:AbortSignal.timeout(300_000)});
    const raw=await upstream.arrayBuffer();
    const result=await finalize({subscription,reservationId:reservation.id,operation,deployment,requestId:context.invocationId,status:upstream.status,latency:Date.now()-started,upstreamRequestId:upstream.headers.get("x-request-id")||upstream.headers.get("apim-request-id"),payload:{},ok:upstream.ok,chargeOverride:1});
    return {status:upstream.status,body:raw,headers:{"content-type":upstream.headers.get("content-type")||"application/octet-stream","cache-control":"no-store","x-academy-usage-charged":String(result.charged),"x-academy-usage-remaining":String(result.remaining),"x-academy-request-id":context.invocationId}};
  }catch(error){
    if(subscription&&reservation)await query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[reservation.id,subscription.id]).catch(()=>{});
    if(subscription)await recordFailure({subscription,requestId:context.invocationId,deployment,operation,status:error instanceof HttpError?error.status:502,latency:Date.now()-started,code:error instanceof HttpError?error.code:"UPSTREAM_FAILURE"}).catch(()=>{});
    return errorResponse(error,context.invocationId);
  }
}

async function audioTranscription(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  const operation:Operation="audio/transcriptions",started=Date.now();
  let subscription:GatewaySubscription|undefined,reservation:Reservation|undefined,deployment="unknown";
  try{
    subscription=await subscriptionFor(request);
    const length=Number(request.headers.get("content-length")||0);
    if(length>26_000_000)throw new HttpError(413,"Audio upload exceeds 26 MB.");
    const form=await request.formData();
    deployment=String(form.get("model")||"").trim();
    if(!deployment)throw new HttpError(422,"The transcription deployment must be supplied in the model field.");
    reservation=await reserve(subscription,deployment,operation,{model:deployment});
    const upstream=await fetch(upstreamUrl(operation,deployment),{method:"POST",headers:await authorizedHeaders(context),body:form,signal:AbortSignal.timeout(600_000)});
    const raw=await upstream.arrayBuffer();
    const result=await finalize({subscription,reservationId:reservation.id,operation,deployment,requestId:context.invocationId,status:upstream.status,latency:Date.now()-started,upstreamRequestId:upstream.headers.get("x-request-id")||upstream.headers.get("apim-request-id"),payload:{},ok:upstream.ok,chargeOverride:1});
    return {status:upstream.status,body:raw,headers:{"content-type":upstream.headers.get("content-type")||"application/json; charset=utf-8","cache-control":"no-store","x-academy-usage-charged":String(result.charged),"x-academy-usage-remaining":String(result.remaining),"x-academy-request-id":context.invocationId}};
  }catch(error){
    if(subscription&&reservation)await query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[reservation.id,subscription.id]).catch(()=>{});
    if(subscription)await recordFailure({subscription,requestId:context.invocationId,deployment,operation,status:error instanceof HttpError?error.status:502,latency:Date.now()-started,code:error instanceof HttpError?error.code:"UPSTREAM_FAILURE"}).catch(()=>{});
    return errorResponse(error,context.invocationId);
  }
}

async function createVideoJob(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  const operation:Operation="videos",started=Date.now();
  let subscription:GatewaySubscription|undefined,reservation:Reservation|undefined,deployment="unknown";
  try{
    subscription=await subscriptionFor(request);
    const contentType=request.headers.get("content-type")||"";
    let body:Record<string,unknown>,upstreamBody:FormData;
    if(contentType.toLowerCase().includes("multipart/form-data")){
      upstreamBody=await request.formData();
      body={
        model:String(upstreamBody.get("model")||""),
        prompt:String(upstreamBody.get("prompt")||""),
        seconds:Number(upstreamBody.get("seconds")||4),
        size:String(upstreamBody.get("size")||"720x1280"),
      };
    }else{
      const input=JSON.parse(await request.text()) as Record<string,unknown>;
      const normalizedSeconds=number(input.seconds??input.n_seconds)||4;
      const normalizedSize=typeof input.size==="string"?input.size:(number(input.width)&&number(input.height)?`${number(input.width)}x${number(input.height)}`:"720x1280");
      body={...input,seconds:normalizedSeconds,size:normalizedSize};
      upstreamBody=new FormData();
      for(const field of ["model","prompt","seconds","size"] as const)if(body[field]!==undefined)upstreamBody.set(field,String(body[field]));
    }
    deployment=typeof body.model==="string"?body.model.trim():"";
    const seconds=number(body.seconds)||4,variants=1;
    if(!deployment)throw new HttpError(422,"The video deployment must be supplied in the model field.");
    if(![4,8,12].includes(seconds))throw new HttpError(422,"Sora 2 video duration must be 4, 8, or 12 seconds.");
    reservation=await reserve(subscription,deployment,operation,body);
    const upstream=await fetch(upstreamUrl(operation,deployment),{method:"POST",headers:await authorizedHeaders(context),body:upstreamBody,signal:AbortSignal.timeout(120_000)});
    const payload=parseJsonText(await upstream.text());
    const jobId=typeof payload.id==="string"?payload.id:"";
    if(upstream.ok&&!jobId)throw new HttpError(502,"Foundry accepted the video request without returning a video ID.","VIDEO_JOB_ID_MISSING");
    const subscriptionId=subscription.id,userId=subscription.user_id;
    if(upstream.ok)await transaction(async client=>{
      await client.query(`INSERT INTO api_video_jobs(job_id,subscription_id,user_id,deployment,duration_seconds,variants,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_id) DO NOTHING`,[jobId,subscriptionId,userId,deployment,seconds,variants,typeof payload.status==="string"?payload.status:"queued"]);
      await client.query(`INSERT INTO api_video_generations(generation_id,job_id,subscription_id) VALUES($1,$1,$2) ON CONFLICT(generation_id) DO NOTHING`,[jobId,subscriptionId]);
    });
    const charge=subscription.quota_unit==="seconds"?seconds:subscription.quota_unit==="minutes"?Math.max(1,Math.ceil(seconds/60)):1;
    const result=await finalize({subscription,reservationId:reservation.id,operation,deployment,requestId:context.invocationId,status:upstream.status,latency:Date.now()-started,upstreamRequestId:upstream.headers.get("x-request-id")||upstream.headers.get("apim-request-id"),payload,ok:upstream.ok,chargeOverride:charge,extraDetails:{durationSeconds:seconds,variants}});
    return {status:upstream.status,jsonBody:payload,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-academy-usage-charged":String(result.charged),"x-academy-usage-remaining":String(result.remaining),"x-academy-request-id":context.invocationId}};
  }catch(error){
    if(subscription&&reservation)await query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[reservation.id,subscription.id]).catch(()=>{});
    if(subscription)await recordFailure({subscription,requestId:context.invocationId,deployment,operation,status:error instanceof HttpError?error.status:502,latency:Date.now()-started,code:error instanceof HttpError?error.code:"UPSTREAM_FAILURE"}).catch(()=>{});
    return errorResponse(error,context.invocationId);
  }
}

async function getVideoJob(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  try{
    const subscription=await subscriptionFor(request);
    const jobId=request.params.id;
    if(!jobId)throw new HttpError(400,"A video job ID is required.");
    const found=await query<{deployment:string}>(`SELECT deployment FROM api_video_jobs WHERE job_id=$1 AND subscription_id=$2`,[jobId,subscription.id]);
    if(!found.rowCount)throw new HttpError(404,"Video job not found.");
    const upstream=await fetch(`${endpoint()}/openai/v1/videos/${encodeURIComponent(jobId)}`,{headers:await authorizedHeaders(context),signal:AbortSignal.timeout(120_000)});
    const payload=parseJsonText(await upstream.text());
    if(upstream.ok){
      await query(`UPDATE api_video_jobs SET status=$1,generations=$2::jsonb,updated_at=now() WHERE job_id=$3 AND subscription_id=$4`,[typeof payload.status==="string"?payload.status:"unknown",JSON.stringify([payload]),jobId,subscription.id]);
    }
    return {status:upstream.status,jsonBody:payload,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-academy-request-id":context.invocationId}};
  }catch(error){return errorResponse(error,context.invocationId);}
}

async function downloadVideo(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>{
  try{
    const subscription=await subscriptionFor(request);
    const generationId=request.params.id;
    if(!generationId)throw new HttpError(400,"A video generation ID is required.");
    const found=await query(`SELECT generation_id FROM api_video_generations WHERE generation_id=$1 AND subscription_id=$2`,[generationId,subscription.id]);
    if(!found.rowCount)throw new HttpError(404,"Video generation not found. Poll the job once after it succeeds before downloading.");
    const upstream=await fetch(`${endpoint()}/openai/v1/videos/${encodeURIComponent(generationId)}/content?variant=video`,{headers:{...(await authorizedHeaders(context)),accept:"application/binary"},signal:AbortSignal.timeout(600_000)});
    if(!upstream.ok)return {status:upstream.status,body:await upstream.arrayBuffer(),headers:{"content-type":upstream.headers.get("content-type")||"application/json","cache-control":"no-store"}};
    return {status:upstream.status,body:proxiedBody(upstream.body!),headers:{"content-type":upstream.headers.get("content-type")||"video/mp4","content-disposition":upstream.headers.get("content-disposition")||`attachment; filename="${generationId}.mp4"`,"cache-control":"private, no-store","x-academy-request-id":context.invocationId}};
  }catch(error){return errorResponse(error,context.invocationId);}
}

app.http("gatewayChatCompletions",{route:"v1/gateway/openai/v1/chat/completions",methods:["POST"],authLevel:"anonymous",handler:createJsonHandler("chat/completions")});
app.http("gatewayResponses",{route:"v1/gateway/openai/v1/responses",methods:["POST"],authLevel:"anonymous",handler:createJsonHandler("responses")});
app.http("gatewayEmbeddings",{route:"v1/gateway/openai/v1/embeddings",methods:["POST"],authLevel:"anonymous",handler:createJsonHandler("embeddings")});
app.http("gatewayImageGenerations",{route:"v1/gateway/openai/v1/images/generations",methods:["POST"],authLevel:"anonymous",handler:createJsonHandler("images/generations")});
app.http("gatewayAudioSpeech",{route:"v1/gateway/openai/v1/audio/speech",methods:["POST"],authLevel:"anonymous",handler:audioSpeech});
app.http("gatewayAudioTranscriptions",{route:"v1/gateway/openai/v1/audio/transcriptions",methods:["POST"],authLevel:"anonymous",handler:audioTranscription});
app.http("gatewayCreateVideoJob",{route:"v1/gateway/openai/v1/videos",methods:["POST"],authLevel:"anonymous",handler:createVideoJob});
app.http("gatewayGetVideoJob",{route:"v1/gateway/openai/v1/videos/{id}",methods:["GET"],authLevel:"anonymous",handler:getVideoJob});
app.http("gatewayDownloadVideo",{route:"v1/gateway/openai/v1/videos/{id}/content",methods:["GET"],authLevel:"anonymous",handler:downloadVideo});
