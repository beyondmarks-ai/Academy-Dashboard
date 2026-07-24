import { QueueClient } from "@azure/storage-queue";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { getConfig } from "./config.js";

export async function enqueueCertificate(certificateId: string) {
  const c=getConfig();
  if(!c.AZURE_STORAGE_ACCOUNT_URL) throw new Error("Azure Storage is not configured.");
  const credential=c.NODE_ENV==="production"?new ManagedIdentityCredential({clientId:c.AZURE_CLIENT_ID}):new AzureCliCredential();
  const queue=new QueueClient(`${c.AZURE_STORAGE_ACCOUNT_URL}/${c.CERTIFICATE_QUEUE}`,credential);
  await queue.createIfNotExists();
  await queue.sendMessage(Buffer.from(JSON.stringify({certificateId})).toString("base64"));
}
