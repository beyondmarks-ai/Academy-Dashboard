type AuthProfile = {
  id: string;
  academy_id: string;
  username: string;
  full_name: string;
  admission_id: string | null;
  role: string;
  status: string;
};
export type MfaChallenge = {required:true;setupRequired:boolean;challengeToken:string};
export type AuthResult = AuthProfile | {profile:AuthProfile;mfa:MfaChallenge};

async function authRequest(action: "login" | "signup" | "logout" | "mfa-setup" | "mfa-verify", body: unknown = {}) {
  const response = await fetch(`/api/auth/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "Authentication could not be completed.");
  return payload.data as AuthResult;
}

export function loginWithAcademyId(academyId: string, password: string) {
  return authRequest("login", { academyId, password });
}

export function signupWithAcademyId(input: { fullName: string; academyId: string; admissionId: string; password: string }) {
  return authRequest("signup", input);
}

export function logoutAcademyAccount() {
  return authRequest("logout");
}

export async function beginAdminMfaSetup(challengeToken:string){
  return authRequest("mfa-setup",{challengeToken}) as unknown as Promise<{qrDataUrl:string;manualKey:string;academyId:string}>;
}
export async function verifyAdminMfa(challengeToken:string,code:string){
  return authRequest("mfa-verify",{challengeToken,code}) as unknown as Promise<{profile:AuthProfile;recoveryCodes?:string[]}>;
}
