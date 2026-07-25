import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const databaseUrl=process.env.DATABASE_URL;
const baseUrl=process.env.GATEWAY_BASE_URL;
if(!databaseUrl||!baseUrl)throw new Error("DATABASE_URL and GATEWAY_BASE_URL are required.");

const pool=new pg.Pool({connectionString:databaseUrl,ssl:{rejectUnauthorized:true},max:1});
const subscriptions=[];

async function temporaryAccess(userId,allowedDeployments,quotaLimit,quotaUnit){
  const academyKey=`bm_live_${randomBytes(28).toString("base64url")}`;
  const credentialHash=createHash("sha256").update(academyKey,"utf8").digest("hex");
  const inserted=await pool.query(`
    INSERT INTO api_subscriptions(user_id,provider,product_name,key_last_four,credential_hash,
      credential_kind,allowed_deployments,quota_limit,quota_unit,expires_at,status)
    VALUES($1,'Azure AI Foundry','Multimodal smoke test',upper(right($2,4)),$3,
      'academy_gateway',$4::jsonb,$5,$6,now()+interval '1 hour','active')
    RETURNING id
  `,[userId,academyKey,credentialHash,JSON.stringify(allowedDeployments),quotaLimit,quotaUnit]);
  subscriptions.push(inserted.rows[0].id);
  return {id:inserted.rows[0].id,key:academyKey};
}

function headers(key,json=true){
  return {authorization:`Bearer ${key}`,...(json?{"content-type":"application/json"}:{})};
}
async function checked(response,label){
  if(response.ok)return response;
  throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
}

try{
  const administrator=await pool.query(`SELECT id FROM user_profiles WHERE role='admin' AND status='active' LIMIT 1`);
  if(!administrator.rows[0])throw new Error("An active administrator profile is required.");
  const tokenAccess=await temporaryAccess(administrator.rows[0].id,["gpt-5.6-sol"],20_000,"tokens");
  const requestAccess=await temporaryAccess(administrator.rows[0].id,[
    "text-embedding-3-small","gpt-4o-mini-tts","gpt-4o-mini-transcribe","sora-2",
  ],10,"requests");

  const streamed=await checked(await fetch(`${baseUrl}/responses`,{
    method:"POST",headers:headers(tokenAccess.key),
    body:JSON.stringify({model:"gpt-5.6-sol",input:"Reply with exactly: Beyond Marks ready",max_output_tokens:80,stream:true}),
  }),"Streamed Responses");
  const sse=await streamed.text();
  if(!sse.includes("response.completed"))throw new Error("Responses stream did not contain response.completed.");

  const embedding=await checked(await fetch(`${baseUrl}/embeddings`,{
    method:"POST",headers:headers(requestAccess.key),
    body:JSON.stringify({model:"text-embedding-3-small",input:"Beyond Marks Academy"}),
  }),"Embeddings");
  const embeddingPayload=await embedding.json();
  if(!Array.isArray(embeddingPayload.data)||!embeddingPayload.data.length)throw new Error("Embedding vector was not returned.");

  const speech=await checked(await fetch(`${baseUrl}/audio/speech`,{
    method:"POST",headers:headers(requestAccess.key),
    body:JSON.stringify({model:"gpt-4o-mini-tts",input:"Beyond Marks Academy gateway test.",voice:"alloy",response_format:"wav"}),
  }),"Speech");
  const speechBytes=await speech.arrayBuffer();
  if(speechBytes.byteLength<100)throw new Error("Speech response was unexpectedly empty.");

  const transcriptionForm=new FormData();
  transcriptionForm.set("model","gpt-4o-mini-transcribe");
  transcriptionForm.set("file",new Blob([speechBytes],{type:"audio/wav"}),"academy-test.wav");
  const transcription=await checked(await fetch(`${baseUrl}/audio/transcriptions`,{
    method:"POST",headers:headers(requestAccess.key,false),body:transcriptionForm,
  }),"Transcription");
  const transcriptionPayload=await transcription.json();
  if(typeof transcriptionPayload.text!=="string"||!transcriptionPayload.text.trim())throw new Error("Transcription text was not returned.");

  const video=await checked(await fetch(`${baseUrl}/videos`,{
    method:"POST",headers:headers(requestAccess.key),
    body:JSON.stringify({model:"sora-2",prompt:"A simple abstract golden ring slowly rotating on a plain dark navy background, no text, no people.",size:"720x1280",seconds:4}),
  }),"Video creation");
  let videoPayload=await video.json();
  if(typeof videoPayload.id!=="string")throw new Error("Video job ID was not returned.");
  const videoJobId=videoPayload.id;
  const deadline=Date.now()+300_000;
  while(!["completed","failed","cancelled"].includes(videoPayload.status)&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,5_000));
    const status=await checked(await fetch(`${baseUrl}/videos/${encodeURIComponent(videoJobId)}`,{headers:headers(requestAccess.key,false)}),"Video status");
    videoPayload=await status.json();
  }
  if(videoPayload.status!=="completed")throw new Error(`Video job ended with status ${videoPayload.status||"timeout"}.`);
  const download=await checked(await fetch(`${baseUrl}/videos/${encodeURIComponent(videoJobId)}/content`,{headers:headers(requestAccess.key,false)}),"Video download");
  const videoBytes=await download.arrayBuffer();
  if(videoBytes.byteLength<1000)throw new Error("Downloaded video was unexpectedly empty.");

  const tokenLedger=await pool.query(`SELECT units_charged,total_tokens,status_code FROM api_usage_events WHERE subscription_id=$1`,[tokenAccess.id]);
  if(tokenLedger.rowCount!==1||Number(tokenLedger.rows[0].units_charged)<=0||Number(tokenLedger.rows[0].units_charged)!==Number(tokenLedger.rows[0].total_tokens)||tokenLedger.rows[0].status_code!==200){
    throw new Error("Streamed token usage was not charged exactly.");
  }
  const requestLedger=await pool.query(`SELECT operation,units_charged,status_code FROM api_usage_events WHERE subscription_id=$1 ORDER BY created_at`,[requestAccess.id]);
  if(requestLedger.rowCount!==4||requestLedger.rows.some(row=>Number(row.units_charged)!==1||row.status_code!==200)){
    throw new Error("Multimodal request ledger was not charged exactly once per inference.");
  }
  const reservations=await pool.query(`SELECT count(*)::int count FROM api_gateway_reservations WHERE subscription_id=ANY($1::uuid[])`,[subscriptions]);
  if(reservations.rows[0].count!==0)throw new Error("Gateway reservations were not released.");

  console.log(JSON.stringify({
    passed:true,
    responses:{streamed:true,exactTokens:Number(tokenLedger.rows[0].total_tokens)},
    embeddings:true,speechBytes:speechBytes.byteLength,transcription:true,
    video:{status:videoPayload.status,bytes:videoBytes.byteLength},
    ledgerEvents:tokenLedger.rowCount+requestLedger.rowCount,
  }));
}finally{
  for(const subscriptionId of subscriptions)await pool.query(`DELETE FROM api_subscriptions WHERE id=$1`,[subscriptionId]);
  await pool.end();
}
