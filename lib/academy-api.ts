import { getAccessToken } from "./azure-auth";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export type AcademyProfile = {
  id: string;
  email: string;
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

type ApiEnvelope<T> = { data: T; requestId: string };

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiBaseUrl) throw new Error("The Academy API URL is not configured.");
  const token = await getAccessToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
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

export async function completeOnboarding(input: { fullName: string; username: string; admissionId: string }) {
  return (await apiRequest<ApiEnvelope<AcademyProfile>>("/api/v1/me/onboarding", {
    method: "POST",
    body: JSON.stringify(input),
  })).data;
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
