

/* 站点已把播放地址挪到新接口:POST /api/videos/{id}/episodes/{ep}/playback,
   地址放在 data.streams.main / data.streams.hevc;旧接口仍回 200 但地址是空串。 */
impl Api {
    async fn play_any(&self, id: i64, ep: u32) -> Result<Value, String> {
        let token = self.token();
        let new_path = format!("/api/videos/{id}/episodes/{ep}/playback");
        let primary = edge("POST", &new_path, Some(json!({})), token.as_deref())
            .await
            .map(|mut info| {
                fill_stream_urls(&mut info);
                info
            });
        if let Ok(info) = &primary {
            if has_play_url(info) {
                return primary;
            }
        }
        match self.get(&format!("/api/videos/{id}/play?ep={ep}&page_texts=0")).await {
            Ok(mut info) => {
                fill_stream_urls(&mut info);
                if has_play_url(&info) || primary.is_err() {
                    Ok(info)
                } else {
                    primary
                }
            }
            Err(_) => primary,
        }
    }
}

/// 把新接口的 streams.main / streams.hevc 回填到前端认识的 video_url / video_url_hevc。
fn fill_stream_urls(info: &mut Value) {
    let Some(obj) = info.as_object_mut() else {
        return;
    };
    for (field, key) in [("video_url", "main"), ("video_url_hevc", "hevc")] {
        let url = obj
            .get("streams")
            .and_then(|st| st.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned);
        if let Some(url) = url {
            let filled = obj
                .get(field)
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty());
            if !filled {
                obj.insert(field.to_string(), json!(url));
            }
        }
    }
}

/// 这一份数据里到底有没有可用的播放地址。
fn has_play_url(info: &Value) -> bool {
    info
        .get("video_url")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
}
