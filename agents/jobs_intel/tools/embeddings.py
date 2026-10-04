from typing import List
from jobs_intel.config import settings

class Embeddings:
    def embed(self, texts: List[str]) -> List[List[float]]:
        return [[0.0]*settings.embedding_dim for _ in texts]
