import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "./db.js";
import { encryptApiCredential } from "./credentialCrypto.js";
import { hashOpaqueToken } from "./security.js";

export type AcademyCredential = {
  id:string;
  user_id:string;
  key_last_four:string;
  encrypted_api_key:string;
  credential_hash:string;
  status:"active"|"revoked";
};

export async function ensureAcademyCredential(client:PoolClient,userId:string):Promise<AcademyCredential>{
  const existing=await client.query<AcademyCredential>(`
    SELECT id,user_id,key_last_four,encrypted_api_key,credential_hash,status
    FROM academy_credentials WHERE user_id=$1 FOR UPDATE
  `,[userId]);
  if(existing.rows[0]){
    if(existing.rows[0].status==="revoked"){
      const restored=await client.query<AcademyCredential>(`
        UPDATE academy_credentials SET status='active',updated_at=now()
        WHERE id=$1 RETURNING id,user_id,key_last_four,encrypted_api_key,credential_hash,status
      `,[existing.rows[0].id]);
      return restored.rows[0]!;
    }
    return existing.rows[0];
  }

  const legacy=await client.query<{
    key_last_four:string;encrypted_api_key:string;credential_hash:string;status:string;
  }>(`
    SELECT key_last_four,encrypted_api_key,credential_hash,status
    FROM api_subscriptions
    WHERE user_id=$1 AND credential_kind='academy_gateway'
      AND encrypted_api_key IS NOT NULL AND credential_hash IS NOT NULL
    ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,created_at DESC
    LIMIT 1
  `,[userId]);
  const academyKey=legacy.rows[0]?null:`bm_live_${randomBytes(28).toString("base64url")}`;
  const source=legacy.rows[0]||{
    key_last_four:academyKey!.slice(-4).toUpperCase(),
    encrypted_api_key:encryptApiCredential(academyKey!),
    credential_hash:hashOpaqueToken(academyKey!),
    status:"active",
  };
  await client.query(`
    INSERT INTO academy_credentials(user_id,key_last_four,encrypted_api_key,credential_hash,status)
    VALUES($1,$2,$3,$4,'active') ON CONFLICT(user_id) DO NOTHING
  `,[userId,source.key_last_four,source.encrypted_api_key,source.credential_hash]);
  const created=await client.query<AcademyCredential>(`
    SELECT id,user_id,key_last_four,encrypted_api_key,credential_hash,status
    FROM academy_credentials WHERE user_id=$1
  `,[userId]);
  return created.rows[0]!;
}

export async function upsertCredentialScope(client:PoolClient,input:{
  credentialId:string;scopeType:"model"|"service";scopeKey:string;sourceId:string;
  status:"provisioning"|"active"|"suspended"|"revoked"|"expired"|"failed";expiresAt:string|null;
}){
  await client.query(`
    INSERT INTO academy_credential_scopes(credential_id,scope_type,scope_key,source_id,status,expires_at)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(credential_id,scope_type,scope_key,source_id)
    DO UPDATE SET status=excluded.status,expires_at=excluded.expires_at,updated_at=now()
  `,[input.credentialId,input.scopeType,input.scopeKey,input.sourceId,input.status,input.expiresAt]);
}

export type ResolvedAcademyCredential = {
  id:string;
  user_id:string;
  status:"active"|"revoked";
};

export async function resolveAcademyCredential(rawKey:string):Promise<ResolvedAcademyCredential|null>{
  const credentialHash=hashOpaqueToken(rawKey);
  const result=await query<ResolvedAcademyCredential>(`
    SELECT credential.id,credential.user_id,credential.status
    FROM academy_credentials credential
    WHERE credential.credential_hash=$1
    UNION ALL
    SELECT credential.id,credential.user_id,
      CASE WHEN alias.status='active' THEN credential.status ELSE 'revoked' END status
    FROM academy_credential_aliases alias
    JOIN academy_credentials credential ON credential.id=alias.credential_id
    WHERE alias.credential_hash=$1
    LIMIT 1
  `,[credentialHash]);
  return result.rows[0]||null;
}
