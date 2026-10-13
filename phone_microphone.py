"""Bounded LAN pitch relay. Never stores or receives microphone audio."""
import math
import time
from threading import Lock
from uuid import UUID


class PhoneMicrophone:
    def __init__(self):
        self.lock = Lock()
        self.state = {"session": None, "active": False, "epoch": 0, "title": ""}
        self.published = 0
        self.peer = None
        self.received = 0
        self.sequence = -1
        self.frames = []

    @staticmethod
    def now():
        return time.time() * 1000

    def configure(self, body):
        session = body.get("session")
        if session is not None:
            UUID(session)
            epoch = body.get("epoch", 0)
            if not isinstance(epoch, int) or not 0 <= epoch < 2**53:
                raise ValueError("Sessão de microfone inválida.")
        with self.lock:
            if self.state["session"] != session or self.state["epoch"] != body.get("epoch", 0):
                self.frames.clear()
            if self.state["session"] != session:
                self.peer = None
                self.received = 0
                self.sequence = -1
            self.state = {"session": session, "epoch": body.get("epoch", 0), "active": bool(session and body.get("active")), "title": str(body.get("title", ""))[:200]}
            self.published = self.now()
        return {"ok": True}

    def status(self):
        with self.lock:
            return {**self.state, "active": self.state["active"] and self.now()-self.published < 3000, "serverTime": self.now()}

    def receive(self, body):
        now = self.now()
        sender = body.get("sender", "")
        UUID(sender)
        with self.lock:
            if not self.state["active"] or now-self.published >= 3000 or body.get("session") != self.state["session"] or body.get("epoch") != self.state["epoch"]:
                raise ValueError("Ative Celular conectado na pontuação do aparelho principal.")
            if self.peer and self.peer != sender and now-self.received < 3000:
                raise ValueError("Outro celular já está usando este microfone.")
            if body.get("leave"):
                if self.peer == sender:
                    self.peer = None
                    self.received = 0
                return {"ok": True, "serverTime": now}
            sequence = body.get("sequence")
            if not isinstance(sequence, int) or not 0 <= sequence < 2**53:
                raise ValueError("Pacote de microfone inválido.")
            if self.peer == sender and sequence <= self.sequence:
                return {"ok": True, "serverTime": now}
            frame = None
            if "frequency" in body:
                values = {key: body.get(key) for key in ("frequency", "confidence", "rms", "capturedAt")}
                if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in values.values()):
                    raise ValueError("Afinação inválida.")
                if not (values["frequency"] == 0 or 65 <= values["frequency"] <= 1000) or not 0 <= values["confidence"] <= 1 or not 0 <= values["rms"] <= 1:
                    raise ValueError("Afinação fora do intervalo.")
                if not now-1500 <= values["capturedAt"] <= now+250:
                    raise ValueError("Pacote atrasado. Reconecte o microfone.")
                frame = {**values, "session": self.state["session"], "epoch": self.state["epoch"]}
            self.peer = sender
            self.sequence = sequence
            self.received = now
            if frame:
                self.frames.append(frame)
                self.frames = self.frames[-64:]
        return {"ok": True, "serverTime": now}

    def drain(self):
        with self.lock:
            frames, self.frames = self.frames, []
            return {"frames": frames, "ready": bool(self.peer and self.now()-self.received < 3000)}
