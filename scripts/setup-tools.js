import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binDir = path.join(__dirname, '..', 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp.exe');

async function setupTools() {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (fs.existsSync(ytdlpPath) && fs.statSync(ytdlpPath).size > 1000000) {
    console.log(`[INFO] yt-dlp.exe already exists at: ${ytdlpPath}`);
    return;
  }

  console.log('[INFO] Downloading official yt-dlp.exe from GitHub...');
  const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

  try {
    // Try curl first (built into modern Windows 10/11)
    execSync(`curl.exe -L --fail -o "${ytdlpPath}" "${downloadUrl}"`, { stdio: 'inherit' });
    console.log(`[SUCCESS] Downloaded yt-dlp.exe to ${ytdlpPath}`);
  } catch (curlErr) {
    console.warn('[WARN] curl failed, trying node fetch with User-Agent...');
    try {
      const res = await fetch(downloadUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(ytdlpPath, Buffer.from(arrayBuffer));
      console.log(`[SUCCESS] Downloaded yt-dlp.exe via fetch to ${ytdlpPath}`);
    } catch (fetchErr) {
      console.error(`[ERROR] Could not auto-download yt-dlp: ${fetchErr.message}`);
      console.log('[HINT] You can manually download yt-dlp.exe from:');
      console.log('       https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
      console.log(`       and place it into: ${ytdlpPath}`);
    }
  }
}

setupTools();
