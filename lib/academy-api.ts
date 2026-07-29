export type AcademyProfile = {
  id: string;
  academy_id: string;
  email: string | null;
  username: string;
  full_name: string;
  admission_id: string | null;
  role: "student" | "admin" | "developer";
  status: "active" | "suspended" | "pending";
};

export type AcademyNotification = {
  id: string;
  title: string;
  message: string;
  category: string;
  priority: "normal" | "important" | "urgent";
  created_at: string;
  unread: boolean;
};

export type AcademyProject = {
  id: string;
  name: string;
  description: string;
  status: "working" | "finished";
  github_url: string | null;
  created_at: string;
  updated_at: string;
  readme?: string;
};

export type AcademySubscription = {
  id: string;
  provider: string;
  product_name: string;
  key_last_four: string | null;
  quota_limit: number | null;
  quota_unit: "requests" | "tokens" | "images" | "minutes" | "seconds";
  usage_count: number;
  expires_at: string | null;
  credential_available: boolean;
  credential_kind: "legacy_provider" | "academy_gateway";
  allowed_deployments: string[];
  status: "active" | "revoked" | "expired";
  created_at: string;
  rotated_at: string | null;
};
export type AcademyCredential = {
  id:string;key_last_four:string;status:"active"|"revoked";credential_available:boolean;
  revealed_at:string|null;reveal_count:number;rotated_at:string|null;created_at:string;
};

export type AcademyApiAccessRequest = {
  id:string;
  capabilities:string[];
  requested_deployments:string[];
  project_name:string;
  intended_use:string;
  estimated_usage:"starter"|"standard"|"advanced"|"custom";
  other_requirements:string;
  status:"pending"|"approved"|"rejected"|"revoked";
  review_notes:string;
  reviewed_at:string|null;
  created_at:string;
  updated_at:string;
};

export type AzureServiceType = "blob_storage"|"container_compute"|"machine_learning"|"database"|"functions"|"document_intelligence"|"speech_vision"|"messaging"|"monitoring";
export type AzureQuotaUnit = "bytes"|"compute_minutes"|"gpu_minutes"|"database_mb"|"executions"|"requests"|"pages"|"minutes"|"messages"|"events"|"log_mb";
export type ServiceAccessRequest = {
  id:string;service_type:AzureServiceType;project_name:string;plan_code:"explore"|"build"|"scale"|"custom";
  requested_quota:number;requested_unit:AzureQuotaUnit;use_case:string;configuration:Record<string,unknown>;
  status:"pending"|"approved"|"rejected"|"cancelled";review_notes:string;reviewed_at:string|null;created_at:string;updated_at:string;
};
export type ServiceEntitlement = {
  id:string;request_id:string;service_type:AzureServiceType;display_name:string;quota_limit:number;quota_unit:AzureQuotaUnit;
  usage_count:number;status:"provisioning"|"active"|"failed"|"suspended"|"revoked"|"expired";resource_config:Record<string,unknown>;expires_at:string|null;created_at:string;updated_at:string;
};
export type ServiceUsageEvent = {id:string;entitlement_id:string;service_type:AzureServiceType;operation:string;quantity:number;quota_unit:AzureQuotaUnit;status:"succeeded"|"failed"|"blocked";resource_id:string|null;metadata:Record<string,unknown>;occurred_at:string};
export type ServiceQuotaAllocation = {id:string;entitlement_id:string;service_type:AzureServiceType;action:"initial"|"top_up"|"reset"|"renew";amount:number;quota_unit:AzureQuotaUnit;previous_limit:number|null;previous_usage:number;expires_at:string|null;notes:string;created_at:string};
export type ServiceAccessOverview = {requests:ServiceAccessRequest[];entitlements:ServiceEntitlement[];ledger:{events:ServiceUsageEvent[];allocations:ServiceQuotaAllocation[]}};

export type AdminStudent = {
  id: string;
  academy_id: string;
  username: string;
  full_name: string;
  admission_id: string | null;
  role: "student" | "developer";
  status: "active" | "suspended" | "pending";
  created_at: string;
  last_seen_at: string | null;
};

export type AdminInvitation = {
  id: string;
  admission_id: string;
  allowed_academy_id: string | null;
  assigned_role: "student" | "developer" | "admin";
  expires_at: string | null;
  created_at: string;
  claimed_at: string | null;
  claimed_by_academy_id: string | null;
};
export type AdminAdmission = Omit<AdminStudent,"status"> & { status:"active"|"suspended"|"pending"|"rejected"; admission_number: string | null; rejection_reason: string | null; reviewed_at: string | null };
export type AdminCourse = { id:string; code:string; title:string; description:string; duration:string; status:"draft"|"active"|"archived"; enrollment_count:number; completion_count:number };
export type AdminEnrollment = { id:string; course_id:string; student_id:string; progress:number; status:"enrolled"|"in_progress"|"completed"|"withdrawn"; notes:string; course_code?:string; course_title?:string; title?:string; student_name?:string; academy_id?:string; admission_number:string|null; completed_at:string|null };
export type AcademyCertificate = { id:string; verification_number:string; course_title:string; completion_date:string; issued_at:string|null; status:"draft"|"generating"|"validation_failed"|"issued"|"revoked" };
export type AdminCampaign = { id:string; title:string; message:string; category:string; priority:string; publish_at:string; expires_at:string|null; recipient_count:number; read_count:number };
export type AdminApiRequest = {
  id:string;
  user_id:string;
  capabilities:string[];
  other_requirements:string;
  status:"pending"|"approved"|"rejected"|"revoked";
  review_notes:string;
  reviewed_at:string|null;
  created_at:string;
  updated_at:string;
  full_name:string;
  academy_id:string;
  admission_id:string|null;
  admission_number:string|null;
  provider:string|null;
  product_name:string|null;
  key_last_four:string|null;
  subscription_status:"active"|"revoked"|"expired"|null;
  subscription_id:string|null;
  quota_limit:number|null;
  quota_unit:"requests"|"tokens"|"images"|"minutes"|"seconds"|null;
  usage_count:number|null;
  expires_at:string|null;
  credential_kind:"legacy_provider"|"academy_gateway"|null;
  allowed_deployments:string[];
  requested_deployments:string[];
  project_name:string;
  intended_use:string;
  estimated_usage:string;
};
export type AdminServiceRequest = ServiceAccessRequest & {
  user_id:string;full_name:string;academy_id:string;admission_number:string|null;
  entitlement_id:string|null;display_name:string|null;quota_limit:number|null;quota_unit:AzureQuotaUnit|null;
  usage_count:number|null;entitlement_status:ServiceEntitlement["status"]|null;resource_config:Record<string,unknown>|null;expires_at:string|null;
};
export type ApiUsageEvent={request_id:string;deployment:string;operation:string;quota_unit:"requests"|"tokens"|"images"|"minutes"|"seconds";units_charged:number;input_tokens:number;output_tokens:number;total_tokens:number;status_code:number;latency_ms:number;created_at:string};
export type ApiUsageTotals={request_count:number;charged_units:number;input_tokens:number;output_tokens:number;total_tokens:number};
export type ApiUsageDetails={events:ApiUsageEvent[];totals:ApiUsageTotals;subscription?:{quota_limit:number;quota_unit:string;usage_count:number;remaining:number;status:string;expires_at:string|null};allocations?:Array<{id:string;action:string;amount:number;quota_unit:string;previous_limit:number|null;previous_usage:number;expires_at:string|null;notes:string;created_at:string}>};

type ApiEnvelope<T> = { data: T; requestId: string };

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const proxyPath = path.replace(/^\/api\//, "/api/academy/");
  const response = await fetch(proxyPath, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Academy API request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getProfile() {
  return (await apiRequest<ApiEnvelope<AcademyProfile>>("/api/v1/me")).data;
}

export async function getNotifications() {
  return apiRequest<ApiEnvelope<AcademyNotification[]> & { unreadCount: number }>("/api/v1/notifications");
}

export async function markNotificationRead(id: string) {
  await apiRequest<void>(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead() {
  await apiRequest<void>("/api/v1/notifications/read-all", { method: "POST" });
}

export async function getProjects(status?: "working" | "finished") {
  const query = status ? `?status=${status}` : "";
  return (await apiRequest<ApiEnvelope<AcademyProject[]>>(`/api/v1/projects${query}`)).data;
}

export async function getProject(id: string) {
  return (await apiRequest<ApiEnvelope<AcademyProject>>(`/api/v1/projects/${id}`)).data;
}

export async function createProject(input: {
  name: string;
  description: string;
  status: "working" | "finished";
  githubUrl: string;
  readme: string;
}) {
  return (await apiRequest<ApiEnvelope<AcademyProject>>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(input),
  })).data;
}

export async function getApiAccess() {
  return (await apiRequest<ApiEnvelope<{ requests: AcademyApiAccessRequest[]; subscriptions: AcademySubscription[]; credential:AcademyCredential|null; gatewayBaseUrl:string;serviceGatewayBaseUrl:string }>>("/api/v1/api-access")).data;
}

export async function revealAcademyCredential(){
  return(await apiRequest<ApiEnvelope<{apiKey:string}>>("/api/v1/academy-credential/reveal",{method:"POST"})).data.apiKey;
}
export async function rotateAcademyCredential(){
  return(await apiRequest<ApiEnvelope<{apiKey:string;keyLastFour:string;rotatedAt:string}>>("/api/v1/academy-credential/rotate",{method:"POST",body:"{}"})).data;
}

export async function requestApiAccess(input:{capabilities:string[];deployments:string[];projectName:string;intendedUse:string;estimatedUsage:"starter"|"standard"|"advanced"|"custom";otherRequirements:string}) {
  return (await apiRequest<ApiEnvelope<AcademyApiAccessRequest>>("/api/v1/api-access/requests", {
    method: "POST",
    body: JSON.stringify(input),
  })).data;
}

export async function revealApiCredential(id: string) {
  return (await apiRequest<ApiEnvelope<{ apiKey: string }>>(`/api/v1/api-access/subscriptions/${id}/credential`, {
    method: "POST",
  })).data.apiKey;
}
export async function getApiUsage(id:string){return(await apiRequest<ApiEnvelope<ApiUsageDetails>>(`/api/v1/api-access/subscriptions/${id}/usage`)).data;}
export async function getServiceAccess(){return(await apiRequest<ApiEnvelope<ServiceAccessOverview>>("/api/v1/service-access")).data;}
export async function requestServiceAccess(input:{serviceType:AzureServiceType;projectName:string;planCode:"explore"|"build"|"scale";requestedQuota:number;requestedUnit:AzureQuotaUnit;useCase:string;configuration:Record<string,unknown>}){return(await apiRequest<ApiEnvelope<ServiceAccessRequest>>("/api/v1/service-access/requests",{method:"POST",body:JSON.stringify(input)})).data;}

export async function adminGetStudents(search = "") {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return (await apiRequest<ApiEnvelope<AdminStudent[]>>(`/api/v1/admin/students${query}`)).data;
}

export async function adminGetInvitations() {
  return (await apiRequest<ApiEnvelope<AdminInvitation[]>>("/api/v1/admin/invitations")).data;
}

export async function adminCreateInvitation(input: {
  admissionId: string;
  allowedAcademyId: string;
  role: "student" | "developer";
  expiresAt: string;
}) {
  return (await apiRequest<ApiEnvelope<AdminInvitation>>("/api/v1/admin/invitations", {
    method: "POST",
    body: JSON.stringify(input),
  })).data;
}

export async function adminSetStudentStatus(id: string, status: "active" | "suspended") {
  return (await apiRequest<ApiEnvelope<AdminStudent>>(`/api/v1/admin/students/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  })).data;
}

export async function adminResetStudentPassword(id: string, password: string) {
  await apiRequest<void>(`/api/v1/admin/students/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function adminGetAdmissions(){return(await apiRequest<ApiEnvelope<AdminAdmission[]>>("/api/v1/admin/admissions")).data;}
export async function adminReviewAdmission(id:string,input:{decision:"approve";admissionNumber:string}|{decision:"reject";reason:string}|{decision:"reopen"}){return(await apiRequest<ApiEnvelope<AdminAdmission>>(`/api/v1/admin/admissions/${id}/review`,{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminGetCourses(){return(await apiRequest<ApiEnvelope<AdminCourse[]>>("/api/v1/admin/courses")).data;}
export async function adminCreateCourse(input:{code:string;title:string;description:string;duration:string;status:string}){return(await apiRequest<ApiEnvelope<AdminCourse>>("/api/v1/admin/courses",{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminGetEnrollments(){return(await apiRequest<ApiEnvelope<AdminEnrollment[]>>("/api/v1/admin/enrollments")).data;}
export async function adminEnrollStudents(courseId:string,studentIds:string[]){return(await apiRequest<ApiEnvelope<AdminEnrollment[]>>(`/api/v1/admin/courses/${courseId}/enrollments`,{method:"POST",body:JSON.stringify({studentIds})})).data;}
export async function adminUpdateEnrollment(id:string,input:{progress:number;status:string;notes:string}){return(await apiRequest<ApiEnvelope<AdminEnrollment>>(`/api/v1/admin/enrollments/${id}`,{method:"PATCH",body:JSON.stringify(input)})).data;}
export async function adminGetCertificates(){return(await apiRequest<ApiEnvelope<AcademyCertificate[]>>("/api/v1/admin/certificates")).data;}
export async function adminGenerateCertificate(enrollmentId:string){return(await apiRequest<ApiEnvelope<AcademyCertificate>>(`/api/v1/admin/enrollments/${enrollmentId}/certificate`,{method:"POST",body:"{}"})).data;}
export async function adminUploadCertificateTemplate(input:{name:string;imageBase64:string;prompt:string}){return(await apiRequest<ApiEnvelope<unknown>>("/api/v1/admin/certificate-templates",{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminGetCampaigns(){return(await apiRequest<ApiEnvelope<AdminCampaign[]>>("/api/v1/admin/notifications")).data;}
export async function adminCreateCampaign(input:{title:string;message:string;category:string;priority:string;all:boolean;userIds:string[];publishAt?:string;expiresAt?:string}){return(await apiRequest<ApiEnvelope<AdminCampaign>>("/api/v1/admin/notifications",{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminGetApiRequests(){return(await apiRequest<ApiEnvelope<AdminApiRequest[]>>("/api/v1/admin/api-access/requests")).data;}
export async function adminReviewApiRequest(id:string,input:{decision:"approve";productName:string;allowedDeployments:string[];quotaLimit:number;quotaUnit:"requests"|"tokens"|"images"|"minutes"|"seconds";expiresAt:string;notes:string}|{decision:"reject";notes:string}){return(await apiRequest<ApiEnvelope<AdminApiRequest>>(`/api/v1/admin/api-access/requests/${id}/review`,{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminManageApiSubscription(id:string,input:{action:"topUp";amount:number;notes:string}|{action:"reset";notes:string}|{action:"renew";quotaLimit:number;quotaUnit:"requests"|"tokens"|"images"|"minutes"|"seconds";expiresAt:string;notes:string}|{action:"revoke";notes:string}){return(await apiRequest<ApiEnvelope<AdminApiRequest>>(`/api/v1/admin/api-access/subscriptions/${id}`,{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminGetApiUsage(id:string){return(await apiRequest<ApiEnvelope<ApiUsageDetails>>(`/api/v1/admin/api-access/subscriptions/${id}/usage`)).data;}
export async function adminGetServiceRequests(){return(await apiRequest<ApiEnvelope<AdminServiceRequest[]>>("/api/v1/admin/service-access/requests")).data;}
export async function adminReviewServiceRequest(id:string,input:{decision:"approve";displayName:string;quotaLimit:number;quotaUnit:AzureQuotaUnit;expiresAt:string;resourceConfig:Record<string,unknown>;notes:string}|{decision:"reject";notes:string}){return(await apiRequest<ApiEnvelope<AdminServiceRequest>>(`/api/v1/admin/service-access/requests/${id}/review`,{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminManageServiceEntitlement(id:string,input:{action:"topUp";amount:number;notes:string}|{action:"reset";notes:string}|{action:"renew";quotaLimit:number;expiresAt:string;notes:string}|{action:"suspend"|"activate"|"revoke";notes:string}){return(await apiRequest<ApiEnvelope<ServiceEntitlement>>(`/api/v1/admin/service-access/entitlements/${id}`,{method:"POST",body:JSON.stringify(input)})).data;}
export async function adminRetryServiceProvisioning(id:string){return(await apiRequest<ApiEnvelope<{jobId:string;status:string}>>(`/api/v1/admin/service-access/entitlements/${id}/provision`,{method:"POST",body:"{}"})).data;}
export async function getMyCourses(){return(await apiRequest<ApiEnvelope<AdminEnrollment[]>>("/api/v1/courses")).data;}
export async function getMyCertificates(){return(await apiRequest<ApiEnvelope<AcademyCertificate[]>>("/api/v1/certificates")).data;}
export async function verifyCertificate(number:string){return(await apiRequest<ApiEnvelope<AcademyCertificate>>(`/api/v1/certificates/verify/${encodeURIComponent(number)}`)).data;}
