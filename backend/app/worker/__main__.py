"""Entrypoint del worker: python -m app.worker"""

from arq import run_worker

from app.worker.settings import WorkerSettings

if __name__ == "__main__":
    run_worker(WorkerSettings)
