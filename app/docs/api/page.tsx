"use client";

import { useState } from "react";

const BASE_URL = "https://bm-academy-dev-api-ydjvvkil.azurewebsites.net/api/v1/gateway/openai/v1";

const codexConfig = `model = "gpt-5.6-sol"
model_provider = "beyondmarks"
model_reasoning_effort = "medium"

[model_providers.beyondmarks]
name = "Beyond Marks AI Academy"
base_url = "${BASE_URL}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"`;

const responseExample = `curl -N "${BASE_URL}/responses" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.6-sol",
    "input": "Create a TypeScript study plan.",
    "stream": true
  }'`;

const sdkExample = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const response = await client.responses.create({
  model: "gpt-5.6-sol",
  input: "Explain this repository and suggest the next task.",
});

console.log(response.output_text);`;

const videoExample = `const baseURL = "${BASE_URL}";
const headers = {
  Authorization: \`Bearer \${process.env.OPENAI_API_KEY}\`,
  "Content-Type": "application/json",
};

const video = await fetch(\`\${baseURL}/videos\`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: "sora-2",
    prompt: "A cinematic gold compass floating above a navy ocean",
    size: "1280x720",
    seconds: 4,
  }),
}).then(response => response.json());

const status = await fetch(
  \`\${baseURL}/videos/\${video.id}\`,
  { headers: { Authorization: headers.Authorization } },
).then(response => response.json());

const downloadURL =
  \`\${baseURL}/videos/\${video.id}/content\`;`;

const models = [
  ["gpt-5.6-sol", "Codex & advanced reasoning", "Responses, Chat", "tokens or requests"],
  ["gpt-5.6-terra", "Fast everyday chat", "Responses, Chat", "tokens or requests"],
  ["text-embedding-3-small", "Search & embeddings", "Embeddings", "tokens or requests"],
  ["gpt-image-2", "Image generation", "Images", "images or requests"],
  ["sora-2", "Video with audio (preview)", "Video jobs", "seconds or requests"],
  ["gpt-audio-1.5", "Audio conversations", "Chat", "tokens or requests"],
  ["gpt-4o-mini-transcribe", "Speech to text", "Transcriptions", "requests"],
  ["gpt-4o-mini-tts", "Text to speech", "Speech", "requests"],
];

function CodeBlock({title,code}:{title:string;code:string}){
  const [copied,setCopied]=useState(false);
  return <div className="api-doc-code"><header><span>{title}</span><button type="button" onClick={()=>void navigator.clipboard.writeText(code).then(()=>{setCopied(true);window.setTimeout(()=>setCopied(false),1600);})}>{copied?"Copied":"Copy"}</button></header><pre><code>{code}</code></pre></div>;
}

export default function ApiDocumentationPage(){
  return <main className="api-doc-page">
    <div className="api-doc-glow"/>
    <header className="api-doc-header">
      <a className="api-doc-brand" href="/"><span>BM</span><div><strong>Beyond Marks</strong><small>AI Academy Developer Platform</small></div></a>
      <nav><a href="#codex">Codex</a><a href="#models">Models</a><a href="#examples">Examples</a><a href="/">Dashboard</a></nav>
    </header>

    <section className="api-doc-hero">
      <span>ACADEMY AI GATEWAY</span>
      <h1>Build with your<br/><em>Beyond Marks API key.</em></h1>
      <p>One protected OpenAI-compatible URI for Codex, chat, reasoning, embeddings, images, audio, and video—without exposing the Academy&apos;s Azure credential.</p>
      <div><a href="#codex">Configure Codex</a><code>{BASE_URL}</code></div>
    </section>

    <section className="api-doc-callout">
      <strong>Before you begin</strong>
      <p>Your key starts with <code>bm_live_</code>. Reveal it from Dashboard → API Access → Accessed API Key. The model must also appear in your key&apos;s “Allowed deployments” list.</p>
    </section>

    <section id="codex" className="api-doc-section">
      <div className="api-doc-section-title"><span>01</span><div><small>CODING AGENT</small><h2>Use the key with Codex</h2><p>Codex uses the streamed Responses API. The Academy gateway supports that protocol and records exact usage from the final response event.</p></div></div>
      <div className="api-doc-steps">
        <article><i>1</i><div><h3>Install Codex</h3><p>Install Node.js first, then run:</p><CodeBlock title="Terminal" code={"npm install -g @openai/codex\ncodex --version"}/></div></article>
        <article><i>2</i><div><h3>Add the Academy provider</h3><p>Create or edit <code>~/.codex/config.toml</code> and paste this configuration.</p><CodeBlock title="~/.codex/config.toml" code={codexConfig}/></div></article>
        <article><i>3</i><div><h3>Add the environment variables</h3><p>Copy the ready-to-use block from Dashboard → Manage API key. Never commit the file to Git.</p><CodeBlock title=".env or .env.local" code={`OPENAI_API_KEY=bm_live_YOUR_ACADEMY_KEY\nOPENAI_BASE_URL=${BASE_URL}`}/><CodeBlock title="PowerShell session" code={`$env:OPENAI_API_KEY="bm_live_YOUR_ACADEMY_KEY"\n$env:OPENAI_BASE_URL="${BASE_URL}"\ncodex`}/></div></article>
      </div>
      <div className="api-doc-note"><strong>Codex access requirement</strong><p>Your administrator should allow <code>gpt-5.6-sol</code> and choose a token or request allowance. A token allowance reserves safely during a streamed turn, then charges the exact input and output tokens reported by Azure.</p></div>
    </section>

    <section id="models" className="api-doc-section">
      <div className="api-doc-section-title"><span>02</span><div><small>LIVE DEPLOYMENTS</small><h2>Available model families</h2><p>Use the deployment name exactly as shown in the request&apos;s <code>model</code> field.</p></div></div>
      <div className="api-doc-model-table"><div className="head"><span>Deployment</span><span>Best for</span><span>API</span><span>Allowance</span></div>{models.map(model=><div key={model[0]}><code>{model[0]}</code><span>{model[1]}</span><span>{model[2]}</span><span>{model[3]}</span></div>)}</div>
      <p className="api-doc-fineprint"><strong>Important:</strong> request-metered keys work across every assigned family. Specialized token, image, or video-second keys only work with compatible operations so unlike costs are never mixed.</p>
    </section>

    <section id="examples" className="api-doc-section">
      <div className="api-doc-section-title"><span>03</span><div><small>QUICKSTARTS</small><h2>Call the gateway</h2><p>Authenticate with <code>Authorization: Bearer YOUR_KEY</code>. The Azure Foundry key always remains on the backend.</p></div></div>
      <div className="api-doc-example-grid">
        <article><h3>Stream a response</h3><p>Use SSE for interactive assistants and coding agents.</p><CodeBlock title="cURL" code={responseExample}/></article>
        <article><h3>OpenAI JavaScript SDK</h3><p>Point the standard SDK at the Academy base URL.</p><CodeBlock title="Node.js" code={sdkExample}/></article>
        <article className="wide"><h3>Create and retrieve a video</h3><p>Video generation is asynchronous. Create a job, poll its Academy-owned job ID, then download the generation.</p><CodeBlock title="Node.js" code={videoExample}/></article>
      </div>
    </section>

    <section className="api-doc-section api-doc-endpoints">
      <div className="api-doc-section-title"><span>04</span><div><small>REFERENCE</small><h2>Endpoint map</h2></div></div>
      <div>
        <code>POST /responses</code><span>Responses and Codex streaming</span>
        <code>POST /chat/completions</code><span>Chat and audio chat completions</span>
        <code>POST /embeddings</code><span>Vector embeddings</span>
        <code>POST /images/generations</code><span>Image generation</span>
        <code>POST /audio/speech</code><span>Text to speech (binary response)</span>
        <code>POST /audio/transcriptions</code><span>Multipart speech to text</span>
        <code>POST /videos</code><span>Create a Sora 2 video</span>
        <code>GET /videos/:id</code><span>Poll your video</span>
        <code>GET /videos/:id/content</code><span>Download your video</span>
      </div>
    </section>

    <section className="api-doc-security"><span>KEEP YOUR KEY PRIVATE</span><h2>Every call is attributable to your account.</h2><p>Do not expose Academy keys in browser code, screenshots, public repositories, mobile apps, or shared notebooks. If a key is exposed, ask the administrator to revoke and rotate it immediately.</p></section>
    <footer className="api-doc-footer"><span>Beyond Marks AI Academy</span><div><a href="https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/codex" target="_blank" rel="noreferrer">Azure Codex guide</a><a href="https://developers.openai.com/codex/" target="_blank" rel="noreferrer">Official Codex docs</a></div></footer>
  </main>;
}
