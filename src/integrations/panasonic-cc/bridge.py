#!/usr/bin/env python3
"""
Corbel — Panasonic Comfort Cloud bridge.
Thin CLI wrapper around aio-panasonic-comfort-cloud.
Called by Node.js via child_process.execFile.
All output is JSON to stdout.
"""

import argparse
import asyncio
import json
import sys
import traceback

try:
    import pcomfortcloud
except ImportError:
    print(json.dumps({"ok": False, "error": "Python package 'pcomfortcloud' not installed. Run: pip install aio-panasonic-comfort-cloud"}))
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

SWING_UD_MAP = {0: "up", 1: "down", 2: "mid", 3: "upMid", 4: "downMid"}
SWING_UD_MAP_REV = {v: k for k, v in SWING_UD_MAP.items()}

SWING_LR_MAP = {0: "left", 1: "right", 2: "mid", 3: "rightMid", 4: "leftMid"}
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
    """Convert numeric enum to string, or return str(val) as fallback."""
    if val is None:
        return None
    if isinstance(val, int):
        return mapping.get(val, str(val))
    # Already a string or enum object — try .value
    try:
        return mapping.get(val.value, str(val.value))
    except AttributeError:
        return str(val)


# ============================================================
# Session helper
# ============================================================

async def create_session(email, password, token_file):
    """Create and authenticate a pcomfortcloud session."""
    session = pcomfortcloud.ApiClient(email, password, token_file)
    await session.start_session()
    return session


# ============================================================
# Commands
# ============================================================

async def cmd_login(args):
    """Login and verify credentials."""
    session = await create_session(args.email, args.password, args.token_file)
    devices = await session.get_devices()
    result = {
        "ok": True,
        "deviceCount": len(devices) if devices else 0,
    }
    return result


async def cmd_get_devices(args):
    """Get all devices with current status."""
    session = await create_session(args.email, args.password, args.token_file)
    devices = await session.get_devices()

    result_devices = []
    for dev in (devices or []):
        device_data = format_device(dev)
        result_devices.append(device_data)

    return {"ok": True, "devices": result_devices}


async def cmd_get_device(args):
    """Get single device status."""
    session = await create_session(args.email, args.password, args.token_file)
    dev = await session.get_device(args.id)
    if not dev:
        return {"ok": False, "error": f"Device {args.id} not found"}
    return {"ok": True, "device": format_device(dev)}


async def cmd_control(args):
    """Send a control command to a device."""
    session = await create_session(args.email, args.password, args.token_file)

    kwargs = {}
    param = args.param
    value = args.value

    if param == "power":
        kwargs["power"] = pcomfortcloud.constants.Power(POWER_MAP_REV.get(value, int(value)))
    elif param == "mode":
        kwargs["operationMode"] = pcomfortcloud.constants.OperationMode(MODE_MAP_REV.get(value, int(value)))
    elif param == "targetTemperature":
        kwargs["temperature"] = float(value)
    elif param == "fanSpeed":
        kwargs["fanSpeed"] = pcomfortcloud.constants.FanSpeed(FAN_SPEED_MAP_REV.get(value, int(value)))
    elif param == "airSwingUD":
        kwargs["airSwingVertical"] = pcomfortcloud.constants.AirSwingUD(SWING_UD_MAP_REV.get(value, int(value)))
    elif param == "airSwingLR":
        kwargs["airSwingHorizontal"] = pcomfortcloud.constants.AirSwingLR(SWING_LR_MAP_REV.get(value, int(value)))
    elif param == "ecoMode":
        kwargs["eco"] = pcomfortcloud.constants.EcoMode(ECO_MODE_MAP_REV.get(value, int(value)))
    elif param == "nanoe":
        kwargs["nanoe"] = pcomfortcloud.constants.NanoeMode(NANOE_MAP_REV.get(value, int(value)))
    else:
        return {"ok": False, "error": f"Unknown parameter: {param}"}

    await session.set_device(args.id, **kwargs)
    return {"ok": True}


def format_device(dev):
    """Format a device object into our JSON structure."""
    params = dev.get("parameters", {}) if isinstance(dev, dict) else {}

    # Handle both dict and object-style access
    if not isinstance(dev, dict):
        # Object with attributes
        dev_id = getattr(dev, "id", None) or ""
        name = getattr(dev, "name", None) or ""
        group = getattr(dev, "group", None) or ""
        model = getattr(dev, "model", None) or ""

        p = getattr(dev, "parameters", None)
        if p is not None and not isinstance(p, dict):
            # Parameters object
            params = {
                "power": enum_to_str(POWER_MAP, getattr(p, "power", None)),
                "mode": enum_to_str(MODE_MAP, getattr(p, "operationMode", None)),
                "targetTemperature": safe_temp(getattr(p, "temperatureSet", None)),
                "insideTemperature": safe_temp(getattr(p, "insideTemperature", None)),
                "outsideTemperature": safe_temp(getattr(p, "outsideTemperature", None)),
                "fanSpeed": enum_to_str(FAN_SPEED_MAP, getattr(p, "fanSpeed", None)),
                "airSwingUD": enum_to_str(SWING_UD_MAP, getattr(p, "airSwingUD", None)),
                "airSwingLR": enum_to_str(SWING_LR_MAP, getattr(p, "airSwingLR", None)),
                "ecoMode": enum_to_str(ECO_MODE_MAP, getattr(p, "eco", None)),
                "nanoe": enum_to_str(NANOE_MAP, getattr(p, "nanoe", None)),
            }
        elif isinstance(p, dict):
            params = p

        features_obj = getattr(dev, "features", None)
        if features_obj is not None and not isinstance(features_obj, dict):
            features = {
                "nanoe": getattr(features_obj, "nanoe", False),
                "autoMode": getattr(features_obj, "autoMode", False),
                "heatMode": getattr(features_obj, "heatMode", False),
                "dryMode": getattr(features_obj, "dryMode", False),
                "coolMode": getattr(features_obj, "coolMode", False),
                "fanMode": getattr(features_obj, "fanMode", False),
                "airSwingLR": getattr(features_obj, "airSwingLR", False),
            }
        elif isinstance(features_obj, dict):
            features = features_obj
        else:
            features = {}
    else:
        # Dict style
        dev_id = dev.get("id", "")
        name = dev.get("name", "")
        group = dev.get("group", "")
        model = dev.get("model", "")
        features = dev.get("features", {})

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
    parser = argparse.ArgumentParser(description="Panasonic Comfort Cloud bridge for Corbel")
    parser.add_argument("command", choices=["login", "get_devices", "get_device", "control"])
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--id", help="Device ID/GUID (for get_device and control)")
    parser.add_argument("--param", help="Parameter name (for control)")
    parser.add_argument("--value", help="Value to set (for control)")

    args = parser.parse_args()

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        if args.command == "login":
            result = loop.run_until_complete(cmd_login(args))
        elif args.command == "get_devices":
            result = loop.run_until_complete(cmd_get_devices(args))
        elif args.command == "get_device":
            if not args.id:
                result = {"ok": False, "error": "--id is required for get_device"}
            else:
                result = loop.run_until_complete(cmd_get_device(args))
        elif args.command == "control":
            if not args.id or not args.param or args.value is None:
                result = {"ok": False, "error": "--id, --param, and --value are required for control"}
            else:
                result = loop.run_until_complete(cmd_control(args))
        else:
            result = {"ok": False, "error": f"Unknown command: {args.command}"}

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
