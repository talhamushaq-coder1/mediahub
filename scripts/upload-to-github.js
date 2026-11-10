import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Helper to make GitHub API requests
async function ghRequest(endpoint, token, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`,
    'User-Agent': 'MediaHub-Deployer',
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data && data.message ? data.message : `HTTP ${response.status} ${response.statusText}`;
    throw new Error(errorMsg);
  }
  return data;
}

// Ignore list matching .gitignore
const IGNORED_PATHS = [
  'node_modules',
  'package-lock.json',
  'downloads',
  '.git',
  'bin/yt-dlp.exe',
  'bin/yt-dlp'
];

function isIgnored(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return IGNORED_PATHS.some(ign => normalized === ign || normalized.startsWith(ign + '/'));
}

// Recursively gather files
function getAllFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (isIgnored(relPath)) continue;

    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

export async function uploadProject(token, repoName = 'mediahub', isPrivate = false) {
  console.log(`[1/5] Verifying GitHub token...`);
  const user = await ghRequest('/user', token);
  const username = user.login;
  console.log(` Authenticated as @${username} (${user.name || username})`);

  console.log(`[2/5] Checking repository: ${username}/${repoName}...`);
  let repo;
  try {
    repo = await ghRequest(`/repos/${username}/${repoName}`, token);
    console.log(` Existing repository found.`);
  } catch (err) {
    if (err.message.includes('Not Found')) {
      console.log(` Creating new repository '${repoName}'...`);
      repo = await ghRequest('/user/repos', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repoName,
          description: 'MediaHub PRO — Multi-Platform Video & Audio Downloader (YouTube, TikTok, Instagram)',
          private: isPrivate,
          auto_init: true
        })
      });
      console.log(` Repository created: ${repo.html_url}`);
      // Brief pause to allow GitHub to initialize default branch
      await new Promise(r => setTimeout(r, 2000));
    } else {
      throw err;
    }
  }

  console.log(`[3/5] Scanning project files...`);
  const files = getAllFiles(projectRoot);
  console.log(` Found ${files.length} project files to upload (node_modules and large binaries excluded).`);

  // Upload Blobs
  console.log(`[4/5] Uploading file blobs to Git database...`);
  const treeItems = [];
  for (const file of files) {
    const fileBuffer = fs.readFileSync(file.fullPath);
    const base64Content = fileBuffer.toString('base64');

    const blob = await ghRequest(`/repos/${username}/${repoName}/git/blobs`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: base64Content,
        encoding: 'base64'
      })
    });

    treeItems.push({
      path: file.relPath,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
    process.stdout.write(`  + ${file.relPath}\n`);
  }

  console.log(`[5/5] Committing changes to branch 'main'...`);
  // Get latest commit on main or master
  let parentCommitSha = null;
  let baseTreeSha = null;
  try {
    const ref = await ghRequest(`/repos/${username}/${repoName}/git/refs/heads/main`, token);
    parentCommitSha = ref.object.sha;
    const commitData = await ghRequest(`/repos/${username}/${repoName}/git/commits/${parentCommitSha}`, token);
    baseTreeSha = commitData.tree.sha;
  } catch {
    // Check master
    try {
      const ref = await ghRequest(`/repos/${username}/${repoName}/git/refs/heads/master`, token);
      parentCommitSha = ref.object.sha;
      const commitData = await ghRequest(`/repos/${username}/${repoName}/git/commits/${parentCommitSha}`, token);
      baseTreeSha = commitData.tree.sha;
    } catch {}
  }

  // Create tree
  const treePayload = { tree: treeItems };
  if (baseTreeSha) treePayload.base_tree = baseTreeSha;

  const newTree = await ghRequest(`/repos/${username}/${repoName}/git/trees`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(treePayload)
  });

  // Create commit
  const commitPayload = {
    message: 'Initial release: MediaHub PRO (Multi-Platform Media Downloader)',
    tree: newTree.sha,
    parents: parentCommitSha ? [parentCommitSha] : []
  };

  const newCommit = await ghRequest(`/repos/${username}/${repoName}/git/commits`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commitPayload)
  });

  // Update or create ref
  try {
    await ghRequest(`/repos/${username}/${repoName}/git/refs/heads/main`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommit.sha, force: true })
    });
  } catch {
    await ghRequest(`/repos/${username}/${repoName}/git/refs`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'refs/heads/main', sha: newCommit.sha })
    });
  }

  console.log(`\n======================================================`);
  console.log(` SUCCESS! Project uploaded to GitHub:`);
  console.log(` ${repo.html_url}`);
  console.log(`======================================================\n`);
  return repo.html_url;
}

// If executed directly from CLI: node scripts/upload-to-github.js <TOKEN> [REPO_NAME] [isPrivate]
if (process.argv[2]) {
  const token = process.argv[2];
  const repoName = process.argv[3] || 'mediahub';
  const isPrivate = process.argv[4] === 'true';

  uploadProject(token, repoName, isPrivate).catch(err => {
    console.error(`\n[ERROR] Upload failed: ${err.message}`);
    process.exit(1);
  });
}
