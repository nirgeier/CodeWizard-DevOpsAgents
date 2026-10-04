from jobs_intel.tools.http import HttpClient
from bs4 import BeautifulSoup

class WebTool:
    def fetch_text(self, url: str) -> str:
        hc = HttpClient()
        try:
            r = hc.get(url)
            soup = BeautifulSoup(r.text, "html.parser")
            return soup.get_text(" ", strip=True)[:4000]
        finally:
            hc.close()
