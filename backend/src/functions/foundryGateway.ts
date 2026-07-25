import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { query, transaction } from "../db.js";
import { foundryToken } from "../foundryAuth.js";
import { errorResponse, HttpError } from "../http.js";
import { hashOpaqueToken } from "../security.js";

type Operation = "chat/completions" | "responses" | "embeddings" | "images/generations";
type GatewaySubscription = {
  id:string; user_id:string; quota_limit:number|null; quota_unit:"requests"|"tokens"|"images"|"minutes";
  usage_count:number; status:string; expires_at:string|null; allowed_deployments:string[];
  academy_id:string; user_status:string;
};
type Usage = { inputTokens:number; outputTokens:number; totalTokens:number; details:Record<string,unknown> };

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
export function compatible(unit:GatewaySubscription["quota_unit"],operation:Operation){
  if(unit==="requests")return true;
  if(operation==="images/generations")return unit==="images";
  return unit==="tokens";
}
export function upperTokenBudget(body:Record<string,unknown>,operation:Operation){
  const output=number(body.max_completion_tokens??body.max_output_tokens??body.max_tokens);
  if(!output&&operation!=="embeddings")throw new HttpError(422,"Token-limited calls must include max_completion_tokens, max_output_tokens, or max_tokens.");
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
    const requested=item.quota_unit==="tokens"?upperTokenBudget(body,operation):item.quota_unit==="images"?Math.max(1,number(body.n)||1):1;
    if(requested>remaining)throw new HttpError(403,`Usage limit reached. ${remaining.toLocaleString()} ${item.quota_unit} remain, but this call can use up to ${requested.toLocaleString()}.`,"QUOTA_EXHAUSTED");
    const reservationId=randomUUID();
    await client.query(`INSERT INTO api_gateway_reservations(id,subscription_id,reserved_units,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')`,[reservationId,item.id,requested]);
    return {id:reservationId,unit:item.quota_unit,remainingBefore:remaining};
  });
}

function upstreamUrl(operation:Operation,deployment:string){
  const endpoint=getConfig().AZURE_FOUNDRY_ENDPOINT?.replace(/\/$/,"");
  if(!endpoint)throw new Error("Azure Foundry endpoint is not configured.");
  if(operation==="images/generations")return `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/images/generations?api-version=2025-04-01-preview`;
  return `${endpoint}/openai/v1/${operation}`;
}

async function finalize(input:{subscription:GatewaySubscription;reservationId:string;operation:Operation;deployment:string;requestId:string;status:number;latency:number;upstreamRequestId:string|null;payload:Record<string,unknown>;ok:boolean}){
  const measured=usageFrom(input.payload);
  const imageCount=Array.isArray(input.payload.data)?input.payload.data.length:0;
  const rawCharge=!input.ok?0:input.subscription.quota_unit==="tokens"?measured.totalTokens:input.subscription.quota_unit==="images"?imageCount:1;
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
    `,[input.subscription.id,input.subscription.user_id,input.requestId,input.deployment,input.operation,input.subscription.quota_unit,charged,measured.inputTokens,measured.outputTokens,measured.totalTokens,input.status,input.latency,input.upstreamRequestId,JSON.stringify({...measured.details,actualUnits:rawCharge,chargedUnits:charged})]);
    return {charged,remaining:Math.max(0,available-charged),measured};
  });
}

function createHandler(operation:Operation){
  return async(request:HttpRequest,context:InvocationContext):Promise<HttpResponseInit>=>{
    const started=Date.now();
    let reservation:{id:string;unit:GatewaySubscription["quota_unit"];remainingBefore:number}|undefined;
    let subscription:GatewaySubscription|undefined;
    let deployment="unknown";
    try{
      subscription=await subscriptionFor(request);
      const text=await request.text();
      if(Buffer.byteLength(text,"utf8")>2_000_000)throw new HttpError(413,"Gateway request exceeds 2 MB.");
      let body:Record<string,unknown>;
      try{body=JSON.parse(text) as Record<string,unknown>;}catch{throw new HttpError(400,"A valid JSON request body is required.");}
      if(body.stream===true)throw new HttpError(422,"Streaming is not enabled because exact usage metering requires a complete Foundry response.");
      deployment=typeof body.model==="string"?body.model.trim():"";
      if(!deployment)throw new HttpError(422,"The Foundry deployment must be supplied in the model field.");
      body={...body,user:subscription.academy_id};
      reservation=await reserve(subscription,deployment,operation,body);
      const upstream=await fetch(upstreamUrl(operation,deployment),{
        method:"POST",
        headers:{Authorization:`Bearer ${await foundryToken()}`,"content-type":"application/json","accept":"application/json","x-ms-client-request-id":context.invocationId},
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(operation==="images/generations"?300_000:120_000),
      });
      const raw=await upstream.text();
      let payload:Record<string,unknown>;
      try{payload=JSON.parse(raw) as Record<string,unknown>;}catch{payload={error:{message:"Foundry returned a non-JSON response."}};}
      const usageMissing=upstream.ok&&subscription.quota_unit==="tokens"&&!usageFrom(payload).totalTokens;
      const result=await finalize({subscription,reservationId:reservation.id,operation,deployment,requestId:context.invocationId,status:usageMissing?502:upstream.status,latency:Date.now()-started,upstreamRequestId:upstream.headers.get("x-request-id")||upstream.headers.get("apim-request-id"),payload,ok:upstream.ok&&!usageMissing});
      if(usageMissing)throw new HttpError(502,"Foundry did not return token usage, so the response could not be metered exactly.","USAGE_MISSING");
      return {status:upstream.status,jsonBody:payload,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-academy-quota-unit":subscription.quota_unit,"x-academy-usage-charged":String(result.charged),"x-academy-usage-remaining":String(result.remaining),"x-academy-request-id":context.invocationId}};
    }catch(error){
      if(subscription&&reservation){
        try{await query(`DELETE FROM api_gateway_reservations WHERE id=$1 AND subscription_id=$2`,[reservation.id,subscription.id]);}catch(cleanup){context.error("Gateway reservation cleanup failed",cleanup);}
      }
      if(subscription){
        try{
          await query(`
            INSERT INTO api_usage_events(subscription_id,user_id,request_id,deployment,operation,quota_unit,
              units_charged,status_code,latency_ms,usage_details)
            VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9::jsonb)
            ON CONFLICT(request_id) DO NOTHING
          `,[subscription.id,subscription.user_id,context.invocationId,deployment,operation,subscription.quota_unit,error instanceof HttpError?error.status:502,Date.now()-started,JSON.stringify({blocked:true,code:error instanceof HttpError?error.code:"UPSTREAM_FAILURE"})]);
        }catch(ledgerError){context.error("Gateway failure ledger write failed",ledgerError);}
      }
      context.error(`Foundry gateway ${operation} failed`,error);
      return errorResponse(error,context.invocationId);
    }
  };
}

app.http("gatewayChatCompletions",{route:"v1/gateway/openai/v1/chat/completions",methods:["POST"],authLevel:"anonymous",handler:createHandler("chat/completions")});
app.http("gatewayResponses",{route:"v1/gateway/openai/v1/responses",methods:["POST"],authLevel:"anonymous",handler:createHandler("responses")});
app.http("gatewayEmbeddings",{route:"v1/gateway/openai/v1/embeddings",methods:["POST"],authLevel:"anonymous",handler:createHandler("embeddings")});
app.http("gatewayImageGenerations",{route:"v1/gateway/openai/v1/images/generations",methods:["POST"],authLevel:"anonymous",handler:createHandler("images/generations")});
