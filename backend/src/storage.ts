import { BlobServiceClient } from "@azure/storage-blob";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { getConfig } from "./config.js";

let serviceClient: BlobServiceClient | undefined;

function getBlobServiceClient() {
  if (serviceClient) return serviceClient;
  const config = getConfig();
  if (config.AZURE_STORAGE_CONNECTION_STRING) {
    serviceClient = BlobServiceClient.fromConnectionString(config.AZURE_STORAGE_CONNECTION_STRING);
    return serviceClient;
  }
  if (!config.AZURE_STORAGE_ACCOUNT_URL) throw new Error("Azure Storage is not configured.");
  const credential = config.NODE_ENV === "production"
    ? new ManagedIdentityCredential({ clientId: config.AZURE_CLIENT_ID })
    : new AzureCliCredential();
  serviceClient = new BlobServiceClient(config.AZURE_STORAGE_ACCOUNT_URL, credential);
  return serviceClient;
}

export async function ensureAcademyServiceContainer(){
  const container=getBlobServiceClient().getContainerClient(getConfig().ACADEMY_SERVICES_CONTAINER);
  await container.createIfNotExists();
  return container;
}

export async function uploadAcademyServiceBlob(blobName:string,data:Buffer,contentType:string){
  const container=await ensureAcademyServiceContainer();
  await container.getBlockBlobClient(blobName).uploadData(data,{blobHTTPHeaders:{blobContentType:contentType}});
}

export async function listAcademyServiceBlobs(prefix:string){
  const container=await ensureAcademyServiceContainer();
  const items:{name:string;size:number;contentType:string|null;updatedAt:Date|null}[]=[];
  for await(const blob of container.listBlobsFlat({prefix})){
    items.push({name:blob.name.slice(prefix.length),size:blob.properties.contentLength||0,contentType:blob.properties.contentType||null,updatedAt:blob.properties.lastModified||null});
  }
  return items;
}

export async function downloadAcademyServiceBlob(blobName:string){
  const container=await ensureAcademyServiceContainer();
  const blob=container.getBlobClient(blobName);
  const [response,properties]=await Promise.all([blob.download(),blob.getProperties()]);
  if(!response.readableStreamBody)return {data:Buffer.alloc(0),contentType:properties.contentType||"application/octet-stream"};
  const chunks:Buffer[]=[];
  for await(const chunk of response.readableStreamBody)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  return {data:Buffer.concat(chunks),contentType:properties.contentType||"application/octet-stream"};
}

export async function deleteAcademyServiceBlob(blobName:string){
  const container=await ensureAcademyServiceContainer();
  return container.deleteBlob(blobName,{deleteSnapshots:"include"});
}

export async function uploadReadme(ownerId: string, projectId: string, markdown: string) {
  const config = getConfig();
  const container = getBlobServiceClient().getContainerClient(config.PROJECT_FILES_CONTAINER);
  const blobName = `${ownerId}/${projectId}/README.md`;
  await container.getBlockBlobClient(blobName).upload(markdown, Buffer.byteLength(markdown), {
    blobHTTPHeaders: { blobContentType: "text/markdown; charset=utf-8" },
    metadata: { ownerId, projectId },
  });
  return blobName;
}

export async function downloadText(blobName: string) {
  const config = getConfig();
  const response = await getBlobServiceClient().getContainerClient(config.PROJECT_FILES_CONTAINER).getBlobClient(blobName).download();
  if (!response.readableStreamBody) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function uploadCertificateFile(blobName: string, data: Buffer, contentType: string) {
  const container = getBlobServiceClient().getContainerClient(getConfig().CERTIFICATE_FILES_CONTAINER);
  await container.createIfNotExists();
  await container.getBlockBlobClient(blobName).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  return blobName;
}

export async function downloadCertificateFile(blobName: string) {
  const response = await getBlobServiceClient().getContainerClient(getConfig().CERTIFICATE_FILES_CONTAINER).getBlobClient(blobName).downloadToBuffer();
  return response;
}
