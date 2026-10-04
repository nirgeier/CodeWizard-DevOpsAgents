import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
from jobs_intel.config import settings

class HttpClient:
    def __init__(self):
        self.client = httpx.Client(timeout=httpx.Timeout(settings.http_timeout_sec), headers={"User-Agent": settings.user_agent}, follow_redirects=True)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    def get(self, url, **kw):
        r = self.client.get(url, **kw)
        r.raise_for_status()
        return r

    def close(self):
        self.client.close()
