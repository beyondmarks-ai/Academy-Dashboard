import { QueueClient } from "@azure/storage-queue";
import { AzureCliCredential,ManagedIdentityCredential } from "@azure/identity";
import { getConfig } from "./config.js";

let queueClient:QueueClient|undefined;

function client(){
  if(queueClient)return queueClient;
  const config=getConfig();
  if(config.AZURE_STORAGE_CONNECTION_STRING){
    queueClient=new QueueClient(config.AZURE_STORAGE_CONNECTION_STRING,config.SERVICE_PROVISIONING_QUEUE);
    return queueClient;
  }
  if(!config.AZURE_STORAGE_ACCOUNT_URL)throw new Error("Azure Storage is not configured.");
  const queueUrl=config.AZURE_STORAGE_ACCOUNT_URL.replace(".blob.",".queue.").replace(/\/$/,"");
  const credential=config.NODE_ENV==="production"
    ?new ManagedIdentityCredential({clientId:config.AZURE_CLIENT_ID})
    :new AzureCliCredential();
  queueClient=new QueueClient(`${queueUrl}/${config.SERVICE_PROVISIONING_QUEUE}`,credential);
  return queueClient;
}

export async function enqueueServiceProvisioning(jobId:string){
  const queue=client();
  await queue.createIfNotExists();
  await queue.sendMessage(Buffer.from(JSON.stringify({jobId}),"utf8").toString("base64"));
}
