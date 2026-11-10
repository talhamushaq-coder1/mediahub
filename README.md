# MediaHub PRO — Multi-Platform Video & Audio Downloader

MediaHub is an ultra-fast, modern, full-stack web application designed to inspect, stream, and download high-definition media from **YouTube**, **TikTok** (watermark-free), **Instagram** (Reels & Posts), Twitter/X, and more.

---

## ✨ Key Features & Enhancements

- **Brand New Design & Logo**: Professional vector branding, sleek cyber-glass aesthetic, and responsive layout.
- **Platform Selector Tabs**: Quick filtering for YouTube, TikTok, Instagram, and more.
- **8x Turbo Acceleration**: Multi-threaded concurrent fragment downloads (`-N 8`) utilizing your maximum internet throughput.
- **YouTube Rate-Bypass**: circumvents YouTube's aggressive 50KB/s web throttling.
- **Instant Browser Stream**: Direct stdout pipe (`/api/stream`) that triggers your browser's native download dialog with zero waiting.
- **0ms Instant Cache**: Previously inspected links return immediately.
- **Format Choices**:
  - ⚡ **Fast MP4 (720p)** — Single-stream instant download.
  - 🚀 **Turbo 1080p** — 8x parallel streams for Full HD.
  - 🎵 **Audio MP3** — 320kbps clean audio extraction.
- **Auto-Inspection**: Automatically detects and extracts link details on paste.
- **Local Download History**: Keeps track of recent downloads in browser storage.
- **Auto-Cleanup**: Safely purges temporary files to prevent disk clutter.

---

## 🚀 Quick Start

### 1. One-Click Launch (Windows)
Double-click **`start.bat`**. It will start the server and open **`http://localhost:3000`** in your browser.

### 2. Terminal Launch
```bash
npm install
npm start
```
Navigate to **[http://localhost:3000](http://localhost:3000)**.
