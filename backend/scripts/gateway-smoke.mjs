import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const databaseUrl=process.env.DATABASE_URL;
const gatewayUrl=process.env.GATEWAY_SMOKE_URL;
const model=process.env.GATEWAY_SMOKE_MODEL;
if(!databaseUrl||!gatewayUrl||!model)throw new Error("DATABASE_URL, GATEWAY_SMOKE_URL and GATEWAY_SMOKE_MODEL are required.");

const pool=new pg.Pool({connectionString:databaseUrl,ssl:{rejectUnauthorized:true},max:1});
const academyKey=`bm_live_${randomBytes(28).toString("base64url")}`;
const credentialHash=createHash("sha256").update(academyKey,"utf8").digest("hex");
let subscriptionId;
try{
  const administrator=await pool.query(`SELECT id FROM user_profiles WHERE role='admin' AND status='active' LIMIT 1`);
  if(!administrator.rows[0])throw new Error("An active administrator profile is required for the gateway smoke test.");
  const inserted=await pool.query(`
    INSERT INTO api_subscriptions(user_id,provider,product_name,key_last_four,credential_hash,
      credential_kind,allowed_deployments,quota_limit,quota_unit,expires_at,status)
    VALUES($1,'Azure AI Foundry','Gateway smoke test',upper(right($2,4)),$3,
      'academy_gateway',$4::jsonb,1,'images',now()+interval '1 hour','active')
    RETURNING id
  `,[administrator.rows[0].id,academyKey,credentialHash,JSON.stringify([model])]);
  subscriptionId=inserted.rows[0].id;
  const body={model,prompt:"A single small golden circle centered on a plain dark navy background, minimal test image.",n:1,quality:"low",size:"1024x1024",output_format:"png"};
  const responses=await Promise.all([1,2].map(()=>fetch(gatewayUrl,{method:"POST",headers:{"content-type":"application/json","x-academy-key":academyKey},body:JSON.stringify(body)})));
  const payloads=await Promise.all(responses.map(response=>response.json()));
  const successIndex=responses.findIndex(response=>response.ok);
  const blockedIndex=responses.findIndex(response=>response.status===403&&payloads[responses.indexOf(response)]?.error?.code==="QUOTA_EXHAUSTED");
  if(successIndex<0||blockedIndex<0||successIndex===blockedIndex)throw new Error(`Concurrent gateway calls did not produce exactly one success and one quota rejection (${responses.map(response=>response.status).join(",")}).`);
  const success=responses[successIndex];
  if(success.headers.get("x-academy-usage-charged")!=="1"||success.headers.get("x-academy-usage-remaining")!=="0")throw new Error("Gateway usage headers did not report exactly one charged image and zero remaining.");
  const finalLedger=await pool.query(`SELECT status_code,units_charged FROM api_usage_events WHERE subscription_id=$1 ORDER BY created_at`,[subscriptionId]);
  const chargedEvents=finalLedger.rows.filter(row=>row.status_code===200&&Number(row.units_charged)===1);
  const blockedEvents=finalLedger.rows.filter(row=>row.status_code===403&&Number(row.units_charged)===0);
  if(finalLedger.rowCount!==2||chargedEvents.length!==1||blockedEvents.length!==1)throw new Error("Concurrent gateway ledger did not contain exactly one charged success and one zero-charge rejection.");
  console.log(JSON.stringify({passed:true,concurrentCalls:2,successes:1,quotaRejections:1,chargedImages:1,remainingImages:0,ledgerEvents:2}));
}finally{
  if(subscriptionId)await pool.query(`DELETE FROM api_subscriptions WHERE id=$1`,[subscriptionId]);
  await pool.end();
}
