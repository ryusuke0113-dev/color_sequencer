"""アカウントと schedule を SQLite に保存する。"""

import json
import secrets
import sqlite3
from contextlib import closing
from pathlib import Path

import sequence

DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "app.db"


def _connect():
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with closing(_connect()) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                audience_id TEXT UNIQUE NOT NULL,
                schedule TEXT NOT NULL
            )
            """
        )


def create_user(email, password_hash):
    """新しいアカウントを作り id を返す。メールアドレスが登録済みなら None。"""
    audience_ids = [secrets.token_urlsafe(8) for _ in range(sequence.PAGE_COUNT)]
    schedule = json.dumps(sequence.new_schedule(audience_ids))
    try:
        with closing(_connect()) as conn, conn:
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, audience_id, schedule)"
                " VALUES (?, ?, ?, ?)",
                (email, password_hash, audience_ids[0], schedule),
            )
            return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None


def _find_user(column, value):
    with closing(_connect()) as conn:
        return conn.execute(
            f"SELECT * FROM users WHERE {column} = ?", (value,)
        ).fetchone()


def find_user_by_id(user_id):
    return _find_user("id", user_id)


def find_user_by_email(email):
    return _find_user("email", email)


def find_user_by_audience_id(audience_id):
    """3ページいずれかの audience_id に一致するユーザーを返す。"""
    with closing(_connect()) as conn:
        # まず旧形式の列を確認
        row = conn.execute(
            "SELECT * FROM users WHERE audience_id = ?", (audience_id,)
        ).fetchone()
        if row is not None:
            return row
        # 新形式：schedule 内の pages を探す
        for user in conn.execute("SELECT * FROM users"):
            schedule = sequence.ensure_schedule(json.loads(user["schedule"]))
            if sequence.find_page_index(schedule, audience_id) is not None:
                return user
    return None


def load_schedule(user):
    schedule = sequence.ensure_schedule(json.loads(user["schedule"]))
    # 旧アカウントの audience_id 列を page0 に揃える
    if schedule["pages"][0]["audience_id"] != user["audience_id"]:
        # page0 が別IDなら、列のIDが pages のどれかにあればそのまま
        if sequence.find_page_index(schedule, user["audience_id"]) is None:
            schedule["pages"][0]["audience_id"] = user["audience_id"]
    return schedule


def save_schedule(user_id, schedule):
    """版番号を+1して保存する。"""
    sequence.ensure_schedule(schedule)
    schedule["version"] += 1
    with closing(_connect()) as conn, conn:
        conn.execute(
            "UPDATE users SET schedule = ?, audience_id = ? WHERE id = ?",
            (
                json.dumps(schedule),
                schedule["pages"][0]["audience_id"],
                user_id,
            ),
        )
