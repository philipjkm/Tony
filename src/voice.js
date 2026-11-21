'use strict';
/**
 * Real Santa voice via ElevenLabs (https://elevenlabs.io).
 * The API key stays on this computer (data folder); clips are cached so each line is paid for once.
 * API shapes verified against the official @elevenlabs/elevenlabs-js SDK (v2.79):
 *   POST /v1/text-to-speech/{voice_id}?output_format=…  (xi-api-key; body: text, model_id, voice_settings)
 *   GET  /v1/shared-voices?search=…&page_size=…         (voices[]: public_owner_id, voice_id, name, preview_url, …)
 *   POST /v1/voices/add/{public_user_id}/{voice_id}      (body: new_name → voice_id)
 *   GET  /v1/voices                                       (voices[]: voice_id, name)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL = 'eleven_multilingual_v2'; // speaks English and Danish with the same voice
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };

function createVoice({ dataDir, baseUrl = 'https://api.elevenlabs.io', log = () => {} }) {
  const file = path.join(dataDir, 'voice.json');
  const cacheDir = path.join(dataDir, 'tts');
  fs.mkdirSync(cacheDir, { recursive: true });
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not set up yet */ }
  const save = () => fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  const inflight = new Map();

  const status = () => ({
    keySet: !!cfg.apiKey,
    keyHint: cfg.apiKey ? '••••' + cfg.apiKey.slice(-4) : '',
    voiceId: cfg.voiceId || '',
    voiceName: cfg.voiceName || '',
    ready: !!(cfg.apiKey && cfg.voiceId),
  });

  async function api(method, pathname, { query, body, raw } = {}) {
    if (!cfg.apiKey) throw new Error('Add your ElevenLabs API key first');
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const res = await fetch(baseUrl + pathname + qs, {
      method,
      headers: { 'xi-api-key': cfg.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      let msg = `ElevenLabs said ${res.status}`;
      try {
        const j = await res.json();
        const d = j.detail;
        msg += ': ' + (typeof d === 'string' ? d : (d && (d.message || d.status)) || JSON.stringify(j).slice(0, 200));
      } catch { /* not json */ }
      if (res.status === 401) msg = 'ElevenLabs did not accept the API key (check it, and that it has Text to Speech + Voices permissions)';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return raw ? res : res.json();
  }

  async function setKey(apiKey) {
    const old = cfg.apiKey;
    cfg.apiKey = String(apiKey || '').trim();
    if (!cfg.apiKey) { cfg = {}; save(); return status(); }
    try {
      await api('GET', '/v1/voices'); // checks the key works
    } catch (e) {
      cfg.apiKey = old;
      throw e;
    }
    save();
    return status();
  }

  async function search(q) {
    const j = await api('GET', '/v1/shared-voices', { query: { search: String(q || 'santa').slice(0, 60), page_size: '24' } });
    return (j.voices || []).map((v) => ({
      publicOwnerId: v.public_owner_id,
      voiceId: v.voice_id,
      name: v.name,
      description: v.description || v.descriptive || '',
      accent: v.accent || '',
      language: v.language || '',
      previewUrl: v.preview_url || '',
      freeUsersAllowed: v.free_users_allowed !== false,
    }));
  }

  async function useVoice({ publicOwnerId, voiceId, name }) {
    let id = null;
    if (publicOwnerId) {
      try {
        const j = await api('POST', `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, { body: { new_name: String(name || 'Santa').slice(0, 60) } });
        id = j.voice_id;
      } catch (e) {
        // maybe it is already in "My voices": find it by name
        const mine = await api('GET', '/v1/voices');
        const hit = (mine.voices || []).find((v) => v.voice_id === voiceId || v.name === name);
        if (!hit) throw e;
        id = hit.voice_id;
      }
    } else {
      id = voiceId; // one of the account's own voices
    }
    cfg.voiceId = id;
    cfg.voiceName = String(name || 'Santa').slice(0, 60);
    save();
    return status();
  }

  async function myVoices() {
    const j = await api('GET', '/v1/voices');
    return (j.voices || []).map((v) => ({ voiceId: v.voice_id, name: v.name, previewUrl: v.preview_url || '' }));
  }

  const keyFor = (text) => crypto.createHash('sha1').update(`${cfg.voiceId}|${MODEL}|${text}`).digest('hex');
  function cached(text) {
    const k = keyFor(text);
    for (const [ext, type] of [['mp3', 'audio/mpeg'], ['wav', 'audio/wav']]) {
      const f = path.join(cacheDir, `${k}.${ext}`);
      if (fs.existsSync(f)) return { file: f, type };
    }
    return null;
  }

  /** Audio for a line: from the cache, or generated once by ElevenLabs. */
  async function tts(text) {
    text = String(text || '').trim().slice(0, 400);
    if (!text) throw new Error('No text');
    if (!cfg.voiceId) throw new Error('Pick a Santa voice first');
    const hit = cached(text);
    if (hit) return hit;
    const k = keyFor(text);
    if (!inflight.has(k)) {
      inflight.set(k, (async () => {
        const res = await api('POST', `/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}`, {
          query: { output_format: 'mp3_44100_128' },
          body: { text, model_id: MODEL, voice_settings: VOICE_SETTINGS },
          raw: true,
        });
        const type = (res.headers.get('content-type') || 'audio/mpeg').split(';')[0];
        const ext = type.includes('wav') ? 'wav' : 'mp3';
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100) throw new Error('ElevenLabs returned empty audio');
        const f = path.join(cacheDir, `${k}.${ext}`);
        fs.writeFileSync(f, buf);
        return { file: f, type: ext === 'wav' ? 'audio/wav' : 'audio/mpeg' };
      })().finally(() => inflight.delete(k)));
    }
    return inflight.get(k);
  }

  return { status, setKey, search, useVoice, myVoices, tts, isCached: (t) => !!cached(String(t || '').trim().slice(0, 400)) };
}

module.exports = { createVoice, MODEL };
