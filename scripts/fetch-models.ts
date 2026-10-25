/**
 * Downloads the two local models into .cache/models so the first real run (or a Docker image) needs
 * no network. The cache is the same folder the app reads.
 *
 *   npm run models:fetch
 */
import { HfEmbedder } from "../src/nlp/embed";
import { HfNli, NLI_MODEL } from "../src/nlp/nli";

console.log(`Fetching ${NLI_MODEL} (about 160 MB) ...`);
await HfNli.load({ onProgress: () => {} });
console.log("Fetching the sentence-embedding model (about 25 MB) ...");
await HfEmbedder.load();
console.log("Models are in .cache/models.");
