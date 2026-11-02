'use strict';

/* =========================================================
   Odczyt tagów z plików audio
   Obsługiwane: ID3v2.2–2.4 (MP3), MP4/M4A/M4B (iTunes), FLAC (Vorbis comment).
   Zwraca { title, artist, album, track, picture: { mime, data } } – pola mogą być puste.
   ========================================================= */
const Tags = (() => {
  const MAX = 16 * 1024 * 1024;

  const read = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
  const ascii = (b, s, e) => String.fromCharCode(...b.subarray(s, e));
  const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const le32 = (b, o) => b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0);
  const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  const clean = s => (s || '').split('\u0000')[0].trim();

  function decode(bytes, enc) {
    try {
      if (enc === 0) return new TextDecoder('windows-1252').decode(bytes);
      if (enc === 1) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
        return new TextDecoder('utf-16le').decode(bytes);
      }
      if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  }

  function unsync(b) {
    const out = new Uint8Array(b.length);
    let j = 0;
    for (let i = 0; i < b.length; i++) {
      out[j++] = b[i];
      if (b[i] === 0xff && b[i + 1] === 0x00) i++;
    }
    return out.subarray(0, j);
  }

  function setPicture(out, mime, data, type) {
    if (data.length < 64) return;
    // Preferuj okładkę przednią (typ 3).
    if (!out.picture || (type === 3 && out.picture.type !== 3)) out.picture = { mime, data, type };
  }

  /* ---------- ID3v2 ---------- */
  const ID3_TEXT = {
    TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist',
    TALB: 'album', TAL: 'album', TRCK: 'track', TRK: 'track',
  };

  async function id3(blob, head) {
    const ver = head[3];
    const flags = head[5];
    const size = syncsafe(head, 6);
    let b = await read(blob, 10, Math.min(10 + size, blob.size, 10 + MAX));
    if ((flags & 0x80) && ver < 4) b = unsync(b);

    const out = {};
    const v22 = ver === 2;
    const idLen = v22 ? 3 : 4;
    const hdr = v22 ? 6 : 10;
    let p = 0;
    if (!v22 && (flags & 0x40)) p = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4;

    while (p + hdr <= b.length) {
      const id = ascii(b, p, p + idLen);
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const fsize = v22 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]
        : ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
      const ff = v22 ? 0 : b[p + 9];
      let data = b.subarray(p + hdr, p + hdr + fsize);
      p += hdr + fsize;
      if (!fsize) continue;

      if (ver === 3) {
        if (ff & 0xc0) continue;                 // kompresja / szyfrowanie
        if (ff & 0x20) data = data.subarray(1);  // grupowanie
      } else if (ver === 4) {
        if (ff & 0x0c) continue;
        if (ff & 0x40) data = data.subarray(1);
        if (ff & 0x01) data = data.subarray(4);
        if (ff & 0x02) data = unsync(data);
      }

      const key = ID3_TEXT[id];
      if (key) {
        if (!out[key]) out[key] = clean(decode(data.subarray(1), data[0]));
      } else if (id === 'APIC' || id === 'PIC') {
        const enc = data[0];
        let q = 1;
        let mime;
        if (id === 'PIC') {
          mime = ascii(data, 1, 4).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
          q = 4;
        } else {
          let e = q;
          while (e < data.length && data[e] !== 0) e++;
          mime = ascii(data, q, e).toLowerCase() || 'image/jpeg';
          if (!mime.includes('/')) mime = mime === 'png' ? 'image/png' : 'image/jpeg';
          q = e + 1;
        }
        const ptype = data[q++];
        if (enc === 1 || enc === 2) {
          while (q + 1 < data.length && !(data[q] === 0 && data[q + 1] === 0)) q += 2;
          q += 2;
        } else {
          while (q < data.length && data[q] !== 0) q++;
          q += 1;
        }
        setPicture(out, mime, data.slice(q), ptype);
      }
    }
    return out;
  }

  /* ---------- MP4 / M4A / M4B ---------- */
  function* atoms(b, start, end) {
    let p = start;
    while (p + 8 <= end) {
      let s = be32(b, p);
      const t = ascii(b, p + 4, p + 8);
      let hl = 8;
      if (s === 1) { s = be32(b, p + 8) * 4294967296 + be32(b, p + 12); hl = 16; }
      else if (s === 0) s = end - p;
      if (s < hl || p + s > end) return;
      yield { t, start: p + hl, end: p + s };
      p += s;
    }
  }
  const child = (b, parent, type) => {
    for (const a of atoms(b, parent.start, parent.end)) if (a.t === type) return a;
    return null;
  };

  async function mp4(blob) {
    let off = 0;
    let moov = null;
    while (off + 8 <= blob.size) {
      const h = await read(blob, off, Math.min(off + 16, blob.size));
      let size = be32(h, 0);
      const type = ascii(h, 4, 8);
      let hl = 8;
      if (size === 1) { size = be32(h, 8) * 4294967296 + be32(h, 12); hl = 16; }
      else if (size === 0) size = blob.size - off;
      if (size < hl) break;
      if (type === 'moov') {
        if (size > 4 * MAX) return {};
        moov = await read(blob, off + hl, off + size);
        break;
      }
      off += size;
    }
    if (!moov) return {};

    const out = {};
    const root = { start: 0, end: moov.length };
    const udta = child(moov, root, 'udta');
    if (!udta) return out;
    const meta = child(moov, udta, 'meta');
    if (!meta) return out;
    // "meta" ma zwykle 4 bajty wersji/flag przed dziećmi.
    const metaBody = ascii(moov, meta.start + 4, meta.start + 8) === 'hdlr'
      ? meta : { start: meta.start + 4, end: meta.end };
    const ilst = child(moov, metaBody, 'ilst');
    if (!ilst) return out;

    const C = '©';
    const utf8 = new TextDecoder('utf-8');
    for (const item of atoms(moov, ilst.start, ilst.end)) {
      const data = child(moov, item, 'data');
      if (!data) continue;
      const kind = be32(moov, data.start) & 0xffffff;
      const payload = moov.subarray(data.start + 8, data.end);
      if (item.t === C + 'nam') out.title = clean(utf8.decode(payload));
      else if (item.t === C + 'ART') out.artist = clean(utf8.decode(payload));
      else if (item.t === 'aART' && !out.artist) out.artist = clean(utf8.decode(payload));
      else if (item.t === C + 'alb') out.album = clean(utf8.decode(payload));
      else if (item.t === 'trkn' && payload.length >= 4) out.track = String((payload[2] << 8) | payload[3]);
      else if (item.t === 'covr') setPicture(out, kind === 14 ? 'image/png' : 'image/jpeg', payload.slice(), 3);
    }
    return out;
  }

  /* ---------- FLAC ---------- */
  async function flac(blob) {
    let b = await read(blob, 0, Math.min(blob.size, 512 * 1024));
    const out = {};
    let p = 4;
    while (p + 4 <= b.length) {
      const last = b[p] & 0x80;
      const type = b[p] & 0x7f;
      const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
      p += 4;
      if (p + len > b.length && b.length < blob.size) {
        b = await read(blob, 0, Math.min(blob.size, p + len, MAX));
      }
      if (p + len > b.length) break;
      const d = b.subarray(p, p + len);
      if (type === 4) {
        const utf8 = new TextDecoder('utf-8');
        let q = 4 + le32(d, 0);
        const n = le32(d, q);
        q += 4;
        for (let i = 0; i < n && q + 4 <= d.length; i++) {
          const l = le32(d, q);
          q += 4;
          const s = utf8.decode(d.subarray(q, q + l));
          q += l;
          const k = s.indexOf('=');
          if (k < 0) continue;
          const key = s.slice(0, k).toUpperCase();
          const val = s.slice(k + 1).trim();
          if (key === 'TITLE' && !out.title) out.title = val;
          else if (key === 'ARTIST' && !out.artist) out.artist = val;
          else if (key === 'ALBUM' && !out.album) out.album = val;
          else if (key === 'TRACKNUMBER' && !out.track) out.track = val;
        }
      } else if (type === 6) {
        const ptype = be32(d, 0);
        const ml = be32(d, 4);
        const mime = ascii(d, 8, 8 + ml) || 'image/jpeg';
        let q = 8 + ml;
        q += 4 + be32(d, q);
        q += 16;
        const dl = be32(d, q);
        q += 4;
        setPicture(out, mime, d.slice(q, q + dl), ptype);
      }
      p += len;
      if (last) break;
    }
    return out;
  }

  async function readTags(blob) {
    try {
      const h = await read(blob, 0, Math.min(16, blob.size));
      if (h.length < 12) return {};
      if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return await id3(blob, h);
      if (ascii(h, 4, 8) === 'ftyp') return await mp4(blob);
      if (ascii(h, 0, 4) === 'fLaC') return await flac(blob);
    } catch {
      /* uszkodzone tagi – ignorujemy */
    }
    return {};
  }

  return { read: readTags };
})();
