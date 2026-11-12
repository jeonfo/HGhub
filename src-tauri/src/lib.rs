mod api;
mod lines;
mod media;
mod net;
mod session;

use api::Api;
use tauri::Manager;

/// 播放地址(站点新接口适配)。
///
/// 站点把播放请求挪到了 `POST /api/videos/{id}/episodes/{ep}/playback`,回传
/// `data.streams.{main,hevc,preview}`;旧的 `GET /api/videos/{id}/play?ep=..`
/// 现在虽然还是 `status: 1`,但 `video_url` 一律是空串,前端于是报「暂无播放地址」。
///
/// 这里先打新接口,把 `streams.main` / `streams.hevc` 回填成前端已经在读的
/// `video_url` / `video_url_hevc`(前端与自检都不用改);新接口没戏(旧线路)时
/// 退回旧接口;两边都拿不到地址就明确报错,而不是把空串交给前端。
///
/// 命令名与参数保持 `api_play` / `{ id, ep }`,所以 src/api.ts 与 Feed.tsx 不动。
/// (src-tauri/src/api.rs 里那份旧的 `api_play` 已不再注册,保留作对照。)
#[tauri::command]
pub async fn api_play(id: i64, ep: u32) -> Result<serde_json::Value, String> {
    use serde_json::{json, Value};

    let path = format!("/api/videos/{id}/episodes/{ep}/playback");
    let fresh = net::edge("POST", &path, Some(json!({})), None)
        .await
        .unwrap_or(Value::Null);
    let pick = |k: &str| -> String {
        fresh
            .get("streams")
            .and_then(|s| s.get(k))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };
    let (main, hevc, preview) = (pick("main"), pick("hevc"), pick("preview"));

    if main.is_empty() {
        // 退回旧接口:老线路 / 站点回滚时还能用。
        let old = net::edge(
            "GET",
            &format!("/api/videos/{id}/play?ep={ep}&page_texts=0"),
            None,
            None,
        )
        .await?;
        let usable = old
            .get("video_url")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        if usable {
            return Ok(old);
        }
        return Err("站点播放接口已变更,这条线路取不到播放地址(可在「线路」里换一条再试)".to_string());
    }

    let mut out = if fresh.is_object() { fresh } else { json!({}) };
    out["video_url"] = json!(main);
    if !hevc.is_empty() {
        out["video_url_hevc"] = json!(hevc);
    }
    if !preview.is_empty() {
        out["video_url_preview"] = json!(preview);
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Api::new())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                // 上次选择的线路(设置 → 线路)在启动时恢复
                net::bind_base(&dir);
                let state: tauri::State<Api> = app.state();
                state.session.bind(dir);
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("hg", |_app, request, responder| {
            let uri = request.uri().clone();
            let path = uri.path().to_string();
            let query = uri.query().unwrap_or("").to_string();
            // 自定义协议基址随平台不同,统一定义在 media::LOCAL_ORIGIN
            // (Windows/Android 是 http://<scheme>.localhost,macOS/iOS/Linux 是 <scheme>://localhost)。
            // 它同时是 m3u8 分片/key 改写用的前缀,必须与前端 src/api.ts 的 LOCAL 一致。
            tauri::async_runtime::spawn(async move {
                let resp = media::handle(&path, &query, media::LOCAL_ORIGIN).await;
                responder.respond(resp);
            });
        })
        .invoke_handler(tauri::generate_handler![
            api::app_boot,
            api::debug_log,
            api::net_diag,
            api::line_state,
            api::line_set,
            api::line_mirrors,
            api::line_probe,
            api::check_update,
            api::open_url,
            api::api_login,
            api::api_register,
            api::api_logout,
            api::api_me,
            api::api_feed,
            api::api_category,
            api::api_rank,
            api::api_search,
            api::cache_clear,
            api::api_posts,
            api::api_post,
            api::api_post_like,
            api::api_post_collect,
            api::api_post_comments,
            api::api_video,
            api_play,
            api::api_comments,
            api::api_comment_send,
            api::api_like,
            api::api_collect,
            api::api_follow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
