import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AZURE_STORAGE_ACCOUNT_URL: z.string().url().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  PROJECT_FILES_CONTAINER: z.string().default("project-files"),
  CERTIFICATE_FILES_CONTAINER: z.string().default("certificate-files"),
  CERTIFICATE_QUEUE: z.string().default("certificate-generation"),
  AZURE_FOUNDRY_ENDPOINT: z.string().url().optional(),
  AZURE_FOUNDRY_IMAGE_DEPLOYMENT: z.string().default("gpt-image-1"),
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: z.string().url().optional(),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  MFA_ENCRYPTION_KEY: z.string().optional(),
  API_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  AUTH_DISABLED: z.enum(["true", "false"]).default("false"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
});

let cachedConfig: z.infer<typeof configSchema> | undefined;

export function getConfig() {
  cachedConfig ??= configSchema.parse(process.env);
  return cachedConfig;
}
