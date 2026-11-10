import os
import uuid
import time
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

app = FastAPI(title="OmniDrop Turbo Media Downloader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# In-memory jobs & metadata cache
jobs = {}
metadata_cache = {}

class MediaInfoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    formatId: str = "fast-video"
    type: str = "video"

def cleanup_file(filepath: str, delay: int = 600):
    time.sleep(delay)
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception:
            pass

@app.post("/api/info")
def get_info(req: MediaInfoRequest):
    clean_url = req.url.strip()
    
    # 0ms Instant Cache
    if clean_url in metadata_cache and (time.time() - metadata_cache[clean_url]["time"] < 900):
        return metadata_cache[clean_url]["data"]

    # Turbo info options: uses Android client and skips streaming manifests
    ydl_opts = {
        'dump_single_json': True,
        'extract_flat': False,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': {'player_client': ['android', 'web'], 'skip': ['hls', 'dash']}}
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            data = ydl.extract_info(clean_url, download=False)
            
            extractor = (data.get('extractor') or data.get('extractor_key') or '').lower()
            if 'youtube' in extractor: platform = 'YouTube'
            elif 'tiktok' in extractor: platform = 'TikTok'
            elif 'instagram' in extractor: platform = 'Instagram'
            elif 'twitter' in extractor or 'x' in extractor: platform = 'Twitter / X'
            else: platform = 'Generic'

            duration_sec = data.get('duration') or 0
            m, s = divmod(duration_sec, 60)
            h, m = divmod(m, 60)
            duration_str = f"{h}:{m:02d}:{s:02d}" if h > 0 else f"{m}:{s:02d}"

            res_payload = {
                "title": data.get("title", "Untitled Video"),
                "platform": platform,
                "thumbnail": data.get("thumbnail", ""),
                "duration": duration_str,
                "uploader": data.get("uploader") or data.get("channel") or "Unknown Creator",
                "webpage_url": data.get("webpage_url", clean_url)
            }
            metadata_cache[clean_url] = {"data": res_payload, "time": time.time()}
            return res_payload
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "downloading",
        "progress": "0%",
        "speed": "--",
        "eta": "--",
        "file_path": None,
        "filename": None,
        "error": None
    }

    def hook(d):
        if d['status'] == 'downloading':
            jobs[job_id]["progress"] = d.get('_percent_str', '').strip()
            jobs[job_id]["speed"] = d.get('_speed_str', '').strip()
            jobs[job_id]["eta"] = d.get('_eta_str', '').strip()
        elif d['status'] == 'finished':
            jobs[job_id]["status"] = "processing"

    def run_turbo_download():
        outtmpl = os.path.join(DOWNLOADS_DIR, f"{job_id}_%(title).50s.%(ext)s")
        # Accelerated multi-chunk download
        ydl_opts = {
            'outtmpl': outtmpl,
            'progress_hooks': [hook],
            'quiet': True,
            'concurrent_fragment_downloads': 8,
            'buffersize': 65536,
            'http_chunk_size': 10485760,
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}}
        }

        if req.type == "audio" or req.formatId == "best-audio":
            ydl_opts.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            })
        elif req.formatId == "fast-video":
            ydl_opts.update({'format': 'b[ext=mp4]/best[height<=720][ext=mp4]/best'})
        else:
            ydl_opts.update({
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'merge_output_format': 'mp4',
            })

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([req.url])

            for f in os.listdir(DOWNLOADS_DIR):
                if f.startswith(f"{job_id}_"):
                    full_p = os.path.join(DOWNLOADS_DIR, f)
                    jobs[job_id]["file_path"] = full_p
                    jobs[job_id]["filename"] = f.replace(f"{job_id}_", "")
                    jobs[job_id]["status"] = "completed"
                    jobs[job_id]["progress"] = "100%"
                    break
        except Exception as err:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(err)

    background_tasks.add_task(run_turbo_download)
    return {"jobId": job_id}

@app.get("/api/progress/{job_id}")
def check_progress(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]

@app.get("/api/file/{job_id}")
def download_file(job_id: str, background_tasks: BackgroundTasks):
    job = jobs.get(job_id)
    if not job or not job.get("file_path") or not os.path.exists(job["file_path"]):
        raise HTTPException(status_code=404, detail="File expired or not found")
    
    file_path = job["file_path"]
    background_tasks.add_task(cleanup_file, file_path, 600)
    return FileResponse(path=file_path, filename=job["filename"], media_type="application/octet-stream")

if os.path.exists(PUBLIC_DIR):
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=3000, reload=True)
