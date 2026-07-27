export type ModelCatalogItem = {
  deployment: string;
  name: string;
  category: "Code & reasoning" | "Chat" | "Images" | "Video" | "Audio" | "Embeddings";
  description: string;
  bestFor: string;
  api: string;
  meter: string;
  accent: string;
};

export const MODEL_CATALOG: ModelCatalogItem[] = [
  { deployment: "gpt-5.6-sol", name: "GPT-5.6 SOL", category: "Code & reasoning", description: "Frontier coding and agentic reasoning model for Codex workflows.", bestFor: "Repositories, debugging, advanced reasoning", api: "Responses / Chat", meter: "Tokens", accent: "SOL" },
  { deployment: "gpt-5.6-terra", name: "GPT-5.6 Terra", category: "Chat", description: "Balanced model for fast everyday assistants and learning applications.", bestFor: "Chat, tutoring, content and automation", api: "Responses / Chat", meter: "Tokens", accent: "TR" },
  { deployment: "text-embedding-3-small", name: "Text Embedding 3 Small", category: "Embeddings", description: "Efficient vector representations for semantic search and retrieval.", bestFor: "RAG, recommendations and similarity", api: "Embeddings", meter: "Tokens", accent: "EM" },
  { deployment: "gpt-image-2", name: "GPT Image 2", category: "Images", description: "High-quality image generation and professional visual editing.", bestFor: "Creative assets, diagrams and mockups", api: "Images", meter: "Images", accent: "IM" },
  { deployment: "sora-2", name: "Sora 2", category: "Video", description: "Cinematic video generation with synchronized audio capabilities.", bestFor: "Short films, explainers and product visuals", api: "Video jobs", meter: "Seconds", accent: "VI" },
  { deployment: "gpt-audio-1.5", name: "GPT Audio 1.5", category: "Audio", description: "Audio-aware conversations for natural voice experiences.", bestFor: "Voice assistants and audio understanding", api: "Chat", meter: "Tokens", accent: "AU" },
  { deployment: "gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe", category: "Audio", description: "Fast speech-to-text transcription for uploaded recordings.", bestFor: "Lectures, interviews and captions", api: "Transcriptions", meter: "Requests", accent: "ST" },
  { deployment: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", category: "Audio", description: "Natural text-to-speech generation for applications.", bestFor: "Narration, accessibility and voice UI", api: "Speech", meter: "Requests", accent: "TS" },
];

export type AzureServiceCatalogItem = {
  type: "blob_storage" | "container_compute" | "machine_learning" | "database" | "functions" | "document_intelligence" | "speech_vision" | "messaging" | "monitoring";
  name: string;
  shortName: string;
  description: string;
  unit: "bytes" | "compute_minutes" | "gpu_minutes" | "database_mb" | "executions" | "pages" | "minutes" | "messages" | "log_mb";
  plans: Array<{ code: "explore" | "build" | "scale"; name: string; quota: number; label: string }>;
  features: string[];
};

export const AZURE_SERVICE_CATALOG: AzureServiceCatalogItem[] = [
  { type: "blob_storage", name: "Blob Storage Workspace", shortName: "Storage", description: "Private project files, datasets and generated artifacts.", unit: "bytes", plans: [{ code: "explore", name: "Explore", quota: 536870912, label: "512 MB" }, { code: "build", name: "Build", quota: 2147483648, label: "2 GB" }, { code: "scale", name: "Scale", quota: 10737418240, label: "10 GB" }], features: ["Private student namespace", "Short-lived upload links", "Project artifact storage"] },
  { type: "container_compute", name: "Container Compute", shortName: "Compute", description: "Run isolated Python or Node.js workloads with automatic cleanup.", unit: "compute_minutes", plans: [{ code: "explore", name: "Explore", quota: 60, label: "60 CPU minutes" }, { code: "build", name: "Build", quota: 300, label: "300 CPU minutes" }, { code: "scale", name: "Scale", quota: 1200, label: "1,200 CPU minutes" }], features: ["Isolated executions", "Time and memory limits", "Logs and output artifacts"] },
  { type: "machine_learning", name: "Machine Learning Lab", shortName: "ML Lab", description: "Run approved training jobs and invoke Academy ML endpoints.", unit: "gpu_minutes", plans: [{ code: "explore", name: "Explore", quota: 15, label: "15 GPU minutes" }, { code: "build", name: "Build", quota: 60, label: "60 GPU minutes" }, { code: "scale", name: "Scale", quota: 240, label: "240 GPU minutes" }], features: ["Curated training environments", "Experiment tracking", "Model artifacts"] },
  { type: "database", name: "Project Database", shortName: "Database", description: "A managed data workspace for an Academy project.", unit: "database_mb", plans: [{ code: "explore", name: "Explore", quota: 100, label: "100 MB" }, { code: "build", name: "Build", quota: 500, label: "500 MB" }, { code: "scale", name: "Scale", quota: 2048, label: "2 GB" }], features: ["Project-scoped credentials", "Encrypted connections", "Automated expiry"] },
  { type: "functions", name: "Serverless Functions", shortName: "Functions", description: "Execute approved event-driven functions without managing servers.", unit: "executions", plans: [{ code: "explore", name: "Explore", quota: 1000, label: "1,000 executions" }, { code: "build", name: "Build", quota: 10000, label: "10,000 executions" }, { code: "scale", name: "Scale", quota: 50000, label: "50,000 executions" }], features: ["Approved templates", "Invocation metering", "Execution logs"] },
  { type: "document_intelligence", name: "Document Intelligence", shortName: "Documents", description: "Extract text and structured fields from documents.", unit: "pages", plans: [{ code: "explore", name: "Explore", quota: 100, label: "100 pages" }, { code: "build", name: "Build", quota: 1000, label: "1,000 pages" }, { code: "scale", name: "Scale", quota: 5000, label: "5,000 pages" }], features: ["OCR and layout", "Structured extraction", "Page-level ledger"] },
  { type: "speech_vision", name: "Speech & Vision Studio", shortName: "Speech/Vision", description: "Build transcription, speech and computer-vision projects.", unit: "minutes", plans: [{ code: "explore", name: "Explore", quota: 60, label: "60 minutes" }, { code: "build", name: "Build", quota: 300, label: "300 minutes" }, { code: "scale", name: "Scale", quota: 1200, label: "1,200 minutes" }], features: ["Speech processing", "Vision analysis", "Media usage ledger"] },
  { type: "messaging", name: "Messaging & Queues", shortName: "Messaging", description: "Reliable background messages for distributed projects.", unit: "messages", plans: [{ code: "explore", name: "Explore", quota: 10000, label: "10,000 messages" }, { code: "build", name: "Build", quota: 100000, label: "100,000 messages" }, { code: "scale", name: "Scale", quota: 1000000, label: "1 million messages" }], features: ["Project-specific queues", "Delivery tracking", "Message limits"] },
  { type: "monitoring", name: "Monitoring Workspace", shortName: "Monitoring", description: "Project logs, metrics and operational diagnostics.", unit: "log_mb", plans: [{ code: "explore", name: "Explore", quota: 100, label: "100 MB logs" }, { code: "build", name: "Build", quota: 500, label: "500 MB logs" }, { code: "scale", name: "Scale", quota: 2048, label: "2 GB logs" }], features: ["Filtered project telemetry", "Error diagnostics", "Usage trends"] },
];

export function formatServiceUnits(value: number, unit: string) {
  if (unit === "bytes") {
    const divisor = value >= 1073741824 ? 1073741824 : value >= 1048576 ? 1048576 : 1024;
    const suffix = divisor === 1073741824 ? "GB" : divisor === 1048576 ? "MB" : "KB";
    return `${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${suffix}`;
  }
  return `${value.toLocaleString()} ${unit.replaceAll("_", " ")}`;
}
