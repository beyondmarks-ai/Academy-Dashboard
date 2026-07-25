import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { getConfig } from "./config.js";

export async function foundryToken() {
  const config = getConfig();
  const credential = config.NODE_ENV === "production"
    ? new ManagedIdentityCredential({ clientId: config.AZURE_CLIENT_ID })
    : new AzureCliCredential();
  return (await credential.getToken("https://cognitiveservices.azure.com/.default")).token;
}
