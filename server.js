import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const binDir = path.join(__dirname, 'bin');
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Locate yt-dlp binary
function getYtDlpCommand() {
  const localExe = path.join(binDir, 'yt-dlp.exe');
  const localBin = path.join(binDir, 'yt-dlp');
  if (fs.existsSync(localExe)) return localExe;
  if (fs.existsSync(localBin)) return localBin;

  try {
    execSync('where yt-dlp || which yt-dlp', { stdio: 'ignore' });
    return 'yt-dlp';
  } catch {
    return localExe;
  }
}

// In-memory download jobs and metadata cache
const jobs = new Map();
const metadataCache = new Map(); // url -> { data, timestamp }
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Helper: Format duration in seconds
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Status check
app.get('/api/status', (req, res) => {
  const binaryPath = getYtDlpCommand();
  const binaryExists = fs.existsSync(binaryPath) || binaryPath === 'yt-dlp';
  
  let ffmpegExists = false;
  try {
    execSync('where ffmpeg || which ffmpeg', { stdio: 'ignore' });
    ffmpegExists = true;
  } catch {
    ffmpegExists = false;
  }

  res.json({
    ytdlpAvailable: binaryExists,
    ytdlpPath: binaryPath,
    ffmpegAvailable: ffmpegExists,
    engine: 'yt-dlp Turbo (8x Parallel Threads + Android Rate-Bypass)'
  });
});

// Fast Metadata Inspection Route with Caching
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid URL' });
  }

  const cleanUrl = url.trim();

  // Check cache for instant 0ms response
  const cached = metadataCache.get(cleanUrl);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return res.json(cached.data);
  }

  const binary = getYtDlpCommand();
  if (!fs.existsSync(binary) && binary !== 'yt-dlp') {
    return res.status(503).json({
      error: 'yt-dlp engine is not ready. Run npm run setup-tools.'
    });
  }

  // Ultra-fast extraction arguments:
  // - player_client=android bypasses heavy JS deciphering & web throttling
  // - skip=hls,dash avoids parsing thousands of streaming manifests for info
  const args = [
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--socket-timeout', '8',
    '--extractor-args', 'youtube:player_client=android,web;skip=hls,dash',
    cleanUrl
  ];

  const child = spawn(binary, args);
  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', (chunk) => { stdoutData += chunk; });
  child.stderr.on('data', (chunk) => { stderrData += chunk; });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp fast-info failed, falling back to standard extraction...');
      // Fallback without extractor-args if platform doesn't support it
      const fallbackChild = spawn(binary, [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        cleanUrl
      ]);
      let fbStdout = '';
      let fbStderr = '';
      fallbackChild.stdout.on('data', (chunk) => { fbStdout += chunk; });
      fallbackChild.stderr.on('data', (chunk) => { fbStderr += chunk; });
      fallbackChild.on('close', (fbCode) => {
        if (fbCode !== 0) {
          return res.status(500).json({
            error: 'Failed to extract video information. Link may be private or restricted.',
            details: fbStderr.slice(0, 300)
          });
        }
        try {
          const payload = parseAndCacheInfo(fbStdout, cleanUrl);
          return res.json(payload);
        } catch (e) {
          return res.status(500).json({ error: 'Metadata parse error.', details: e.message });
        }
      });
      return;
    }

    try {
      const payload = parseAndCacheInfo(stdoutData, cleanUrl);
      res.json(payload);
    } catch (parseErr) {
      res.status(500).json({ error: 'Failed to parse video metadata.', details: parseErr.message });
    }
  });
});

function parseAndCacheInfo(rawJson, url) {
  const data = JSON.parse(rawJson);
  let platform = 'Generic';
  const extractor = (data.extractor || data.extractor_key || '').toLowerCase();
  if (extractor.includes('youtube')) platform = 'YouTube';
  else if (extractor.includes('tiktok')) platform = 'TikTok';
  else if (extractor.includes('instagram')) platform = 'Instagram';
  else if (extractor.includes('twitter') || extractor.includes('x')) platform = 'Twitter / X';
  else if (extractor.includes('facebook')) platform = 'Facebook';

  let thumbnail = data.thumbnail || (data.thumbnails && data.thumbnails.length > 0 ? data.thumbnails[data.thumbnails.length - 1].url : '');

  const payload = {
    title: data.title || 'Untitled Video',
    platform: platform,
    thumbnail: thumbnail,
    duration: formatDuration(data.duration),
    uploader: data.uploader || data.channel || data.creator || 'Unknown Creator',
    webpage_url: data.webpage_url || url,
    formats: [
      { id: 'fast-video', label: '⚡ Ultra Fast (720p / Direct MP4)', ext: 'mp4', type: 'video', desc: 'Instant single-stream download' },
      { id: 'best-video', label: '🚀 Turbo 1080p (8x Parallel Threads)', ext: 'mp4', type: 'video', desc: 'Highest resolution MP4' },
      { id: 'best-audio', label: '🎵 Audio Only (MP3)', ext: 'mp3', type: 'audio', desc: 'High Quality MP3' }
    ]
  };

  // Cache result
  metadataCache.set(url, { data: payload, timestamp: Date.now() });
  return payload;
}

// Accelerated Download Route
app.post('/api/download', (req, res) => {
  const { url, formatId, type } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing target URL' });
  }

  const binary = getYtDlpCommand();
  if (!fs.existsSync(binary) && binary !== 'yt-dlp') {
    return res.status(503).json({ error: 'yt-dlp binary is missing. Run npm run setup-tools.' });
  }

  const jobId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const outTemplate = path.join(downloadsDir, `${jobId}_%(title).50s.%(ext)s`);

  const job = {
    id: jobId,
    url: url,
    status: 'starting',
    progress: '0%',
    speed: '--',
    eta: '--',
    filePath: null,
    fileName: null,
    error: null,
    createdAt: Date.now()
  };
  jobs.set(jobId, job);

  // SPEED BOOST FLAGS:
  // -N 8 : 8 concurrent fragment downloads in parallel
  // --http-chunk-size 10M : Large buffer avoids YouTube's chunk throttling
  // --buffer-size 64K : Larger memory buffer for fast disk writes
  // --extractor-args youtube:player_client=android,web : Rate-bypass client
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '-N', '8',
    '--http-chunk-size', '10M',
    '--buffer-size', '64K',
    '--extractor-args', 'youtube:player_client=android,web',
    '--newline',
    '--progress-template',
    'STATUS:%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '-o',
    outTemplate
  ];

  if (type === 'audio' || formatId === 'best-audio') {
    // Fast audio extraction
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '4');
  } else if (formatId === 'fast-video' || formatId === '720p') {
    // Prioritize direct single-file progressive streams (instant download, no merging needed)
    args.push('-f', 'b[ext=mp4]/best[height<=720][ext=mp4]/bestvideo[height<=720]+bestaudio/best');
  } else {
    // Turbo highest quality (1080p/4K) with 8 parallel fragment streams
    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    args.push('--merge-output-format', 'mp4');
  }

  args.push(url.trim());

  const child = spawn(binary, args);

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('STATUS:')) {
        const parts = line.replace('STATUS:', '').split('|');
        const statusType = parts[0];
        const percent = (parts[1] || '').trim();
        const speed = (parts[2] || '').trim();
        const eta = (parts[3] || '').trim();

        if (statusType === 'downloading') {
          job.status = 'downloading';
          job.progress = percent || job.progress;
          job.speed = speed || job.speed;
          job.eta = eta || job.eta;
        } else if (statusType === 'finished') {
          job.status = 'processing';
          job.progress = '100%';
        }
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[Job ${jobId}]:`, data.toString().slice(0, 200));
  });

  child.on('close', (code) => {
    if (code !== 0) {
      job.status = 'error';
      job.error = 'Download failed or connection timed out.';
      return;
    }

    try {
      const files = fs.readdirSync(downloadsDir);
      const matched = files.find(f => f.startsWith(`${jobId}_`));
      if (matched) {
        job.filePath = path.join(downloadsDir, matched);
        job.fileName = matched.replace(`${jobId}_`, '');
        job.status = 'completed';
        job.progress = '100%';
      } else {
        job.status = 'error';
        job.error = 'Downloaded file could not be located.';
      }
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    }
  });

  res.json({ jobId });
});

// Real-time progress check
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    fileName: job.fileName,
    error: job.error
  });
});

// Direct Instant Stream Endpoint (Streams directly to browser without staging wait!)
app.get('/api/stream', (req, res) => {
  const { url, type } = req.query;
  if (!url) return res.status(400).send('URL required');

  const binary = getYtDlpCommand();
  const cleanUrl = decodeURIComponent(url).trim();

  // Fast single stream direct to client stdout
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    '-o', '-', // output to stdout
  ];

  if (type === 'audio') {
    args.push('-f', 'bestaudio', '-x', '--audio-format', 'mp3');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');
  } else {
    // Single progressive MP4 for direct streaming
    args.push('-f', 'b[ext=mp4]/best[ext=mp4]/best');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
  }

  args.push(cleanUrl);

  const child = spawn(binary, args);
  child.stdout.pipe(res);

  child.on('error', (err) => {
    console.error('Stream pipe error:', err);
    if (!res.headersSent) res.status(500).send('Streaming error');
  });

  req.on('close', () => {
    child.kill();
  });
});

// File download route
app.get('/api/file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).send('File not found or expired.');
  }

  res.download(job.filePath, job.fileName, (err) => {
    if (err) console.error('Error sending file:', err);
    setTimeout(() => {
      try {
        if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
        jobs.delete(jobId);
      } catch {}
    }, 10 * 60 * 1000);
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`MediaHub PRO running at: http://localhost:${PORT}`);
  console.log(`Speed Engine: 8x Parallel Streams + Rate-Bypass Active`);
  console.log(`=======================================================`);
});
