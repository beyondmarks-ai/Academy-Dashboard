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
