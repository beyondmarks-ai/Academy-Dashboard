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
