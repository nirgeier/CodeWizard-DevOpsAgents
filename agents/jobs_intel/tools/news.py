from typing import List, Dict, Any
from jobs_intel.config import settings
from jobs_intel.tools.http import HttpClient

class NewsTool:
    def fetch(self, keywords: List[str], since_days: int=30) -> List[Dict[str, Any]]:
        items = []
        hc = HttpClient()
        try:
            if settings.newsapi_key:
                q = "+".join(keywords[:3]) or "devops"
                url = f"https://newsapi.org/v2/everything?q={q}&language=en&sortBy=publishedAt&pageSize=50&apiKey={settings.newsapi_key}"
                j = hc.get(url).json()
                for a in j.get("articles", []):
                    items.append({"source":"newsapi","type":"news","headline":a.get("title"),"summary":a.get("description"),"url":a.get("url"),"occurred_at":a.get("publishedAt")})
            if settings.gnews_api_key and len(items) < 40:
                q = " OR ".join(keywords[:4]) or "devops platform"
                url = f"https://gnews.io/api/v4/search?q={q}&lang=en&max=50&apikey={settings.gnews_api_key}"
                j = hc.get(url).json()
                for a in j.get("articles", []):
                    items.append({"source":"gnews","type":"news","headline":a.get("title"),"summary":a.get("description"),"url":a.get("url"),"occurred_at":a.get("publishedAt")})
        finally:
            hc.close()
        return items
