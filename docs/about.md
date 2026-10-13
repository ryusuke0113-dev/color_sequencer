# OZ-9 COLOR SEQUENCERについて

本ソフトは、平泉町スパルタキャンプ13期Python編の個人制作である。

Title : OZ-9 COLOR SEQUENCER

本ソフトの目的は、ブラウザ画面でBackground-colorを表示し色の切り替えなどを行い、空間演出を行うソフトである。

ユーザーは、色の操作を行い管理するconsoleと閲覧専用をaudienceがある。

consoleでは表示される色のscheduleを作成しサーバーにアップロード。
audienceではscheduleを取得し表示する。

scheduleは端末の時計の絶対時刻で表示する。

> > 1. 知っておくべきこと：JavaScript が必要になる
> > 色を時刻で切り替える処理は、サーバーではなくブラウザの中で動きます。 つまり、Python ではなく JavaScript の仕事です。Flask が担当するのは、ページを返すことと、schedule の保存・受け渡しだけです。

> > AI に書いてもらってかまいませんが、少なくとも次の3点は自分で読めるようにしておきましょう。

> > 現在時刻の取り方
> > 上のパッド番号の計算
> > 背景色の変え方


