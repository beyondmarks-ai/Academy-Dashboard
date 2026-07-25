import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../.openai/hosting.json", import.meta.url);
const destinationDirectory = new URL("../dist/.openai/", import.meta.url);
const destination = new URL("hosting.json", destinationDirectory);

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);

console.log("Prepared OpenAI Sites metadata in dist/.openai/hosting.json");
