// Initialize Lucide Icons
function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  checkSystemStatus();
  renderHistory();

  const urlInput = document.getElementById('url-input');
  const pasteBtn = document.getElementById('paste-btn');
  const fetchForm = document.getElementById('fetch-form');
  const fetchBtn = document.getElementById('fetch-btn');
  const fetchBtnText = document.getElementById('fetch-btn-text');
  const fetchBtnIcon = document.getElementById('fetch-btn-icon');
  const fetchSpinner = document.getElementById('fetch-spinner');
  
  const detectedBar = document.getElementById('detected-platform-bar');
  const detectedPill = document.getElementById('detected-platform-pill');
  const clearInputBtn = document.getElementById('clear-input-btn');
  const errorBox = document.getElementById('error-box');

  const previewCard = document.getElementById('preview-card');
  const mediaThumb = document.getElementById('media-thumb');
  const mediaTitle = document.getElementById('media-title');
  const mediaAuthor = document.getElementById('media-author');
  const mediaDuration = document.getElementById('media-duration');
  const mediaBadge = document.getElementById('media-badge');

  const startDownloadBtn = document.getElementById('start-download-btn');
  const directStreamBtn = document.getElementById('direct-stream-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStatusLabel = document.getElementById('progress-status-label');
  const progressPercent = document.getElementById('progress-percent');
  const progressSpeed = document.getElementById('progress-speed');
  const progressEta = document.getElementById('progress-eta');
  const downloadReadyBox = document.getElementById('download-ready-box');
  const saveFileLink = document.getElementById('save-file-link');

  let currentMediaData = null;
  let activeJobInterval = null;
  let autoFetchTimer = null;

  // 1. System Engine Status Check
  async function checkSystemStatus() {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.ytdlpAvailable) {
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        text.textContent = 'Turbo 8x Engine Active';
      } else {
        dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
        text.textContent = 'Setup Required: binary missing';
      }
    } catch {
      dot.className = 'w-2 h-2 rounded-full bg-red-400';
      text.textContent = 'Engine Offline';
    }
  }

  // 2. Platform Selector Tabs
  const platformTabs = document.querySelectorAll('.platform-tab');
  platformTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      platformTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const filter = tab.dataset.filter;
      if (filter === 'youtube') {
        urlInput.placeholder = 'Paste YouTube video or Shorts link (e.g. https://youtu.be/...)';
      } else if (filter === 'tiktok') {
        urlInput.placeholder = 'Paste TikTok video link (e.g. https://tiktok.com/@.../video/...)';
      } else if (filter === 'instagram') {
        urlInput.placeholder = 'Paste Instagram Reel or Post link (e.g. https://instagram.com/reel/...)';
      } else if (filter === 'more') {
        urlInput.placeholder = 'Paste Twitter/X, Facebook or Vimeo video link...';
      } else {
        urlInput.placeholder = 'Paste YouTube, TikTok or Instagram link here...';
      }
      urlInput.focus();
    });
  });

  // 3. Real-time URL Detection & Auto-Inspection
  function detectPlatform(url) {
    if (!url) return null;
    const lower = url.toLowerCase();
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return { name: 'YouTube', color: 'badge-youtube', filter: 'youtube' };
    if (lower.includes('tiktok.com')) return { name: 'TikTok', color: 'badge-tiktok', filter: 'tiktok' };
    if (lower.includes('instagram.com')) return { name: 'Instagram', color: 'badge-instagram', filter: 'instagram' };
    if (lower.includes('twitter.com') || lower.includes('x.com')) return { name: 'Twitter / X', color: 'badge-generic', filter: 'more' };
    if (lower.includes('facebook.com') || lower.includes('fb.watch')) return { name: 'Facebook', color: 'badge-generic', filter: 'more' };
    return null;
  }

  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    const detected = detectPlatform(val);
    if (detected) {
      detectedBar.classList.remove('hidden');
      detectedPill.textContent = detected.name;
      detectedPill.className = `font-bold px-2.5 py-0.5 rounded text-white text-[11px] ${detected.color}`;

      // Highlight corresponding tab
      platformTabs.forEach(t => {
        if (t.dataset.filter === detected.filter) t.classList.add('active');
        else t.classList.remove('active');
      });

      // Auto-trigger inspection after 350ms pause
      clearTimeout(autoFetchTimer);
      if (val.startsWith('http://') || val.startsWith('https://')) {
        autoFetchTimer = setTimeout(() => {
          fetchMediaInfo(val);
        }, 350);
      }
    } else {
      detectedBar.classList.add('hidden');
    }
  });

  clearInputBtn.addEventListener('click', () => {
    urlInput.value = '';
    detectedBar.classList.add('hidden');
    errorBox.classList.add('hidden');
    previewCard.classList.add('hidden');
    urlInput.focus();
  });

  // 4. Paste Action
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        urlInput.dispatchEvent(new Event('input'));
      }
    } catch {
      alert('Clipboard access denied. Please paste with Ctrl+V.');
    }
  });

  // 5. Form Submit / Inspect Media
  fetchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(autoFetchTimer);
    fetchMediaInfo(urlInput.value.trim());
  });

  async function fetchMediaInfo(url) {
    if (!url || !url.startsWith('http')) return;

    errorBox.classList.add('hidden');
    if (activeJobInterval) clearInterval(activeJobInterval);

    fetchBtn.disabled = true;
    fetchBtnText.textContent = 'Inspecting...';
    fetchBtnIcon.classList.add('hidden');
    fetchSpinner.classList.remove('hidden');

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect link.');

      currentMediaData = data;

      // Populate preview card
      mediaThumb.src = data.thumbnail || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop';
      mediaTitle.textContent = data.title;
      mediaAuthor.querySelector('span').textContent = data.uploader;
      mediaDuration.textContent = data.duration;
      mediaBadge.textContent = data.platform;

      mediaBadge.className = 'absolute top-2 left-2 px-2.5 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider ';
      if (data.platform === 'YouTube') mediaBadge.className += 'badge-youtube';
      else if (data.platform === 'TikTok') mediaBadge.className += 'badge-tiktok';
      else if (data.platform === 'Instagram') mediaBadge.className += 'badge-instagram';
      else mediaBadge.className += 'badge-generic';

      previewCard.classList.remove('hidden');
      initIcons();

      previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      document.getElementById('error-title').textContent = 'Inspection Notice';
      document.getElementById('error-message').textContent = err.message;
      errorBox.classList.remove('hidden');
      initIcons();
    } finally {
      fetchBtn.disabled = false;
      fetchBtnText.textContent = 'Get Video';
      fetchBtnIcon.classList.remove('hidden');
      fetchSpinner.classList.add('hidden');
    }
  }

  // 6. Download Button Trigger
  startDownloadBtn.addEventListener('click', async () => {
    if (!currentMediaData) return;

    const selectedFormatInput = document.querySelector('input[name="download-format"]:checked');
    const formatId = selectedFormatInput ? selectedFormatInput.value : 'fast-video';
    const type = selectedFormatInput ? selectedFormatInput.dataset.type : 'video';

    progressContainer.classList.remove('hidden');
    downloadReadyBox.classList.add('hidden');
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressSpeed.textContent = '-- MB/s';
    progressEta.textContent = 'ETA: --';
    progressStatusLabel.textContent = '8x Parallel Threads Connecting...';
    startDownloadBtn.disabled = true;

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentMediaData.webpage_url,
          formatId: formatId,
          type: type
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download failed to start');

      trackProgress(data.jobId, currentMediaData.title, type);
    } catch (err) {
      alert(`Error: ${err.message}`);
      startDownloadBtn.disabled = false;
      progressContainer.classList.add('hidden');
    }
  });

  // 7. Direct Instant Stream Button
  directStreamBtn.addEventListener('click', () => {
    if (!currentMediaData) return;
    const selectedFormatInput = document.querySelector('input[name="download-format"]:checked');
    const type = selectedFormatInput ? selectedFormatInput.dataset.type : 'video';
    
    const streamUrl = `/api/stream?url=${encodeURIComponent(currentMediaData.webpage_url)}&type=${type}`;
    window.location.href = streamUrl;

    saveToHistory({
      title: currentMediaData.title || 'Direct Stream Download',
      platform: currentMediaData.platform,
      type: type,
      date: new Date().toLocaleTimeString()
    });
  });

  // 8. Progress Tracking (350ms Polling)
  function trackProgress(jobId, title, type) {
    if (activeJobInterval) clearInterval(activeJobInterval);

    activeJobInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/progress/${jobId}`);
        const data = await res.json();

        if (data.status === 'downloading') {
          const cleanPercent = (data.progress || '0%').replace('%', '');
          progressBarFill.style.width = `${Math.min(100, Math.max(8, parseFloat(cleanPercent) || 0))}%`;
          progressPercent.textContent = data.progress || '0%';
          progressSpeed.textContent = data.speed || '--';
          progressEta.textContent = `ETA: ${data.eta || '--'}`;
          progressStatusLabel.textContent = '8x Turbo Channels Active';
        } else if (data.status === 'processing') {
          progressBarFill.style.width = '100%';
          progressStatusLabel.textContent = 'Finalizing file...';
        } else if (data.status === 'completed') {
          clearInterval(activeJobInterval);
          progressBarFill.style.width = '100%';
          progressPercent.textContent = '100%';
          progressStatusLabel.textContent = 'Download Complete!';
          startDownloadBtn.disabled = false;

          const downloadUrl = `/api/file/${jobId}`;
          saveFileLink.href = downloadUrl;
          downloadReadyBox.classList.remove('hidden');
          initIcons();

          // Auto-trigger browser download
          window.location.href = downloadUrl;

          saveToHistory({
            title: title || 'Media Download',
            platform: currentMediaData.platform,
            type: type,
            date: new Date().toLocaleTimeString()
          });
        } else if (data.status === 'error') {
          clearInterval(activeJobInterval);
          startDownloadBtn.disabled = false;
          progressStatusLabel.textContent = 'Error: ' + (data.error || 'Connection dropped');
          progressBarFill.className = 'h-full bg-red-500 w-full';
        }
      } catch (err) {
        console.error('Progress check error:', err);
      }
    }, 350);
  }

  // 9. History Storage Management
  function saveToHistory(item) {
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('mediahub_history') || localStorage.getItem('omnidrop_history') || '[]');
    } catch {}
    history.unshift(item);
    if (history.length > 5) history = history.slice(0, 5);
    localStorage.setItem('mediahub_history', JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const historySection = document.getElementById('history-section');
    const historyList = document.getElementById('history-list');
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('mediahub_history') || localStorage.getItem('omnidrop_history') || '[]');
    } catch {}

    if (history.length === 0) {
      historySection.classList.add('hidden');
      return;
    }

    historySection.classList.remove('hidden');
    historyList.innerHTML = history.map(item => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
        <div class="flex items-center space-x-3 truncate">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            item.platform === 'YouTube' ? 'bg-red-500/20 text-red-400' :
            item.platform === 'TikTok' ? 'bg-cyan-500/20 text-cyan-400' :
            item.platform === 'Instagram' ? 'bg-pink-500/20 text-pink-400' : 'bg-slate-800 text-slate-300'
          }">${item.platform}</span>
          <span class="text-slate-200 font-medium truncate">${item.title}</span>
        </div>
        <span class="text-slate-500 text-[11px] font-mono flex-shrink-0 ml-3">${item.date}</span>
      </div>
    `).join('');
    initIcons();
  }

  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    localStorage.removeItem('mediahub_history');
    localStorage.removeItem('omnidrop_history');
    renderHistory();
  });
});
