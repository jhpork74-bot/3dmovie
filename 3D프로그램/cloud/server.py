"""Private, temporary MuseTalk worker for a user's own free Colab GPU session."""
import asyncio
import hmac
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

MAX_UPLOAD = 32 * 1024 * 1024


def make_app(token, model_root, *, gpu_name=None, runner=None, work_root=None):
    if len(token) < 16:
        raise ValueError('A random session token of at least 16 characters is required')
    root = pathlib.Path(model_root).resolve()
    work = pathlib.Path(work_root or tempfile.mkdtemp(prefix='sihu-jobs-'))
    work.mkdir(parents=True, exist_ok=True)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    jobs = {}
    lock = threading.Lock()

    def auth(authorization: str = Header(default='')):
        if not hmac.compare_digest(authorization, 'Bearer ' + token):
            raise HTTPException(401, 'Invalid session connection code')

    def get_job(job_id):
        if not re.fullmatch(r'[a-f0-9]{32}', job_id) or job_id not in jobs:
            raise HTTPException(404, 'Unknown job')
        return jobs[job_id]

    def probe(file):
        result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(file)],
                                capture_output=True, text=True, timeout=30, check=True)
        length = float(json.loads(result.stdout)['format']['duration'])
        if not 0 < length <= 60.1:
            raise ValueError('Each processing unit must be at most 60 seconds')
        return length

    def infer(job):
        config = job['dir'] / 'inference.json'
        config.write_text(json.dumps({'avatar': {'video_path': str(job['video']),
                                               'audio_path': str(job['audio']), 'result_name': 'lip.mp4'}}))
        command = [os.sys.executable, '-m', 'scripts.inference', '--inference_config', str(config),
                   '--result_dir', str(job['dir'] / 'result'), '--unet_model_path', 'models/musetalkV15/unet.pth',
                   '--unet_config', 'models/musetalkV15/musetalk.json', '--version', 'v15',
                   '--use_float16', '--batch_size', '2', '--fps', '25', '--ffmpeg_path', '/usr/bin']
        log = job['dir'] / 'inference.log'
        with log.open('w') as stream:
            process = subprocess.Popen(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            job['process'] = process
            while process.poll() is None:
                if job['cancel'].is_set() or time.time() - job['started'] > 1800:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                    if job['cancel'].is_set():
                        return None
                    raise TimeoutError('Generation exceeded 30 minutes')
                # Only the upstream generation progress, not model-loading/download bars.
                tail = log.read_text(errors='replace')[-16000:]
                matches = re.findall(r'inference[^\r\n]*?(\d{1,3})%\|', tail, re.IGNORECASE)
                if matches:
                    job['progress'] = max(job.get('progress') or 0, min(99, int(matches[-1])))
                time.sleep(1)
            if process.returncode:
                raise RuntimeError('MuseTalk failed; inspect the notebook inference log')
        output = job['dir'] / 'result' / 'v15' / 'lip.mp4'
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError('MuseTalk produced no output; inspect the notebook inference log')
        probe(output)
        return output

    def execute(job):
        try:
            if job['cancel'].is_set():
                job['status'] = 'cancelled'
                return
            job.update(status='running', started=time.time())
            output = (runner or infer)(job)
            if job['cancel'].is_set():
                job['status'] = 'cancelled'
            elif output and pathlib.Path(output).is_file():
                job.update(status='completed', output=pathlib.Path(output), progress=100)
            else:
                job['status'] = 'failed'
        except Exception as error:
            job.update(status='failed', error=type(error).__name__)
            print('MuseTalk task failed:', type(error).__name__, flush=True)
        finally:
            job['finished'] = time.time()

    async def save_upload(upload, destination):
        size = 0
        try:
            with destination.open('wb') as stream:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        raise HTTPException(413, 'Upload too large')
                    stream.write(chunk)
            if not size:
                raise HTTPException(422, 'Empty upload')
        finally:
            await upload.close()

    def purge():
        # Session files are temporary; remove finished jobs after 30 minutes.
        for key, job in list(jobs.items()):
            if job.get('finished') and time.time() - job['finished'] > 1800:
                shutil.rmtree(job['dir'], ignore_errors=True)
                jobs.pop(key, None)

    @app.get('/v1/health', dependencies=[Depends(auth)])
    def health():
        return {'protocol': 1, 'engine': 'musetalk-1.5', 'gpu': gpu_name,
                'max_segment_seconds': 60, 'paid_fallback': False}

    @app.post('/v1/jobs', dependencies=[Depends(auth)], status_code=202)
    async def submit(source_video: UploadFile = File(...), audio: UploadFile = File(...)):
        # Reserve the one GPU slot before asynchronous uploads to avoid races.
        with lock:
            purge()
            if any(j['status'] in ('uploading', 'queued', 'running') for j in jobs.values()):
                raise HTTPException(409, 'GPU busy')
            job_id = uuid.uuid4().hex
            directory = work / job_id
            directory.mkdir()
            job = {'id': job_id, 'dir': directory, 'video': directory / 'avatar.mp4',
                   'audio': directory / 'speech.wav', 'status': 'uploading', 'progress': None,
                   'cancel': threading.Event()}
            jobs[job_id] = job
        try:
            await save_upload(source_video, job['video'])
            await save_upload(audio, job['audio'])
            await asyncio.to_thread(probe, job['video'])
            await asyncio.to_thread(probe, job['audio'])
        except Exception:
            job.update(status='failed', finished=time.time())
            shutil.rmtree(directory, ignore_errors=True)
            raise
        job['status'] = 'queued'
        threading.Thread(target=execute, args=(job,), daemon=True).start()
        return {'id': job_id}

    @app.get('/v1/jobs/{job_id}', dependencies=[Depends(auth)])
    def status(job_id: str):
        job = get_job(job_id)
        return {'id': job_id, 'status': job['status'], 'progress': job.get('progress')}

    @app.get('/v1/jobs/{job_id}/video', dependencies=[Depends(auth)])
    def video(job_id: str):
        job = get_job(job_id)
        if job['status'] != 'completed':
            raise HTTPException(409, 'Not complete')
        return FileResponse(job['output'], media_type='video/mp4', filename='lip.mp4')

    @app.delete('/v1/jobs/{job_id}', dependencies=[Depends(auth)])
    def cancel(job_id: str):
        job = get_job(job_id)
        job['cancel'].set()
        if job['status'] not in ('running', 'queued'):
            shutil.rmtree(job['dir'], ignore_errors=True)
            jobs.pop(job_id, None)
        return {'cancel_requested': True}

    app.state.jobs = jobs
    return app


if __name__ == '__main__':
    import torch
    import uvicorn
    if not torch.cuda.is_available():
        raise SystemExit('A free GPU runtime must be assigned before starting this server')
    uvicorn.run(make_app(os.environ['SIHU_SESSION_TOKEN'], os.environ['SIHU_MUSETALK_ROOT'],
                         gpu_name=torch.cuda.get_device_name(0)), host='127.0.0.1', port=7860,
                access_log=False, log_level='warning')
