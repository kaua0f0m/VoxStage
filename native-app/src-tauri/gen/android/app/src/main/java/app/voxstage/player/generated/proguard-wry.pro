# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class app.voxstage.player.* {
  native <methods>;
}

-keep class app.voxstage.player.WryActivity {
  public <init>(...);

  void setWebView(app.voxstage.player.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class app.voxstage.player.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class app.voxstage.player.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class app.voxstage.player.RustWebChromeClient,app.voxstage.player.RustWebViewClient {
  public <init>(...);
}
