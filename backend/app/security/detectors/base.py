from abc import ABC, abstractmethod

from app.security.models import DetectorResult


class Detector(ABC):
    name: str
    category: str

    @abstractmethod
    async def detect(self, text: str) -> DetectorResult: ...
