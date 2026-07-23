import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";

const tenantId = process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "";
const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || "";
const apiScope = process.env.NEXT_PUBLIC_AZURE_API_SCOPE || "";

let client: PublicClientApplication | undefined;
let initialization: Promise<void> | undefined;

function assertConfigured() {
  if (!tenantId || !clientId || !apiScope) {
    throw new Error("Microsoft Entra authentication is not configured.");
  }
}

async function getClient() {
  assertConfigured();
  client ??= new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  initialization ??= client.initialize();
  await initialization;
  return client;
}

export async function signIn(loginHint?: string): Promise<AccountInfo> {
  const msal = await getClient();
  const result = await msal.loginPopup({
    scopes: [apiScope],
    loginHint: loginHint?.includes("@") ? loginHint : undefined,
    prompt: "select_account",
  });
  msal.setActiveAccount(result.account);
  return result.account;
}

export async function getAccessToken(): Promise<string> {
  const msal = await getClient();
  const account = msal.getActiveAccount() || msal.getAllAccounts()[0];
  if (!account) throw new Error("No signed-in Academy account was found.");

  try {
    return (await msal.acquireTokenSilent({ scopes: [apiScope], account })).accessToken;
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    return (await msal.acquireTokenPopup({ scopes: [apiScope], account })).accessToken;
  }
}

export async function signOut() {
  const msal = await getClient();
  const account = msal.getActiveAccount() || msal.getAllAccounts()[0];
  await msal.logoutPopup({ account });
}
