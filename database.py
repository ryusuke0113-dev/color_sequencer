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
    audience_id = secrets.token_urlsafe(8)
    schedule = json.dumps(sequence.new_schedule())
    try:
        with closing(_connect()) as conn, conn:
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, audience_id, schedule)"
                " VALUES (?, ?, ?, ?)",
                (email, password_hash, audience_id, schedule),
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
    return _find_user("audience_id", audience_id)


def load_schedule(user):
    return json.loads(user["schedule"])


def save_schedule(user_id, schedule):
    """版番号を+1して保存する。"""
    schedule["version"] += 1
    with closing(_connect()) as conn, conn:
        conn.execute(
            "UPDATE users SET schedule = ? WHERE id = ?",
            (json.dumps(schedule), user_id),
        )
