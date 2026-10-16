Title:COLOR_SEQUENCER

## 起動方法

```bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
python app.py
```

起動すると、このPC用のURLと、同じWi-Fiの端末用のURLが表示される。初回は `/register` でアカウントを作成する。
WindowsのファイアウォールでPythonの通信を許可しないと、スマートフォンからは開けない。

アカウントとscheduleは `data/app.db` に保存される。`data` フォルダを消すと初期状態に戻る。
