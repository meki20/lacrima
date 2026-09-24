# Lacrima client API v1

All JSON responses use one envelope:

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": { "code": "upstream_unavailable", "message": "…", "lastSuccess": 0 } }
```

`lastSuccess` is optional. An empty successful list and an upstream failure are never interchangeable.
Every profile-scoped request requires `X-Lacrima-Profile: <id>`. `GET /bootstrap` and
`GET /profiles` are the only calls that accept no profile. A supplied profile header is always
validated. Media identity is always the tuple `(via, kind, id)`.

Returned app and media relay URLs beginning with `/` are base-resolvable against the server URL.
Metadata artwork is already an absolute HTTPS URL.

## Discovery and identity

- `GET /api/v1/bootstrap` — API/server versions, capabilities, profiles, optional selected profile
  and settings, and source health. `downloads: false` is an honest capability flag.
- `GET /api/v1/profiles` — all profiles.
- `POST /api/v1/profiles` — `{name, accent?}`.
- `PATCH /api/v1/profiles` — patch the header-selected profile with
  `{name?, accent?, avatar_color?, wallpaper?}`.
- `DELETE /api/v1/profiles` — delete the header-selected profile. Body may be `{id}` only when it
  matches the header.
- `GET /api/v1/home` — `{continue, catalog, sourceHealth}`. `catalog` has its own envelope, so local
  Continue survives a total metadata outage.
- `GET /api/v1/browse/{anime|manga|novel}?genre=&page=` — provider-served browse data.
- `GET /api/v1/search?q=` — grouped anime, manga and novel results.

## Titles, reading, and playback

- `GET /api/v1/titles/{via}/{kind}/{id}?part=&change=1&sourceQuery=` — base and selected metadata,
  canonical series target, series, resolution/binding/candidates, visible chapters, profile
  progress/library state, resume anchor, and series progress tree. Cached bindings are the normal
  fast path. `change=1` or `sourceQuery` is the only source re-search path.
- `PUT /api/v1/titles/{via}/{kind}/{id}/binding` — pin a candidate with
  `{sourceId, sourceTitle, sourceMangaId, confidence}`. The path supplies provider, kind and media id;
  the server supplies the backend.
- `POST /api/v1/titles/{via}/{kind}/{id}/chapters/refresh` — explicit scrape/refresh. Ordinary title
  and reader requests read the backend cache.
- `GET /api/v1/reader/{via}/{manga|novel}/{id}/{chapterId}` — metadata, chapter list and neighbors,
  saved portable anchor, settings, progress write template, and either
  `{content:{type:"pages",urls:[…]}}` or sanitized `{content:{type:"html",html:"…"}}`.
- `GET /api/v1/playback/{via}/anime/{id}/{chapterId}?lang=&t=&sub=&fresh=1` — episode context,
  progress write template, settings, and native-ready stream choices:

```json
{
  "streamGroups": [{
    "id": "1080p-ja",
    "quality": "1080p",
    "lang": "ja",
    "label": "1080p · Japanese",
    "attempts": [{
      "url": "/api/stream?…&cv=anilist&cm=1&cc=episode&remux=1&lang=ja",
      "provider": "addon",
      "commit": { "groupId": "1080p-ja", "pick": {} }
    }]
  }],
  "preferredStreamGroup": "1080p-ja"
}
```

  Attempt URLs already include server-side HTTP/torrent racing, cache context, remux, language,
  optional embedded-subtitle selection and the outside-buffer seek origin. The client selects a
  group and advances through attempts; it does not implement source or torrent logic. When `t` is
  omitted, both `initialTime` and every attempt begin at the saved same-episode anchor. Use the
  returned `nextPlaybackUrl` for best-effort next-episode warming.
- `GET /api/v1/playback/{via}/anime/{id}/{chapterId}/skip-times` — optional exact opening,
  ending, recap, and mixed-segment endpoints in `{segments:[{type,start,end}]}`. An unavailable
  timing provider produces an empty successful list so playback is never blocked.
- `POST /api/v1/playback/{via}/anime/{id}/{chapterId}/commit` — after playback is confirmed, send
  the selected attempt's `commit` object. This updates the shared fast path and the selected
  profile's provider history.
- `GET /api/v1/playback/{via}/anime/{id}/{chapterId}/subtitles?fresh=1` — subtitle descriptors in
  `{subtitles}`, including a context-bound `src` for each file. Request that `src` directly: it is
  a UTF-8 subtitle response from `/api/subs/file?...`, cached and proxied by the server for both
  web and native players. `/api/stream` remains video transport. Cancelling the active HTTP request
  is teardown; the native client must not call the global legacy `DELETE /api/stream`.

## Profile data

- `GET /api/v1/library?kind=&status=&genre=&sort=&q=` — filtered items plus total, pinned shelf,
  genres, activity facts, monthly mix, and sticker count.
- `POST|PUT /api/v1/library` — upsert `{via,id,kind,title,cover?,color?,units?,genres?,status?,score?,pin?}`
  or reorder `{reorder:[{via,id}]}`.
- `DELETE /api/v1/library` — `{via,id,kind}`.
- `GET /api/v1/progress?via=&mediaId=` — one namespaced progress row with parsed anchor.
- `POST|PUT /api/v1/progress` — `{via,mediaId,kind,title,cover,unit,anchor,watchedDelta?,skipAhead?,
  exact?,durationSeconds?,seriesParts?,partIndex?}`. Anchors are validated as seconds, page index,
  or paragraph/CFI; scroll offsets are rejected.
- `GET /api/v1/settings` — settings and best-provider history.
- `PATCH|PUT /api/v1/settings` — partial settings update.
- `GET /api/v1/stickers` and `PATCH /api/v1/stickers` (`{id}`) — collection and earned-state toggle.
- `GET|POST|PATCH|DELETE /api/v1/stickers/placements` — same placement DTOs and validation as web.

## Source administration

- `GET /api/v1/sources/health`
- `GET /api/v1/sources?kind=` and `PATCH /api/v1/sources` (`{kind,id,enabled}`)
- `GET|POST|DELETE /api/v1/sources/repos` (`kind` query for GET; `{kind,indexUrl}` otherwise)
- `POST /api/v1/sources/repos/refresh` (`{kind}`)
- `GET /api/v1/sources/extensions?kind=&q=&limit=` and
  `PATCH /api/v1/sources/extensions` (`{kind,pkgName,installed}`)

Adding a repository immediately refreshes its extension index. Lacrima still ships with no source
repository and the API never suggests one.
