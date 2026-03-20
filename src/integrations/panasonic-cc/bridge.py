#!/usr/bin/env python3
"""
Winch — Panasonic Comfort Cloud bridge.
Thin CLI wrapper around aio-panasonic-comfort-cloud.
Called by Node.js via child_process.execFile.
All output is JSON to stdout.
"""

import argparse
import asyncio
import json
import sys

try:
    import aiohttp
    import aio_panasonic_comfort_cloud as pcc
    from aio_panasonic_comfort_cloud import constants
except ImportError:
    print(json.dumps({
        "ok": False,
        "error": "Python package 'aio-panasonic-comfort-cloud' not installed. "
                 "Activate the venv and run: pip install aio-panasonic-comfort-cloud"
    }))
    sys.exit(0)


# ============================================================
# Enum conversions (numeric → string, string → numeric)
# ============================================================

POWER_MAP = {0: "off", 1: "on"}
POWER_MAP_REV = {v: k for k, v in POWER_MAP.items()}

MODE_MAP = {0: "auto", 1: "dry", 2: "cool", 3: "heat", 4: "fan"}
MODE_MAP_REV = {v: k for k, v in MODE_MAP.items()}

FAN_SPEED_MAP = {0: "auto", 1: "low", 2: "lowMid", 3: "mid", 4: "highMid", 5: "high"}
FAN_SPEED_MAP_REV = {v: k for k, v in FAN_SPEED_MAP.items()}

SWING_UD_MAP = {-1: "auto", 0: "up", 1: "down", 2: "mid", 3: "upMid", 4: "downMid", 5: "swing"}
SWING_UD_MAP_REV = {v: k for k, v in SWING_UD_MAP.items()}

SWING_LR_MAP = {-1: "auto", 0: "right", 1: "left", 2: "mid", 4: "rightMid", 5: "leftMid", 6: "unavailable"}
SWING_LR_MAP_REV = {v: k for k, v in SWING_LR_MAP.items()}

ECO_MODE_MAP = {0: "auto", 1: "powerful", 2: "quiet"}
ECO_MODE_MAP_REV = {v: k for k, v in ECO_MODE_MAP.items()}

NANOE_MAP = {0: "unavailable", 1: "off", 2: "on", 3: "modeG", 4: "all"}
NANOE_MAP_REV = {v: k for k, v in NANOE_MAP.items()}

INVALID_TEMPERATURE = 126


def safe_temp(val):
    """Return temperature or None if invalid."""
    if val is None or val == INVALID_TEMPERATURE:
        return None
    return val


def enum_to_str(mapping, val):
    """Convert enum to string using its .value attribute."""
    if val is None:
        return None
    try:
        return mapping.get(val.value, str(val.value))
    except AttributeError:
        if isinstance(val, int):
            return mapping.get(val, str(val))
        return str(val)


# ============================================================
# Session context manager
# ============================================================

from contextlib import asynccontextmanager

MAX_RETRIES = 2
RETRY_DELAYS = [2, 5]  # seconds


async def _flush_token_file(client):
    """Ensure any pending token save is flushed to disk before process exits.

    The lib uses asyncio.ensure_future() for saves (fire-and-forget).
    We drain pending tasks so the refreshed token is persisted."""
    # Give pending asyncio tasks a chance to complete (token file writes)
    await asyncio.sleep(0.1)
    # Also await any remaining tasks in the event loop
    pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


@asynccontextmanager
async def open_session(email, password, token_file):
    """Create, authenticate, and yield a Panasonic CC client. Always closes the HTTP session."""
    http_session = aiohttp.ClientSession()
    client = None
    try:
        client = pcc.ApiClient(email, password, http_session, token_file_name=token_file)
        last_error = None
        for attempt in range(1 + MAX_RETRIES):
            try:
                await client.start_session()
                last_error = None
                break
            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAYS[attempt])
        if last_error is not None:
            raise last_error
        yield client
    finally:
        if client is not None:
            await _flush_token_file(client)
        await http_session.close()


# ============================================================
# Commands
# ============================================================

async def cmd_login(args):
    """Login and verify credentials."""
    async with open_session(args.email, args.password, args.token_file) as client:
        # get_devices() is sync — returns cached PanasonicDeviceInfo list
        device_infos = client.get_devices()
        return {
            "ok": True,
            "deviceCount": len(device_infos) if device_infos else 0,
        }


async def cmd_get_devices(args):
    """Get all devices with current status."""
    async with open_session(args.email, args.password, args.token_file) as client:
        device_infos = client.get_devices()
        result_devices = []
        for info in (device_infos or []):
            # get_device() is async — fetches live parameters from cloud
            dev = await client.get_device(info)
            device_data = format_device(dev)
            result_devices.append(device_data)
        return {"ok": True, "devices": result_devices}


async def cmd_get_device(args):
    """Get single device status by guid."""
    async with open_session(args.email, args.password, args.token_file) as client:
        device_infos = client.get_devices()
        target_info = None
        for info in (device_infos or []):
            if info.id == args.id or info.guid == args.id:
                target_info = info
                break
        if not target_info:
            return {"ok": False, "error": f"Device {args.id} not found"}
        dev = await client.get_device(target_info)
        return {"ok": True, "device": format_device(dev)}


async def cmd_control(args):
    """Send a control command to a device."""
    async with open_session(args.email, args.password, args.token_file) as client:
        device_infos = client.get_devices()
        target_info = None
        for info in (device_infos or []):
            if info.id == args.id or info.guid == args.id:
                target_info = info
                break
        if not target_info:
            return {"ok": False, "error": f"Device {args.id} not found"}

        kwargs = {}
        param = args.param
        value = args.value

        if param == "power":
            if value in ("true", "on"):
                kwargs["power"] = constants.Power.On
            else:
                kwargs["power"] = constants.Power.Off
        elif param == "mode":
            kwargs["mode"] = constants.OperationMode(MODE_MAP_REV.get(value, int(value)))
        elif param == "targetTemperature":
            kwargs["temperature"] = float(value)
        elif param == "fanSpeed":
            kwargs["fanSpeed"] = constants.FanSpeed(FAN_SPEED_MAP_REV.get(value, int(value)))
        elif param == "airSwingUD":
            kwargs["airSwingVertical"] = constants.AirSwingUD(SWING_UD_MAP_REV.get(value, int(value)))
        elif param == "airSwingLR":
            kwargs["airSwingHorizontal"] = constants.AirSwingLR(SWING_LR_MAP_REV.get(value, int(value)))
        elif param == "ecoMode":
            kwargs["eco"] = constants.EcoMode(ECO_MODE_MAP_REV.get(value, int(value)))
        elif param == "nanoe":
            kwargs["nanoe"] = constants.NanoeMode(NANOE_MAP_REV.get(value, int(value)))
        else:
            return {"ok": False, "error": f"Unknown parameter: {param}"}

        await client.set_device(target_info, **kwargs)
        return {"ok": True}


def format_device(dev):
    """Format a PanasonicDevice object into our JSON structure."""
    info = dev.info
    dev_id = info.id or ""
    name = info.name or ""
    group = info.group or ""
    model = info.model or ""

    p = dev.parameters
    params = {
        "power": enum_to_str(POWER_MAP, p.power),
        "mode": enum_to_str(MODE_MAP, p.mode),
        "targetTemperature": safe_temp(p.target_temperature),
        "insideTemperature": safe_temp(p.inside_temperature),
        "outsideTemperature": safe_temp(p.outside_temperature),
        "fanSpeed": enum_to_str(FAN_SPEED_MAP, p.fan_speed),
        "airSwingUD": enum_to_str(SWING_UD_MAP, p.vertical_swing_mode),
        "airSwingLR": enum_to_str(SWING_LR_MAP, p.horizontal_swing_mode),
        "ecoMode": enum_to_str(ECO_MODE_MAP, p.eco_mode),
        "nanoe": enum_to_str(NANOE_MAP, p.nanoe_mode),
    }

    f = dev.features
    features = {
        "nanoe": f.nanoe,
        "autoMode": f.auto_mode,
        "heatMode": f.heat_mode,
        "dryMode": f.dry_mode,
        "coolMode": f.cool_mode,
        "fanMode": f.fan_mode,
        "airSwingLR": f.air_swing_lr,
    }

    return {
        "id": str(dev_id),
        "name": name,
        "group": group,
        "model": model,
        "parameters": params,
        "features": features,
    }


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Panasonic Comfort Cloud bridge for Winch")
    parser.add_argument("command", choices=["login", "get_devices", "get_device", "control"])
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--id", help="Device ID/GUID (for get_device and control)")
    parser.add_argument("--param", help="Parameter name (for control)")
    parser.add_argument("--value", help="Value to set (for control)")

    args = parser.parse_args()

    try:
        result = asyncio.run(dispatch(args))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


async def dispatch(args):
    if args.command == "login":
        return await cmd_login(args)
    elif args.command == "get_devices":
        return await cmd_get_devices(args)
    elif args.command == "get_device":
        if not args.id:
            return {"ok": False, "error": "--id is required for get_device"}
        return await cmd_get_device(args)
    elif args.command == "control":
        if not args.id or not args.param or args.value is None:
            return {"ok": False, "error": "--id, --param, and --value are required for control"}
        return await cmd_control(args)
    else:
        return {"ok": False, "error": f"Unknown command: {args.command}"}


if __name__ == "__main__":
    main()
