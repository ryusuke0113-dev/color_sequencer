"""schedule のデータ構造と、RUN / STOP / SWITCH などの操作ルール。

Flask やデータベースに依存しない純粋な処理だけを置く。
"""

import re

PAD_COUNT = 12
PAD_MS = 500
LOOP_MS = PAD_MS * PAD_COUNT
RUN_LEAD_MS = 2000

SMPTE = "SMPTE"

# SMPTEカラーバーの色を左上から順に並べたもの。12番目はカラーバーそのもの。
DEFAULT_PALETTE = [
    "#C0C0C0",
    "#C0C000",
    "#00C0C0",
    "#00C000",
    "#C000C0",
    "#C00000",
    "#0000C0",
    "#00214C",
    "#FFFFFF",
    "#32006A",
    "#131313",
    SMPTE,
]

COLOR_PATTERN = re.compile(r"^#[0-9A-F]{6}$")


def new_schedule():
    return {
        "version": 1,
        "state": "stop",
        "t0": None,
        "colors": [None] * PAD_COUNT,
        "temp_colors": [None] * PAD_COUNT,
        "prev_colors": None,
        "palette": list(DEFAULT_PALETTE),
    }


def public_view(schedule):
    """audience に渡す項目だけを取り出す。"""
    return {
        "version": schedule["version"],
        "state": schedule["state"],
        "t0": schedule["t0"],
        "colors": schedule["colors"],
        "prev_colors": schedule["prev_colors"],
    }


def normalize_pad_value(value):
    """パッド1つ分の値を検証し、正しい形にして返す。不正なら ValueError。"""
    if value is None or value == SMPTE:
        return value
    if isinstance(value, str) and COLOR_PATTERN.match(value.upper()):
        return value.upper()
    raise ValueError(f"パッドの値が不正です: {value!r}")


def normalize_pad_list(values):
    if not isinstance(values, list) or len(values) != PAD_COUNT:
        raise ValueError(f"パッドの値は{PAD_COUNT}個のリストで送ってください")
    return [normalize_pad_value(v) for v in values]


def _require_ms(value, name):
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{name} はミリ秒の整数で送ってください")
    return value


def apply_run(schedule, t0):
    t0 = _require_ms(t0, "t0")
    if t0 % PAD_MS != 0:
        raise ValueError("t0 は0.5秒単位に揃えてください")
    schedule["state"] = "run"
    schedule["t0"] = t0
    schedule["prev_colors"] = None


def apply_stop(schedule):
    schedule["state"] = "stop"
    schedule["t0"] = None
    schedule["prev_colors"] = None


def apply_switch(schedule, t0):
    """本アサインと仮アサインを入れ替え、新しい t0 から有効にする。"""
    t0 = _require_ms(t0, "t0")
    if schedule["state"] != "run":
        raise ValueError("SWITCHはRUN中だけ使えます")
    if all(v is None for v in schedule["temp_colors"]):
        raise ValueError("仮アサインがありません")
    current_t0 = schedule["t0"]
    if t0 <= current_t0 or (t0 - current_t0) % LOOP_MS != 0:
        raise ValueError("新しい t0 はループの切れ目にしてください")

    schedule["prev_colors"] = list(schedule["colors"])
    for i in range(PAD_COUNT):
        temp = schedule["temp_colors"][i]
        if temp is not None:
            schedule["temp_colors"][i] = schedule["colors"][i]
            schedule["colors"][i] = temp
    schedule["t0"] = t0


def apply_pads(schedule, colors, temp_colors):
    """パッドの色を更新する。RUN中は本アサインを変えず、仮アサインだけ受け付ける。"""
    if temp_colors is not None:
        schedule["temp_colors"] = normalize_pad_list(temp_colors)
    if colors is not None and schedule["state"] != "run":
        schedule["colors"] = normalize_pad_list(colors)


def apply_palette(schedule, palette):
    if not isinstance(palette, list) or len(palette) != PAD_COUNT:
        raise ValueError(f"パレットは{PAD_COUNT}色のリストで送ってください")
    colors = [normalize_pad_value(v) for v in palette[: PAD_COUNT - 1]]
    if any(v is None or v == SMPTE for v in colors):
        raise ValueError("パレット1〜11番はカラーコードにしてください")
    schedule["palette"] = colors + [SMPTE]
