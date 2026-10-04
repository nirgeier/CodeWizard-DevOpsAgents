from typing import Dict, Any

class CompanyTool:
    def enrich(self, domain=None, name=None) -> Dict[str, Any]:
        return {"name": name or "", "domain": domain or ""}
