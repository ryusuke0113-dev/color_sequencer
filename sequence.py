"""schedule のデータ構造と、RUN / STOP / SWITCH などの操作ルール。

Flask やデータベースに依存しない純粋な処理だけを置く。
"""

import re
import secrets

PAD_COUNT = 12
PAGE_COUNT = 3
PAD_MS = 500
LOOP_MS = PAD_MS * PAD_COUNT
RUN_LEAD_MS = 2000
FADE_STAGES = 6

SMPTE = "SMPTE"
FADE_NONE = "none"
FADE_OUT = "fade_out"
FADE_IN = "fade_in"
FADE_MODES = {FADE_NONE, FADE_OUT, FADE_IN}

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


def _empty_page(audience_id=None):
    return {
        "audience_id": audience_id or secrets.token_urlsafe(8),
        "switch_lock": False,
        "colors": [None] * PAD_COUNT,
        "temp_colors": [None] * PAD_COUNT,
        "prev_colors": None,
        "fades": [FADE_NONE] * PAD_COUNT,
        "prev_fades": None,
    }


def new_schedule(audience_ids=None):
    if audience_ids is None:
        audience_ids = [secrets.token_urlsafe(8) for _ in range(PAGE_COUNT)]
    while len(audience_ids) < PAGE_COUNT:
        audience_ids.append(secrets.token_urlsafe(8))
    return {
        "version": 1,
        "state": "stop",
        "t0": None,
        "pages": [_empty_page(audience_ids[i]) for i in range(PAGE_COUNT)],
        "palette": list(DEFAULT_PALETTE),
    }


def ensure_schedule(schedule):
    """古い1ページ形式の schedule を3ページ形式に直す。"""
    if "pages" not in schedule:
        old_id = schedule.get("audience_id")
        page = _empty_page(old_id)
        page["colors"] = schedule.get("colors") or [None] * PAD_COUNT
        page["temp_colors"] = schedule.get("temp_colors") or [None] * PAD_COUNT
        page["prev_colors"] = schedule.get("prev_colors")
        fades = schedule.get("fades") or [FADE_NONE] * PAD_COUNT
        if len(fades) != PAD_COUNT:
            fades = [FADE_NONE] * PAD_COUNT
        page["fades"] = [v if v in FADE_MODES else FADE_NONE for v in fades]
        page["prev_fades"] = schedule.get("prev_fades")
        pages = [page]
        for _ in range(PAGE_COUNT - 1):
            pages.append(_empty_page())
        schedule["pages"] = pages
        for key in (
            "colors",
            "temp_colors",
            "prev_colors",
            "fades",
            "prev_fades",
            "audience_id",
        ):
            schedule.pop(key, None)

    while len(schedule["pages"]) < PAGE_COUNT:
        schedule["pages"].append(_empty_page())
    schedule["pages"] = schedule["pages"][:PAGE_COUNT]

    for page in schedule["pages"]:
        page.setdefault("audience_id", secrets.token_urlsafe(8))
        page.setdefault("switch_lock", False)
        page.setdefault("colors", [None] * PAD_COUNT)
        page.setdefault("temp_colors", [None] * PAD_COUNT)
        page.setdefault("prev_colors", None)
        if "fades" not in page or len(page["fades"]) != PAD_COUNT:
            page["fades"] = [FADE_NONE] * PAD_COUNT
        else:
            page["fades"] = [
                v if v in FADE_MODES else FADE_NONE for v in page["fades"]
            ]
        page.setdefault("prev_fades", None)

    schedule.setdefault("palette", list(DEFAULT_PALETTE))
    schedule.setdefault("state", "stop")
    schedule.setdefault("t0", None)
    schedule.setdefault("version", 1)
    return schedule


def find_page_index(schedule, audience_id):
    ensure_schedule(schedule)
    for i, page in enumerate(schedule["pages"]):
        if page["audience_id"] == audience_id:
            return i
    return None


def public_view(schedule, page_index):
    """1ページ分を audience 用に取り出す。"""
    ensure_schedule(schedule)
    if page_index < 0 or page_index >= PAGE_COUNT:
        raise ValueError("ページ番号が不正です")
    page = schedule["pages"][page_index]
    return {
        "version": schedule["version"],
        "state": schedule["state"],
        "t0": schedule["t0"],
        "page_index": page_index,
        "colors": page["colors"],
        "prev_colors": page["prev_colors"],
        "fades": page["fades"],
        "prev_fades": page["prev_fades"],
    }


def normalize_pad_value(value):
    if value is None or value == SMPTE:
        return value
    if isinstance(value, str) and COLOR_PATTERN.match(value.upper()):
        return value.upper()
    raise ValueError(f"パッドの値が不正です: {value!r}")


def normalize_pad_list(values):
    if not isinstance(values, list) or len(values) != PAD_COUNT:
        raise ValueError(f"パッドの値は{PAD_COUNT}個のリストで送ってください")
    return [normalize_pad_value(v) for v in values]


def normalize_fade_list(values):
    if not isinstance(values, list) or len(values) != PAD_COUNT:
        raise ValueError(f"フェードは{PAD_COUNT}個のリストで送ってください")
    result = []
    for v in values:
        if v not in FADE_MODES:
            raise ValueError(f"フェードの値が不正です: {v!r}")
        result.append(v)
    return result


def _require_ms(value, name):
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{name} はミリ秒の整数で送ってください")
    return value


def _require_page_index(value):
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("page は整数で送ってください")
    if value < 0 or value >= PAGE_COUNT:
        raise ValueError(f"page は0〜{PAGE_COUNT - 1}にしてください")
    return value


def apply_run(schedule, t0):
    ensure_schedule(schedule)
    t0 = _require_ms(t0, "t0")
    if t0 % PAD_MS != 0:
        raise ValueError("t0 は0.5秒単位に揃えてください")
    schedule["state"] = "run"
    schedule["t0"] = t0
    for page in schedule["pages"]:
        page["prev_colors"] = None
        page["prev_fades"] = None


def apply_stop(schedule):
    ensure_schedule(schedule)
    schedule["state"] = "stop"
    schedule["t0"] = None
    for page in schedule["pages"]:
        page["prev_colors"] = None
        page["prev_fades"] = None


def apply_switch(schedule, t0):
    """sw Lock が OFF のページだけ、本アサインと仮アサインを入れ替える。"""
    ensure_schedule(schedule)
    t0 = _require_ms(t0, "t0")
    if schedule["state"] != "run":
        raise ValueError("SWITCHはRUN中だけ使えます")
    current_t0 = schedule["t0"]
    if t0 <= current_t0 or (t0 - current_t0) % LOOP_MS != 0:
        raise ValueError("新しい t0 はループの切れ目にしてください")

    targets = [
        page
        for page in schedule["pages"]
        if not page["switch_lock"] and any(v is not None for v in page["temp_colors"])
    ]
    if not targets:
        raise ValueError("SWITCHできるページがありません（sw Lock OFFかつ仮アサインがあるページ）")

    for page in targets:
        page["prev_colors"] = list(page["colors"])
        page["prev_fades"] = list(page["fades"])
        for i in range(PAD_COUNT):
            temp = page["temp_colors"][i]
            if temp is not None:
                page["temp_colors"][i] = page["colors"][i]
                page["colors"][i] = temp
    # Lock ON のページも同じ t0 に揃える（色は入れ替えない）
    for page in schedule["pages"]:
        if page not in targets:
            page["prev_colors"] = list(page["colors"])
            page["prev_fades"] = list(page["fades"])
    schedule["t0"] = t0


def apply_switch_lock(schedule, page_index, locked):
    ensure_schedule(schedule)
    page_index = _require_page_index(page_index)
    if not isinstance(locked, bool):
        raise ValueError("switch_lock は true / false で送ってください")
    schedule["pages"][page_index]["switch_lock"] = locked


def apply_pads(schedule, page_index, colors, temp_colors, fades=None):
    """指定ページのパッドの色・フェードを更新する。"""
    ensure_schedule(schedule)
    page_index = _require_page_index(page_index)
    page = schedule["pages"][page_index]
    if temp_colors is not None:
        page["temp_colors"] = normalize_pad_list(temp_colors)
    if colors is not None and schedule["state"] != "run":
        page["colors"] = normalize_pad_list(colors)
    if fades is not None:
        page["fades"] = normalize_fade_list(fades)
        for i, color in enumerate(page["colors"]):
            if color is None or color == SMPTE:
                page["fades"][i] = FADE_NONE


def apply_palette(schedule, palette):
    ensure_schedule(schedule)
    if not isinstance(palette, list) or len(palette) != PAD_COUNT:
        raise ValueError(f"パレットは{PAD_COUNT}色のリストで送ってください")
    colors = [normalize_pad_value(v) for v in palette[: PAD_COUNT - 1]]
    if any(v is None or v == SMPTE for v in colors):
        raise ValueError("パレット1〜11番はカラーコードにしてください")
    schedule["palette"] = colors + [SMPTE]
