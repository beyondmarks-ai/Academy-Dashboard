import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OTP } from "otplib";
import QRCode from "qrcode";
import type { HttpRequest } from "@azure/functions";
import { getConfig } from "./config.js";
import { query, transaction } from "./db.js";
import { HttpError } from "./http.js";
import { consumeRateLimit, createSession, hashOpaqueToken } from "./security.js";

const authenticator = new OTP({ strategy: "totp" });

function key() {
  const value = getConfig().MFA_ENCRYPTION_KEY;
  if (!value) throw new Error("MFA encryption is not configured.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("MFA encryption key must be 32 bytes.");
  return decoded;
}
function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(),iv),body=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(x=>x.toString("base64url")).join(".");}
function decrypt(value:string){const [iv,tag,body]=value.split(".");if(!iv||!tag||!body)throw new Error("Invalid MFA secret.");const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8");}
function recoveryHash(value:string){return createHash("sha256").update(`${value.toUpperCase()}:${key().toString("base64")}`).digest("hex");}

export async function createMfaChallenge(userId:string) {
  const existing=await query<{confirmed_at:string|null}>(`SELECT confirmed_at FROM admin_mfa WHERE user_id=$1`,[userId]);
  const purpose=existing.rows[0]?.confirmed_at?"login":"setup";
  const token=randomBytes(32).toString("base64url");
  await query(`DELETE FROM auth_mfa_challenges WHERE user_id=$1 OR expires_at<now()`,[userId]);
  await query(`INSERT INTO auth_mfa_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')`,[hashOpaqueToken(token),userId,purpose]);
  return {required:true,setupRequired:purpose==="setup",challengeToken:token};
}

async function challenge(token:string){
  const result=await query<{user_id:string;purpose:"setup"|"login";academy_id:string;full_name:string;username:string;admission_id:string|null;role:string;status:string}>(`
    SELECT c.user_id,c.purpose,p.academy_id,p.full_name,p.username,p.admission_id,p.role,p.status
    FROM auth_mfa_challenges c JOIN user_profiles p ON p.id=c.user_id
    WHERE c.token_hash=$1 AND c.consumed_at IS NULL AND c.expires_at>now() AND p.role='admin'
  `,[hashOpaqueToken(token)]);
  if(!result.rows[0])throw new HttpError(401,"MFA challenge is invalid or expired.","MFA_CHALLENGE_INVALID");
  return result.rows[0];
}

export async function beginMfaSetup(token:string){
  const item=await challenge(token);
  if(item.purpose!=="setup")throw new HttpError(409,"Authenticator is already configured.");
  let secretRow=await query<{encrypted_secret:string}>(`SELECT encrypted_secret FROM admin_mfa WHERE user_id=$1`,[item.user_id]);
  if(!secretRow.rows[0]){
    const secret=authenticator.generateSecret();
    await query(`INSERT INTO admin_mfa(user_id,encrypted_secret) VALUES($1,$2)`,[item.user_id,encrypt(secret)]);
    secretRow=await query(`SELECT encrypted_secret FROM admin_mfa WHERE user_id=$1`,[item.user_id]);
  }
  const secret=decrypt(secretRow.rows[0]!.encrypted_secret);
  const uri=authenticator.generateURI({label:item.academy_id,issuer:"Beyond Marks AI Academy",secret});
  return {qrDataUrl:await QRCode.toDataURL(uri,{width:260,margin:1}),manualKey:secret,academyId:item.academy_id};
}

export async function verifyMfa(token:string,code:string,request:HttpRequest){
  const item=await challenge(token);
  await consumeRateLimit(`mfa:${item.user_id}`,8,600);
  const mfa=await query<{encrypted_secret:string;confirmed_at:string|null;recovery_code_hashes:string[]}>(`SELECT encrypted_secret,confirmed_at,recovery_code_hashes FROM admin_mfa WHERE user_id=$1`,[item.user_id]);
  if(!mfa.rows[0])throw new HttpError(409,"Authenticator setup has not started.");
  const record=mfa.rows[0]!;
  const normalized=code.replace(/\s|-/g,"").toUpperCase();
  const totpValid=authenticator.verifySync({token:normalized,secret:decrypt(record.encrypted_secret),epochTolerance:30}).valid;
  const recoveryIndex=(record.recovery_code_hashes||[]).indexOf(recoveryHash(normalized));
  if(!totpValid&&recoveryIndex<0)throw new HttpError(401,"Authenticator or recovery code is incorrect.","MFA_CODE_INVALID");
  let recoveryCodes:string[]|undefined;
  await transaction(async client=>{
    if(item.purpose==="setup"){
      recoveryCodes=Array.from({length:8},()=>`${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`.toUpperCase());
      await client.query(`UPDATE admin_mfa SET confirmed_at=now(),recovery_code_hashes=$1,updated_at=now() WHERE user_id=$2`,[JSON.stringify(recoveryCodes.map(recoveryHash)),item.user_id]);
    }else if(recoveryIndex>=0){
      const remaining=[...record.recovery_code_hashes];remaining.splice(recoveryIndex,1);
      await client.query(`UPDATE admin_mfa SET recovery_code_hashes=$1,updated_at=now() WHERE user_id=$2`,[JSON.stringify(remaining),item.user_id]);
    }
    await client.query(`UPDATE auth_mfa_challenges SET consumed_at=now() WHERE token_hash=$1`,[hashOpaqueToken(token)]);
  });
  const session=await createSession(item.user_id,request);
  return {profile:{id:item.user_id,academy_id:item.academy_id,full_name:item.full_name,username:item.username,admission_id:item.admission_id,role:item.role,status:item.status},session,recoveryCodes};
}
