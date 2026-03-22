import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloads = [
  {
    url: 'https://huggingface.co/api/resolve-cache/models/mistralai/Mistral-7B-v0.1/27d67f1b5f57dc0953326b2601d68371d40ea8da/tokenizer.json',
    filename: 'mistral.json',
  },
  {
    url: 'https://huggingface.co/api/resolve-cache/models/Qwen/Qwen2-7B/453ed1575b739b5b03ce3758b23befdb0967f40e/tokenizer.json',
    filename: 'qwen2.json',
  },
  {
    url: 'https://huggingface.co/unsloth/llama-3-8b/raw/main/tokenizer.json',
    filename: 'llama3.json',
  },
];

const targetDir = path.join(__dirname, '../src-tauri/tokenizers');

function downloadFile({ url, filename }) {
  return new Promise((resolve, reject) => {
    const targetPath = path.join(targetDir, filename);

    if (fs.existsSync(targetPath)) {
      console.log(`${filename} already exists, skipping.`);
      return resolve();
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`Downloading ${filename}...`);
    const file = fs.createWriteStream(targetPath);

    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`${filename} done.`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(targetPath, () => {});
      console.error(`Failed to download ${filename}:`, err.message);
      reject(err);
    });
  });
}

for (const entry of downloads) {
  await downloadFile(entry);
}

console.log('All downloads finished.');