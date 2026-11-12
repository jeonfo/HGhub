import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import "./index.css";

/* 站点已把播放请求换成 POST /api/videos/{id}/episodes/{ep}/playback,
 * 旧的 GET /api/videos/{id}/play 只会回一个空地址。
 * Rust 侧的新播放命令是 `api_play_v2`(见 src-tauri/src/lib.rs):
 * 先打新接口,把 streams.main / streams.hevc 回填成 video_url / video_url_hevc,
 * 取不到地址时给出明确报错。这里在启动时把 api.play 指到它,
 * 其余调用点(Feed.tsx / 自检)不用改。 */
(api as unknown as { play: (id: number, ep: number) => Promise<unknown> }).play = (id, ep) =>
  invoke("api_play_v2", { id, ep });

/* 运行期错误统一落到 debug.log,便于自查 */
function report(kind: string, msg: string) {
  invoke("debug_log", { msg: `[${kind}] ${msg}` }).catch(() => {});
}
window.addEventListener("error", (e) => {
  report("error", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  report("reject", String((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
