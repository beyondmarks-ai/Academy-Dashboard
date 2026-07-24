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
  status: "active" | "revoked" | "expired";
  created_at: string;
  rotated_at: string | null;
};

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
  return (await apiRequest<ApiEnvelope<{ requests: unknown[]; subscriptions: AcademySubscription[] }>>("/api/v1/api-access")).data;
}

export async function requestApiAccess(capabilities: string[], otherRequirements: string) {
  return (await apiRequest<ApiEnvelope<unknown>>("/api/v1/api-access/requests", {
    method: "POST",
    body: JSON.stringify({ capabilities, otherRequirements }),
  })).data;
}

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
export async function getMyCourses(){return(await apiRequest<ApiEnvelope<AdminEnrollment[]>>("/api/v1/courses")).data;}
export async function getMyCertificates(){return(await apiRequest<ApiEnvelope<AcademyCertificate[]>>("/api/v1/certificates")).data;}
export async function verifyCertificate(number:string){return(await apiRequest<ApiEnvelope<AcademyCertificate>>(`/api/v1/certificates/verify/${encodeURIComponent(number)}`)).data;}
