import type { InvocationContext } from "@azure/functions";
import { getConfig } from "./config.js";
import { query,transaction } from "./db.js";
import { ensureAcademyServiceContainer } from "./storage.js";

type ProvisioningRow={
  id:string;entitlement_id:string;operation:"provision"|"deprovision";status:string;
  user_id:string;service_type:string;display_name:string;resource_config:Record<string,unknown>;
  credential_id:string;
};

function safeConfiguration(serviceType:string,input:Record<string,unknown>,entitlementId:string,userId:string){
  const gatewayPath=`/api/v1/gateway/azure/v1/${serviceType}`;
  const base={
    provider:"Beyond Marks managed Azure",
    gatewayPath,
    namespace:`${userId}/${entitlementId}`,
    provisionedAt:new Date().toISOString(),
  };
  if(["container_compute","functions","machine_learning"].includes(serviceType)){
    const githubRepository=typeof input.githubRepository==="string"?input.githubRepository.trim():"";
    const containerImage=typeof input.containerImage==="string"?input.containerImage.trim():"";
    if(!githubRepository&&!containerImage)throw new Error("An administrator-approved GitHub repository or container image is required.");
    return {...base,source:{githubRepository:githubRepository||undefined,containerImage:containerImage||undefined}};
  }
  return base;
}

async function notifyProvisioned(client:import("pg").PoolClient,row:ProvisioningRow,success:boolean,message:string){
  const campaign=await client.query<{id:string}>(`
    INSERT INTO notification_campaigns(title,message,category,priority,created_by)
    SELECT $1,$2,'Azure services',$3,reviewed_by FROM service_access_requests
    WHERE id=(SELECT request_id FROM service_entitlements WHERE id=$4)
    RETURNING id
  `,[success?"Azure service is ready":"Azure service provisioning needs attention",message,success?"important":"urgent",row.entitlement_id]);
  if(campaign.rows[0])await client.query(`INSERT INTO notification_recipients(campaign_id,user_id) VALUES($1,$2)`,[campaign.rows[0].id,row.user_id]);
}

export async function processServiceProvisioning(jobId:string,context?:InvocationContext){
  const claimed=await transaction(async client=>{
    const result=await client.query<ProvisioningRow>(`
      SELECT job.id,job.entitlement_id,job.operation,job.status,
        entitlement.user_id,entitlement.service_type,entitlement.display_name,
        entitlement.resource_config,entitlement.credential_id
      FROM service_provisioning_jobs job
      JOIN service_entitlements entitlement ON entitlement.id=job.entitlement_id
      WHERE job.id=$1 FOR UPDATE
    `,[jobId]);
    const row=result.rows[0];
    if(!row||row.status==="succeeded")return null;
    await client.query(`UPDATE service_provisioning_jobs SET status='running',attempt_count=attempt_count+1,started_at=now(),updated_at=now(),error_code=NULL,error_message=NULL WHERE id=$1`,[jobId]);
    return row;
  });
  if(!claimed)return;
  try{
    if(claimed.operation==="deprovision"){
      await transaction(async client=>{
        await client.query(`UPDATE service_provisioning_jobs SET status='succeeded',completed_at=now(),updated_at=now() WHERE id=$1`,[jobId]);
        await client.query(`UPDATE academy_credential_scopes SET status='revoked',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[claimed.entitlement_id]);
      });
      return;
    }
    if(claimed.service_type==="blob_storage")await ensureAcademyServiceContainer();
    const requested=(claimed.resource_config?.requestedConfiguration&&typeof claimed.resource_config.requestedConfiguration==="object"
      ?claimed.resource_config.requestedConfiguration:{}) as Record<string,unknown>;
    const resourceConfig=safeConfiguration(claimed.service_type,requested,claimed.entitlement_id,claimed.user_id);
    await transaction(async client=>{
      await client.query(`UPDATE service_entitlements SET status='active',resource_config=$1::jsonb,updated_at=now() WHERE id=$2`,[JSON.stringify(resourceConfig),claimed.entitlement_id]);
      await client.query(`UPDATE academy_credential_scopes SET status='active',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[claimed.entitlement_id]);
      await client.query(`UPDATE service_provisioning_jobs SET status='succeeded',completed_at=now(),updated_at=now() WHERE id=$1`,[jobId]);
      await notifyProvisioned(client,claimed,true,`${claimed.display_name} is provisioned and ready. Use your existing Academy key with ${resourceConfig.gatewayPath}.`);
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Provisioning failed.";
    context?.error("Service provisioning failed",error);
    await transaction(async client=>{
      await client.query(`UPDATE service_entitlements SET status='failed',updated_at=now() WHERE id=$1`,[claimed.entitlement_id]);
      await client.query(`UPDATE academy_credential_scopes SET status='failed',updated_at=now() WHERE source_id=$1 AND scope_type='service'`,[claimed.entitlement_id]);
      await client.query(`UPDATE service_provisioning_jobs SET status='failed',error_code='PROVISIONING_FAILED',error_message=$1,completed_at=now(),updated_at=now() WHERE id=$2`,[message,jobId]);
      await notifyProvisioned(client,claimed,false,`${claimed.display_name} could not be provisioned. An administrator can retry it. Reference: ${jobId}.`);
    });
  }
}
