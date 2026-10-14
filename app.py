import secrets
import socket
import time
from datetime import timedelta
from functools import wraps
from threading import Lock

import qrcode
import qrcode.image.svg
from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

import database
import sequence

PASSWORD_MIN_LENGTH = 8


def load_secret_key():
    key_path = database.DATA_DIR / "secret_key"
    database.DATA_DIR.mkdir(exist_ok=True)
    if not key_path.exists():
        key_path.write_text(secrets.token_hex(32))
    return key_path.read_text().strip()


app = Flask(__name__)
app.config.update(
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)
database.init_db()

# 読み込み→変更→保存の途中で別のリクエストが割り込まないようにする
schedule_lock = Lock()


def current_user():
    user_id = session.get("user_id")
    return database.find_user_by_id(user_id) if user_id else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            if request.path.startswith("/api/"):
                return jsonify(error="ログインしてください"), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapper


def lan_ip():
    """同じWi-Fiの端末からアクセスできる、このPCのIPアドレスを調べる。"""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def audience_url(audience_id):
    """audience のURL。localhost で開いている場合は、スマホから届くLANのIPに置き換える。"""
    host = request.host
    hostname, _, port = host.partition(":")
    if hostname in ("localhost", "127.0.0.1"):
        host = lan_ip() + (f":{port}" if port else "")
    return f"{request.scheme}://{host}" + url_for("audience", audience_id=audience_id)


# ---------- ログイン ----------


@app.get("/")
def index():
    return redirect(url_for("console" if current_user() else "login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    error = None
    email = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if "@" not in email:
            error = "メールアドレスを正しく入力してください"
        elif len(password) < PASSWORD_MIN_LENGTH:
            error = f"パスワードは{PASSWORD_MIN_LENGTH}文字以上にしてください"
        else:
            user_id = database.create_user(email, generate_password_hash(password))
            if user_id is None:
                error = "このメールアドレスは登録済みです"
            else:
                session.clear()
                session.permanent = True
                session["user_id"] = user_id
                return redirect(url_for("console"))
    return render_template("auth.html", mode="register", error=error, email=email)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    email = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = database.find_user_by_email(email)
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            return redirect(url_for("console"))
        error = "メールアドレスかパスワードが違います"
    return render_template("auth.html", mode="login", error=error, email=email)


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------- 画面 ----------


@app.get("/console")
@login_required
def console():
    user = current_user()
    return render_template(
        "console.html",
        email=user["email"],
        audience_url=audience_url(user["audience_id"]),
    )


@app.get("/audience/<audience_id>")
def audience(audience_id):
    if database.find_user_by_audience_id(audience_id) is None:
        abort(404)
    return render_template("audience.html", audience_id=audience_id)


@app.get("/qr.svg")
@login_required
def qr_code():
    url = audience_url(current_user()["audience_id"])
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathFillImage, border=2)
    return Response(image.to_string(), mimetype="image/svg+xml")


# ---------- API（audience 用・ログイン不要） ----------


@app.get("/api/time")
def api_time():
    return jsonify(now=int(time.time() * 1000))


def audience_schedule(audience_id):
    user = database.find_user_by_audience_id(audience_id)
    if user is None:
        abort(404)
    return database.load_schedule(user)


@app.get("/api/audience/<audience_id>/version")
def api_audience_version(audience_id):
    return jsonify(version=audience_schedule(audience_id)["version"])


@app.get("/api/audience/<audience_id>/schedule")
def api_audience_schedule(audience_id):
    return jsonify(sequence.public_view(audience_schedule(audience_id)))


# ---------- API（console 用・ログイン必要） ----------


@app.get("/api/console/version")
@login_required
def api_console_version():
    return jsonify(version=database.load_schedule(current_user())["version"])


@app.get("/api/console/schedule")
@login_required
def api_console_schedule():
    return jsonify(database.load_schedule(current_user()))


def update_schedule(change):
    """schedule を読み込み、change で書き換えて保存し、結果を返す。"""
    data = request.get_json(silent=True) or {}
    with schedule_lock:
        user = current_user()
        schedule = database.load_schedule(user)
        try:
            change(schedule, data)
        except ValueError as e:
            return jsonify(error=str(e)), 400
        database.save_schedule(user["id"], schedule)
    return jsonify(schedule)


@app.post("/api/console/run")
@login_required
def api_run():
    return update_schedule(lambda s, data: sequence.apply_run(s, data.get("t0")))


@app.post("/api/console/stop")
@login_required
def api_stop():
    return update_schedule(lambda s, data: sequence.apply_stop(s))


@app.post("/api/console/switch")
@login_required
def api_switch():
    return update_schedule(lambda s, data: sequence.apply_switch(s, data.get("t0")))


@app.post("/api/console/pads")
@login_required
def api_pads():
    return update_schedule(
        lambda s, data: sequence.apply_pads(
            s, data.get("colors"), data.get("temp_colors")
        )
    )


@app.post("/api/console/palette")
@login_required
def api_palette():
    return update_schedule(lambda s, data: sequence.apply_palette(s, data.get("palette")))


if __name__ == "__main__":
    port = 5000
    print(f" * このPC:        http://localhost:{port}/")
    print(f" * 同じWi-Fiの端末: http://{lan_ip()}:{port}/")
    app.run(host="0.0.0.0", port=port)
