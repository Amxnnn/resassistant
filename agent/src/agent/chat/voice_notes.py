"""Voice notes in a chat, turned into text by Deepgram's pre-recorded API (the same credit as calls).

Nova-3 with the call's language and the restaurant's keyterms (dish and street names), so a voice
note is understood as well as a call. smart_format writes numbers as digits, which the booking tools
read either way.
"""

from __future__ import annotations

import httpx

DEEPGRAM_LISTEN = "https://api.deepgram.com/v1/listen"


class VoiceNotes:
    def __init__(
        self,
        api_key: str,
        *,
        language: str = "en-US",
        keyterms: list[str] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            timeout=30, transport=transport, headers={"Authorization": f"Token {api_key}"}
        )
        self._params = [
            ("model", "nova-3"),
            ("language", language),
            ("smart_format", "true"),
            ("punctuate", "true"),
            *(("keyterm", term) for term in keyterms or []),
        ]

    async def transcribe(self, audio: bytes, mime_type: str) -> str:
        """The note's words, or "" if nothing could be made out. Raises httpx.HTTPError on failure."""
        resp = await self._http.post(
            DEEPGRAM_LISTEN, params=self._params, content=audio, headers={"Content-Type": mime_type}
        )
        resp.raise_for_status()
        channels = resp.json().get("results", {}).get("channels") or [{}]
        alternatives = channels[0].get("alternatives") or [{}]
        return (alternatives[0].get("transcript") or "").strip()

    async def aclose(self) -> None:
        await self._http.aclose()
