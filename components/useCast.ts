"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SubCue } from "@/lib/subs";

let castSdk: Promise<void> | null = null;

function loadCastSdk(): Promise<void> {
  if (window.cast?.framework) return Promise.resolve();
  if (castSdk) return castSdk;
  castSdk = new Promise((resolve, reject) => {
    window.__onGCastApiAvailable = (available) => available ? resolve() : reject(Error("Google Cast is unavailable in this browser."));
    const script = document.createElement("script");
    script.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.onerror = () => reject(Error("Could not load Google Cast."));
    document.head.appendChild(script);
  });
  return castSdk;
}

/** A remux is a fresh, unseekable pipe; a remote seek opens it again at `t`. */
export function castMediaUrl(src: string, origin: string, start: number): string {
  const url = new URL(src, origin);
  if (url.pathname !== "/api/stream" || !url.searchParams.has("remux")) throw Error("No relay stream is ready to cast.");
  url.protocol = new URL(origin).protocol;
  url.host = new URL(origin).host;
  url.searchParams.set("pack", "ts");
  url.searchParams.set("video", "h264");
  url.searchParams.set("t", String(Math.max(0, start)));
  const cast = new URL("/api/cast", origin);
  cast.searchParams.set("src", url.toString());
  return cast.toString();
}

export function castTrackUrl(src: string, origin: string, start: number): string {
  const url = new URL(src, origin);
  if (url.pathname !== "/api/subs/file") throw Error("Subtitle is not relayed by Lacrima.");
  url.protocol = new URL(origin).protocol;
  url.host = new URL(origin).host;
  url.searchParams.set("cast", "1");
  url.searchParams.set("t", String(Math.max(0, start)));
  return url.toString();
}

export function useCast(src: string | null, title: string, episode: string, cues: SubCue[], selected: string) {
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [position, setPosition] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const startRef = useRef(0);
  const loadedTracks = useRef<Map<string, number>>(new Map());
  const loadedSource = useRef<string | null>(null);
  const lastSelection = useRef(selected);
  const controller = useRef<cast.framework.RemotePlayerController | null>(null);
  const remotePlayer = useRef<cast.framework.RemotePlayer | null>(null);

  useEffect(() => {
    setOrigin(localStorage.getItem("lacrima-cast-origin") || window.location.origin);
    if (!window.isSecureContext) return;
    let live = true;
    void loadCastSdk().then(() => {
      if (!live || !window.chrome?.cast?.isAvailable) return;
      const context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      const player = new cast.framework.RemotePlayer();
      remotePlayer.current = player;
      controller.current = new cast.framework.RemotePlayerController(player);
      setReady(true);
      setConnected(context.getCastState() === cast.framework.CastState.CONNECTED);
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : "Google Cast is unavailable.");
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const context = cast.framework.CastContext.getInstance();
    const onState = () => setConnected(context.getCastState() === cast.framework.CastState.CONNECTED);
    context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, onState);
    const timer = setInterval(() => {
      const media = context.getCurrentSession()?.getMediaSession();
      if (!media) return;
      setPosition(startRef.current + media.getEstimatedTime());
      setPaused(remotePlayer.current?.isPaused ?? false);
    }, 500);
    return () => {
      clearInterval(timer);
      context.removeEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, onState);
    };
  }, [ready]);

  const saveOrigin = useCallback((value: string) => {
    setOrigin(value);
    localStorage.setItem("lacrima-cast-origin", value);
  }, []);

  const loadAt = useCallback(async (at: number) => {
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    if (!session || !src) return;
    const base = new URL(origin);
    if (!/^https?:$/.test(base.protocol) || base.pathname !== "/" || base.search || base.hash || base.username) {
      throw Error("Enter a Lacrima server origin, such as http://192.168.1.224:7345.");
    }
    const info = new chrome.cast.media.MediaInfo(castMediaUrl(src, base.origin, at), "application/x-mpegURL");
    info.streamType = chrome.cast.media.StreamType.LIVE;
    info.metadata = new chrome.cast.media.GenericMediaMetadata();
    info.metadata.title = title;
    info.metadata.subtitle = episode;
    const tracks = new Map<string, number>();
    const castCues = cues.slice(0, 50);
    const chosen = cues.find((cue) => cue.id === selected);
    if (chosen && !castCues.some((cue) => cue.id === selected)) castCues[49] = chosen;
    info.tracks = castCues.map((cue, index) => {
      const id = index + 1;
      tracks.set(cue.id, id);
      const track = new chrome.cast.media.Track(id, chrome.cast.media.TrackType.TEXT);
      track.name = cue.label;
      track.language = cue.lang;
      track.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
      track.trackContentId = castTrackUrl(cue.src, base.origin, at);
      track.trackContentType = "text/vtt";
      return track;
    });
    const request = new chrome.cast.media.LoadRequest(info);
    request.currentTime = 0;
    request.activeTrackIds = tracks.has(selected) ? [tracks.get(selected)!] : [];
    startRef.current = at;
    setPosition(at);
    const result = await session.loadMedia(request);
    if (result) throw Error(`TV playback failed (${result}). Check that the TV can reach ${base.origin}.`);
    loadedTracks.current = tracks;
    loadedSource.current = src;
    lastSelection.current = selected;
    setError(null);
  }, [src, origin, title, episode, cues, selected]);

  const connect = useCallback(async (at: number) => {
    setError(null);
    try {
      if (!ready) throw Error("Google Cast is unavailable on this page. Use Chrome’s Cast tab command for HTTP pages.");
      const context = cast.framework.CastContext.getInstance();
      const result = await context.requestSession();
      if (result) throw Error(`Could not connect to TV (${result}).`);
      await loadAt(at);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cast to TV.");
    }
  }, [ready, loadAt]);

  const seek = useCallback((at: number) => {
    void loadAt(at).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not seek on TV."));
  }, [loadAt]);

  const select = useCallback((choice: string) => {
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    const media = session?.getMediaSession();
    if (!media) return;
    const track = loadedTracks.current.get(choice);
    if (choice !== "off" && track == null) {
      seek(position);
      return;
    }
    lastSelection.current = choice;
    media.editTracksInfo(new chrome.cast.media.EditTracksInfoRequest(track ? [track] : []), () => {}, () => {
      setError("Could not change subtitles on TV.");
    });
  }, [position, seek]);

  useEffect(() => {
    if (connected && loadedSource.current && src && loadedSource.current !== src) seek(position);
  }, [connected, src]);

  useEffect(() => {
    if (connected && loadedSource.current && lastSelection.current !== selected) select(selected);
  }, [connected, selected]);

  const disconnect = useCallback(() => cast.framework.CastContext.getInstance().endCurrentSession(true), []);
  const toggle = useCallback(() => controller.current?.playOrPause(), []);

  return { ready, connected, position, paused, error, origin, saveOrigin, connect, disconnect, seek, select, toggle };
}
