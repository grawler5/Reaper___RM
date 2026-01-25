#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RemoteMixerLauncher.py

Modes:
  - controller (default): checks if daemon is running; starts daemon or GUI and exits.
  - --daemon: aiohttp server + TCP bridge (Node replacement).
  - --gui: deprecated (use in-REAPER UI).
"""
from __future__ import print_function

import argparse
import asyncio
import contextlib
import hashlib
import json
import logging
import os
import socket
import subprocess
import sys
import time
import uuid
from collections import deque
from typing import Any, Dict, List, Optional, Set, Tuple


WEB_PORT = 3000
TCP_PORT = 7071
CONTROL_PORT = 7072
SERVER_VERSION = "6.1.0"

METER_THROTTLE_MS = 33
METER_BUFFER_LIMIT = 1_000_000
LOG_BUFFER_MAX = 400


def _script_root() -> str:
    try:
        return os.path.abspath(os.path.dirname(__file__))
    except Exception:
        pass
    try:
        script_dir = globals().get("SCRIPT_DIR")
        if script_dir:
            return os.path.abspath(script_dir)
    except Exception:
        pass
    try:
        resource = RPR_GetResourcePath()
        if isinstance(resource, tuple):
            resource = resource[0]
        return os.path.join(str(resource), "Scripts", "ReaperRM")
    except Exception:
        return os.getcwd()

def _script_path() -> str:
    try:
        return os.path.abspath(__file__)
    except Exception:
        pass
    try:
        script_dir = globals().get("SCRIPT_DIR")
        if script_dir:
            return os.path.join(os.path.abspath(script_dir), "RemoteMixerLauncher.py")
    except Exception:
        pass
    try:
        resource = RPR_GetResourcePath()
        if isinstance(resource, tuple):
            resource = resource[0]
        return os.path.join(str(resource), "Scripts", "ReaperRM", "RemoteMixerLauncher.py")
    except Exception:
        return os.path.join(os.getcwd(), "RemoteMixerLauncher.py")


def _web_root() -> str:
    return os.path.join(_script_root(), "Web")


def _public_root() -> str:
    return os.path.join(_web_root(), "public")


def _ssl_paths() -> Tuple[str, str]:
    ssl_dir = os.path.join(_web_root(), "ssl")
    return os.path.join(ssl_dir, "key.pem"), os.path.join(ssl_dir, "cert.pem")


def _projects_path() -> str:
    return os.path.join(_web_root(), "rm_projects.json")


def _log_path() -> str:
    return os.path.join(_script_root(), "RemoteMixerDaemon.log")


def _open_log_file():
    try:
        return open(_log_path(), "a", encoding="utf-8", errors="replace", newline="\n")
    except Exception:
        return open(os.devnull, "a")

def _build_env():
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("LANG", "en_US.UTF-8")
    env.setdefault("LC_ALL", "en_US.UTF-8")
    return env

def _escape_applescript(text):
    return text.replace("\\", "\\\\").replace('"', '\\"')

def show_user_error(message):
    logger = _setup_logger(deque(maxlen=LOG_BUFFER_MAX))
    logger.error(message)
    try:
        if sys.platform == "darwin":
            script = 'display alert "RemoteMixer" message "{}"'.format(_escape_applescript(message))
            subprocess.Popen(["osascript", "-e", script], env=_build_env())
            return
        if sys.platform.startswith("win"):
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, str(message), "RemoteMixer", 0)
            return
        try:
            subprocess.Popen(["zenity", "--error", "--text", str(message)], env=_build_env())
            return
        except Exception:
            pass
    except Exception:
        pass
    try:
        sys.stderr.write(str(message) + "\n")
    except Exception:
        pass


def _detached_popen_args() -> Dict[str, Any]:
    if sys.platform.startswith("win"):
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        return {"creationflags": creationflags, "close_fds": True}
    return {"start_new_session": True, "close_fds": True}


def _pythonw_executable() -> str:
    if sys.platform.startswith("win") and sys.executable.lower().endswith("python.exe"):
        candidate = sys.executable[:-10] + "pythonw.exe"
        if os.path.exists(candidate):
            return candidate
    return sys.executable


def _http_get(url: str, timeout: float = 1.5) -> Tuple[int, str]:
    import urllib.request
    import urllib.error

    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, body
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace")
    except Exception:
        return 0, ""


def _http_post(url: str, data: Optional[bytes] = None, timeout: float = 2.0) -> Tuple[int, str]:
    import urllib.request
    import urllib.error

    req = urllib.request.Request(url, data=data or b"{}", method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, body
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace")
    except Exception:
        return 0, ""


def _lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        try:
            s.close()
        except Exception:
            pass


def _status_url() -> str:
    return "http://127.0.0.1:{}/_control/status".format(CONTROL_PORT)


def _read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json_atomic(path: str, payload: Dict[str, Any]) -> None:
    folder = os.path.dirname(path)
    if folder and not os.path.exists(folder):
        os.makedirs(folder)
    temp_path = path + ".tmp"
    with open(temp_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2)
    if os.name == "nt":
        if os.path.exists(path):
            os.remove(path)
    os.replace(temp_path, path)


def _get_project_id(project_path: str, project_name: str) -> str:
    key = project_path if project_path else "UNSAVED:{}".format(project_name or "Untitled")
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def _preset_key_from_name(name: str) -> str:
    return str(name or "").strip().lower()


def _make_preset_id() -> str:
    return str(uuid.uuid4())


def ensure_project_cfg(projects: Dict[str, Any], project_id: str, project_name: str) -> Dict[str, Any]:
    if project_id not in projects:
        projects[project_id] = {
            "projectId": project_id,
            "projectName": project_name or "Untitled",
            "users": ["main", "mon1", "mon2"],
            "admin": "main",
            "assignments": {
                "main": {"all": True, "guids": []},
                "mon1": {"all": False, "guids": []},
                "mon2": {"all": False, "guids": []},
            },
            "ui": {"showColorFooter": True, "footerIntensity": 0.35},
            "presets": {},
        }

    cfg = projects[project_id]
    if "users" not in cfg:
        cfg["users"] = ["main", "mon1", "mon2"]
    if "admin" not in cfg:
        cfg["admin"] = "main"
    if "assignments" not in cfg:
        cfg["assignments"] = {
            "main": {"all": True, "guids": []},
            "mon1": {"all": False, "guids": []},
            "mon2": {"all": False, "guids": []},
        }
    if "ui" not in cfg:
        cfg["ui"] = {"showColorFooter": True, "footerIntensity": 0.35}
    if "presets" not in cfg:
        cfg["presets"] = {}
    if not isinstance(cfg["ui"].get("showColorFooter"), bool):
        cfg["ui"]["showColorFooter"] = True
    return cfg


def allowed_guids_for(user: str, cfg: Dict[str, Any]) -> Optional[Set[str]]:
    if not user:
        return set()
    if user == cfg["admin"] or user == "main" or cfg["assignments"].get(user, {}).get("all"):
        return None
    guids = cfg["assignments"].get(user, {}).get("guids", [])
    return set(guids if isinstance(guids, list) else [])


def expand_with_parents(tracks: List[Dict[str, Any]], allowed_set: Set[str]) -> Set[str]:
    parents_by_depth = []
    include = set(allowed_set)
    for track in tracks:
        depth = int(track.get("indent", 0) or 0)
        parents_by_depth = parents_by_depth[:depth]
        if track.get("guid") in include:
            for parent in parents_by_depth:
                include.add(parent["guid"])
        if int(track.get("folderDepth", 0) or 0) > 0:
            if depth < len(parents_by_depth):
                parents_by_depth[depth] = {"guid": track.get("guid")}
            else:
                parents_by_depth.append({"guid": track.get("guid")})
    return include


def filter_state_for(ws: "WebSocketClient", state: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    user = getattr(ws, "user", "")
    if not user:
        return {
            "type": "state",
            "master": None,
            "tracks": [],
            "projectName": state.get("projectName"),
            "projectPath": state.get("projectPath"),
            "transport": state.get("transport"),
            "ts": state.get("ts"),
            "version": state.get("version"),
        }
    if user == cfg["admin"] or user == "main" or cfg["assignments"].get(user, {}).get("all"):
        return state
    allowed = allowed_guids_for(user, cfg)
    expanded = expand_with_parents(state.get("tracks") or [], allowed or set())
    tracks = [t for t in state.get("tracks") or [] if t.get("guid") in expanded]
    filtered = dict(state)
    filtered["master"] = None
    filtered["tracks"] = tracks
    return filtered


def filter_meter_for(ws: "WebSocketClient", meter: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    user = getattr(ws, "user", "")
    if not user:
        filtered = dict(meter)
        filtered["frames"] = []
        return filtered
    if user == cfg["admin"] or user == "main" or cfg["assignments"].get(user, {}).get("all"):
        return meter
    allowed = allowed_guids_for(user, cfg)
    frames = [f for f in meter.get("frames") or [] if allowed and f.get("guid") in allowed]
    filtered = dict(meter)
    filtered["frames"] = frames
    return filtered


def can_control(ws: "WebSocketClient", guid: str, cfg: Dict[str, Any]) -> bool:
    user = getattr(ws, "user", "")
    if not user:
        return False
    if user == cfg["admin"] or user == "main" or cfg["assignments"].get(user, {}).get("all"):
        return True
    allowed = allowed_guids_for(user, cfg)
    return bool(allowed and guid in allowed)


class RingBufferHandler(logging.Handler):
    def __init__(self, buffer: deque):
        super().__init__()
        self.buffer = buffer

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        self.buffer.append(msg)


def _setup_logger(buffer: deque) -> logging.Logger:
    logger = logging.getLogger("rm-daemon")
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    file_handler = logging.FileHandler(_log_path(), encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    buffer_handler = RingBufferHandler(buffer)
    buffer_handler.setFormatter(formatter)
    logger.addHandler(buffer_handler)
    return logger


async def run_daemon() -> None:
    try:
        import aiohttp
        from aiohttp import web
    except Exception as exc:
        show_user_error(
            "aiohttp not installed: {}\nInstall: {} -m pip install aiohttp".format(
                exc, sys.executable
            )
        )
        return

    log_buffer: deque = deque(maxlen=LOG_BUFFER_MAX)
    logger = _setup_logger(log_buffer)
    last_error: Dict[str, Optional[str]] = {"value": None}

    projects = _read_json(_projects_path())
    current_project_id = None
    current_project_name = "Untitled"
    current_project_path = ""
    last_state = None
    last_meter = None

    ws_clients: Set[web.WebSocketResponse] = set()
    reaper_writer: Optional[asyncio.StreamWriter] = None

    def _write_projects() -> None:
        _write_json_atomic(_projects_path(), projects)

    def _broadcast_project_info() -> None:
        if not current_project_id:
            return
        cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
        payload = {
            "type": "projectInfo",
            "projectId": current_project_id,
            "projectName": current_project_name,
            "users": cfg["users"],
            "admin": cfg["admin"],
            "ui": cfg["ui"],
            "assignments": {
                "mon1": cfg["assignments"]["mon1"]["guids"],
                "mon2": cfg["assignments"]["mon2"]["guids"],
            },
        }
        for ws in list(ws_clients):
            asyncio.create_task(ws.send_str(json.dumps(payload)))

    def _send_to_reaper(msg: Dict[str, Any]) -> None:
        nonlocal reaper_writer
        if not reaper_writer:
            logger.warning("reaperSock not connected; dropping command: %s", msg.get("type"))
            return
        try:
            reaper_writer.write((json.dumps(msg) + "\n").encode("utf-8"))
        except Exception as exc:
            logger.error("Failed sending to REAPER: %s", exc)

    async def handle_ws(request: web.Request) -> web.WebSocketResponse:
        nonlocal last_state
        # WebSocket compatibility:
        # - Disable permessage-deflate compression (some embedded/older WebViews fail the negotiation).
        # - Enable heartbeat pings to keep connections alive behind NAT/proxies.
        ws = web.WebSocketResponse(compress=False, heartbeat=15)
        await ws.prepare(request)
        ws.user = "main"
        ws._last_meter_sent = 0.0
        ws_clients.add(ws)

        if current_project_id:
            cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
            await ws.send_str(
                json.dumps(
                    {
                        "type": "projectInfo",
                        "projectId": current_project_id,
                        "projectName": current_project_name,
                        "users": cfg["users"],
                        "admin": cfg["admin"],
                        "ui": cfg["ui"],
                        "assignments": {
                            "mon1": cfg["assignments"]["mon1"]["guids"],
                            "mon2": cfg["assignments"]["mon2"]["guids"],
                        },
                    }
                )
            )

        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except Exception:
                continue
            if not isinstance(data, dict) or "type" not in data:
                continue

            msg_type = data.get("type")
            if msg_type == "reqProjectInfo":
                _broadcast_project_info()
                continue
            if msg_type == "setUser":
                ws.user = "main"
                continue
            if msg_type == "reqState":
                if last_state:
                    cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                    await ws.send_str(json.dumps(filter_state_for(ws, last_state, cfg)))
                continue
            if msg_type == "setUi":
                if not current_project_id:
                    continue
                cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                if ws.user != cfg["admin"]:
                    continue
                ui = data.get("ui")
                if isinstance(ui, dict):
                    if isinstance(ui.get("showColorFooter"), bool):
                        cfg["ui"]["showColorFooter"] = ui["showColorFooter"]
                    if isinstance(ui.get("footerIntensity"), (int, float)):
                        v = float(ui["footerIntensity"])
                        cfg["ui"]["footerIntensity"] = v if v in (0.25, 0.35, 0.45) else 0.35
                _write_projects()
                _broadcast_project_info()
                continue
            if msg_type == "adminSetAssignments":
                if not current_project_id:
                    continue
                cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                if ws.user != cfg["admin"]:
                    continue
                target = str(data.get("target") or "")
                guids = data.get("guids")
                guids = [str(g) for g in guids] if isinstance(guids, list) else []
                if target not in cfg["assignments"]:
                    cfg["assignments"][target] = {"all": False, "guids": []}
                cfg["assignments"][target]["all"] = False
                cfg["assignments"][target]["guids"] = guids
                _write_projects()
                _broadcast_project_info()
                for client in list(ws_clients):
                    await client.send_str(json.dumps({"type": "assignments"}))
                if last_state:
                    for client in list(ws_clients):
                        await client.send_str(
                            json.dumps(filter_state_for(client, last_state, cfg))
                        )
                continue
            if msg_type == "reqFxPresets":
                if not current_project_id:
                    continue
                guid = str(data.get("guid") or "")
                cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                if not guid or not can_control(ws, guid, cfg):
                    continue
                fx_name = str(data.get("fxName") or "")
                key = _preset_key_from_name(fx_name)
                if not key:
                    continue
                presets = cfg.get("presets", {}).get(key, [])
                await ws.send_str(json.dumps({"type": "fxPresets", "fxName": fx_name, "presets": presets}))
                continue
            if msg_type == "saveFxPreset":
                if not current_project_id:
                    continue
                guid = str(data.get("guid") or "")
                cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                if not guid or not can_control(ws, guid, cfg):
                    continue
                fx_name = str(data.get("fxName") or "")
                key = _preset_key_from_name(fx_name)
                if not key:
                    continue
                raw_params = data.get("params")
                params = []
                if isinstance(raw_params, list):
                    for param in raw_params:
                        try:
                            idx = int(param.get("index"))
                            val = float(param.get("value"))
                            val = max(0.0, min(1.0, val))
                            params.append({"index": idx, "value": val})
                        except Exception:
                            continue
                name = str(data.get("name") or "Preset").strip() or "Preset"
                preset = {"id": _make_preset_id(), "name": name, "params": params}
                if "presets" not in cfg:
                    cfg["presets"] = {}
                preset_list = cfg["presets"].get(key, [])
                preset_list = [p for p in preset_list if str(p.get("name")) != name]
                preset_list.append(preset)
                cfg["presets"][key] = preset_list
                _write_projects()
                await ws.send_str(json.dumps({"type": "fxPresets", "fxName": fx_name, "presets": preset_list}))
                continue
            if msg_type == "deleteFxPreset":
                if not current_project_id:
                    continue
                guid = str(data.get("guid") or "")
                cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                if not guid or not can_control(ws, guid, cfg):
                    continue
                fx_name = str(data.get("fxName") or "")
                key = _preset_key_from_name(fx_name)
                if not key:
                    continue
                preset_id = str(data.get("presetId") or "")
                preset_list = cfg.get("presets", {}).get(key, [])
                preset_list = [p for p in preset_list if str(p.get("id")) != preset_id]
                cfg["presets"][key] = preset_list
                _write_projects()
                await ws.send_str(json.dumps({"type": "fxPresets", "fxName": fx_name, "presets": preset_list}))
                continue

            needs_guid = {
                "setVol",
                "setPan",
                "setMute",
                "setSolo",
                "setRec",
                "setRecInput",
                "setFxEnabled",
                "setFxAllEnabled",
                "deleteFx",
                "setFxParam",
                "addFx",
                "moveFx",
                "showFxChain",
                "reqFxList",
                "reqFxParams",
                "setSendVol",
                "setSendMute",
                "setSendMode",
                "setSendSrcChan",
                "setSendDstChan",
                "addSend",
                "setRecvVol",
                "setRecvMute",
                "setRecvSrcChan",
                "setRecvDstChan",
                "addReturn",
                "renameTrack",
                "setTrackColor",
                "moveTrack",
                "createFolderWithTrack",
                "moveTrackToFolder",
                "deleteTrack",
                "setSpacer",
            }

            if msg_type in needs_guid:
                guid = str(data.get("guid") or "")
                if not guid:
                    continue
                cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                if guid in ("MASTER", "{MASTER}"):
                    if ws.user != cfg["admin"]:
                        continue
                elif not can_control(ws, guid, cfg):
                    continue

            _send_to_reaper(data)

        ws_clients.discard(ws)
        return ws

    async def handle_reaper(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal reaper_writer, current_project_id, current_project_name, current_project_path
        nonlocal last_state, last_meter
        if reaper_writer:
            try:
                reaper_writer.close()
            except Exception:
                pass
        reaper_writer = writer
        logger.info("REAPER connected via TCP")
        buffer = ""
        try:
            while not reader.at_eof():
                data = await reader.read(65536)
                if not data:
                    break
                buffer += data.decode("utf-8", "replace")
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line)
                    except Exception:
                        continue
                    if not isinstance(msg, dict) or "type" not in msg:
                        continue

                    if msg["type"] == "state":
                        p_name = msg.get("projectName") or "Untitled"
                        p_path = msg.get("projectPath") or ""
                        pid = _get_project_id(p_path, p_name)
                        changed = pid != current_project_id
                        current_project_id = pid
                        current_project_name = p_name
                        current_project_path = p_path
                        cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                        cfg["projectName"] = current_project_name
                        projects[current_project_id] = cfg
                        if changed:
                            _broadcast_project_info()
                        last_state = msg
                        for ws in list(ws_clients):
                            await ws.send_str(json.dumps(filter_state_for(ws, msg, cfg)))
                        continue

                    if msg["type"] == "meter":
                        last_meter = msg
                        cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                        now_ms = time.time() * 1000.0
                        for ws in list(ws_clients):
                            buf_size = ws._writer.transport.get_write_buffer_size()
                            if buf_size > METER_BUFFER_LIMIT:
                                continue
                            if now_ms - getattr(ws, "_last_meter_sent", 0.0) < METER_THROTTLE_MS:
                                continue
                            ws._last_meter_sent = now_ms
                            await ws.send_str(json.dumps(filter_meter_for(ws, msg, cfg)))
                        continue

                    if msg["type"] == "fxList":
                        cfg = ensure_project_cfg(projects, current_project_id, current_project_name)
                        for ws in list(ws_clients):
                            if ws.user == cfg["admin"]:
                                await ws.send_str(json.dumps(msg))
                            elif can_control(ws, msg.get("guid") or "", cfg):
                                await ws.send_str(json.dumps(msg))
                        continue

                    for ws in list(ws_clients):
                        await ws.send_str(json.dumps(msg))
        except Exception as exc:
            logger.error("TCP error: %s", exc)
            last_error["value"] = str(exc)
        finally:
            logger.info("REAPER TCP disconnected")
            try:
                writer.close()
            except Exception:
                pass
            if reaper_writer is writer:
                reaper_writer = None

    def _status_payload(https_enabled: bool) -> Dict[str, Any]:
        lan_ip = _lan_ip()
        scheme = "https" if https_enabled else "http"
        return {
            "running": True,
            "web_port": WEB_PORT,
            "tcp_port": TCP_PORT,
            "https": https_enabled,
            "urls": ["{}://{}:{}".format(scheme, lan_ip, WEB_PORT)],
            "pid": os.getpid(),
            "last_error": last_error["value"],
        }

    def _status_plain_text(payload: Dict[str, Any]) -> str:
        url = ""
        urls = payload.get("urls") or []
        if urls:
            url = urls[0]
        lines = [
            "running=1",
            "pid={}".format(payload.get("pid") or ""),
            "https={}".format(1 if payload.get("https") else 0),
            "web_port={}".format(payload.get("web_port") or ""),
            "tcp_port={}".format(payload.get("tcp_port") or ""),
            "url={}".format(url),
            "last_error={}".format(payload.get("last_error") or ""),
        ]
        return "\n".join(lines)

    async def handle_status(request: web.Request) -> web.Response:
        payload = _status_payload(request.app.get("https_enabled", False))
        return web.json_response(payload)

    async def handle_status_txt(request: web.Request) -> web.Response:
        payload = _status_payload(request.app.get("https_enabled", False))
        return web.Response(text=_status_plain_text(payload), content_type="text/plain")

    async def handle_logs(request: web.Request) -> web.Response:
        tail = int(request.query.get("tail", "200") or 200)
        lines = list(log_buffer)[-tail:]
        return web.json_response({"lines": lines})

    async def handle_logs_txt(request: web.Request) -> web.Response:
        tail = int(request.query.get("tail", "200") or 200)
        lines = list(log_buffer)[-tail:]
        return web.Response(text="\n".join(lines), content_type="text/plain")

    async def _shutdown(app: web.Application) -> None:
        for ws in list(ws_clients):
            with contextlib.suppress(Exception):
                await ws.close()

    async def handle_stop(request: web.Request) -> web.Response:
        request.app["shutdown_event"].set()
        return web.json_response({"ok": True})

    async def handle_restart(request: web.Request) -> web.Response:
        request.app["restart_event"].set()
        request.app["shutdown_event"].set()
        return web.json_response({"ok": True})

    async def handle_index(request: web.Request) -> web.FileResponse:
        return web.FileResponse(os.path.join(_public_root(), "index.html"))

    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_get("/ws", handle_ws)
    app.router.add_static("/", _public_root(), show_index=False)
    app.on_shutdown.append(_shutdown)
    app["https_enabled"] = False

    control_app = web.Application()
    control_app.router.add_get("/_control/status", handle_status)
    control_app.router.add_get("/_control/status.txt", handle_status_txt)
    control_app.router.add_post("/_control/stop", handle_stop)
    control_app.router.add_post("/_control/restart", handle_restart)
    control_app.router.add_get("/_control/logs", handle_logs)
    control_app.router.add_get("/_control/logs.txt", handle_logs_txt)
    control_app["shutdown_event"] = asyncio.Event()
    control_app["restart_event"] = asyncio.Event()
    control_app["https_enabled"] = False

    key_path, cert_path = _ssl_paths()
    ssl_context = None
    if os.path.exists(key_path) and os.path.exists(cert_path) and os.getenv("RM_FORCE_HTTP") != "1":
        import ssl

        ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ssl_context.load_cert_chain(cert_path, key_path)
        app["https_enabled"] = True
        control_app["https_enabled"] = True

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", WEB_PORT, ssl_context=ssl_context)
    await site.start()
    logger.info("Web UI (%s) listening on 0.0.0.0:%s", "HTTPS" if ssl_context else "HTTP", WEB_PORT)

    control_runner = web.AppRunner(control_app)
    await control_runner.setup()
    control_site = web.TCPSite(control_runner, "127.0.0.1", CONTROL_PORT)
    await control_site.start()
    logger.info("Control API listening on 127.0.0.1:%s", CONTROL_PORT)

    tcp_server = await asyncio.start_server(handle_reaper, "127.0.0.1", TCP_PORT)
    logger.info("TCP (ReaScript) listening on 127.0.0.1:%s", TCP_PORT)

    await control_app["shutdown_event"].wait()

    if control_app["restart_event"].is_set():
        spawn_args = [_pythonw_executable(), _script_path(), "--daemon"]
        try:
            log_file = _open_log_file()
            subprocess.Popen(
                spawn_args,
                stdout=log_file,
                stderr=log_file,
                env=_build_env(),
                **_detached_popen_args()
            )
        except Exception as exc:
            logger.error("Failed to restart daemon: %s", exc)

    tcp_server.close()
    await tcp_server.wait_closed()
    await runner.cleanup()
    await control_runner.cleanup()


def run_controller() -> None:
    status_code, _ = _http_get(_status_url())
    if status_code != 200:
        spawn_daemon()
    show_user_error("Launcher UI is now inside REAPER. Run RemoteMixer.py to open it.")


def _print_status_payload(running: bool, payload: Optional[str] = None) -> None:
    if payload:
        print(payload)
        return
    print(
        json.dumps(
            {
                "running": running,
                "web_port": WEB_PORT,
                "tcp_port": TCP_PORT,
                "https": False,
                "url": "http://127.0.0.1:{}".format(WEB_PORT),
                "last_error": "",
            }
        )
    )


def _print_logs(text: str) -> None:
    print(text.rstrip("\n"))


def run_command(command: str, tail: int) -> None:
    command = (command or "").strip().lower()
    if command == "status":
        status_code, body = _http_get(_status_url())
        if status_code == 200:
            _print_status_payload(True, body)
        else:
            _print_status_payload(False)
        return
    if command == "start":
        status_code, _ = _http_get(_status_url())
        if status_code != 200:
            spawn_daemon()
        for _ in range(10):
            status_code, body = _http_get(_status_url())
            if status_code == 200:
                _print_status_payload(True, body)
                return
            time.sleep(0.2)
        _print_status_payload(False)
        return
    if command == "stop":
        _http_post("http://127.0.0.1:{}/_control/stop".format(CONTROL_PORT))
        _print_status_payload(False)
        return
    if command == "restart":
        _http_post("http://127.0.0.1:{}/_control/restart".format(CONTROL_PORT))
        for _ in range(10):
            status_code, body = _http_get(_status_url())
            if status_code == 200:
                _print_status_payload(True, body)
                return
            time.sleep(0.2)
        _print_status_payload(False)
        return
    if command == "logs":
        status_code, body = _http_get(
            "http://127.0.0.1:{}/_control/logs.txt?tail={}".format(CONTROL_PORT, tail)
        )
        if status_code == 200 and body:
            _print_logs(body)
        else:
            _print_logs("(no logs; daemon not running)")
        return
    if command:
        _print_logs("Unknown command: {}".format(command))


def spawn_daemon() -> None:
    cmd = [_pythonw_executable(), _script_path(), "--daemon"]
    log_file = _open_log_file()
    try:
        subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=log_file,
            env=_build_env(),
            **_detached_popen_args()
        )
    except Exception:
        try:
            log_file.close()
        except Exception:
            pass


def spawn_gui() -> None:
    cmd = [_pythonw_executable(), _script_path(), "--gui"]
    log_file = _open_log_file()
    try:
        subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=log_file,
            env=_build_env(),
            **_detached_popen_args()
        )
    except Exception:
        try:
            log_file.close()
        except Exception:
            pass


def run_gui() -> None:
    show_user_error("External GUI is deprecated. Run RemoteMixer.py in REAPER for the UI.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--gui", action="store_true")
    parser.add_argument("command", nargs="?", default="")
    parser.add_argument("--tail", type=int, default=200)
    args = parser.parse_args()

    if args.daemon:
        try:
            asyncio.run(run_daemon())
        except Exception as exc:
            logging.basicConfig(level=logging.INFO)
            logging.exception("Daemon failed: %s", exc)
        return

    if args.gui:
        run_gui()
        return

    if args.command:
        run_command(args.command, args.tail)
        return

    run_controller()


if __name__ == "__main__":
    main()
