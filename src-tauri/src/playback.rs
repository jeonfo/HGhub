//! 播放地址适配:站点把播放请求挪到了新接口,旧请求只回空串。
//!
//! * 旧:`GET /api/videos/{id}/play?ep=..&page_texts=0` → 现在虽然还是 status 1,
//!   但 `video_url` / `video_url_hevc` 一律是空串,前端于是报「暂无播放地址」。
//! * 新:`POST /api/videos/{id}/episodes/{ep}/playback` → `data.streams.{main,hevc,preview}`。
//!
//! 这里先打新接口,把 `streams.main` / `streams.hevc` 回填成前端已经在读的
//! `video_url` / `video_url_hevc`(前端与自检都不用改);新接口没戏(旧线路)时
//! 退回旧接口;两边都拿不到地址就明确报错,而不是把空串交给前端。

use serde_json::{json, Value};

#[tauri::command]
pub async fn api_play_v2(id: i64, ep: u32) -> Result<Value, String> {
    let path = format!("/api/videos/{id}/episodes/{ep}/playback");
    let fresh = crate::net::edge("POST", &path, Some(json!({})), None)
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
        let old = crate::net::edge(
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
