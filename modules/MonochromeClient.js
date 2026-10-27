import fs from 'fs';
import path from 'path';
import { createLogger } from './Logger.js';

const logger = createLogger('MonochromeClient');

const DEFAULT_API_INSTANCES = [
  'https://ran412c.valerie.sh'
];

const DEFAULT_QUALITY = 'HI_RES_LOSSLESS';
const DEFAULT_DOWNLOAD_RETRIES = 3;
const DEFAULT_INSTANCE_RATE_LIMIT_COOLDOWN_MS = 3 * 60 * 1000;

// TIDAL browser app credentials (from monodownload repo)
const TIDAL_BROWSER_CLIENT_ID = process.env.TIDAL_CLIENT_ID || 'txNoH4kkV41MfH25';
const TIDAL_BROWSER_CLIENT_SECRET = process.env.TIDAL_CLIENT_SECRET || 'dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=';

function getManifestFormatsForQuality(quality = DEFAULT_QUALITY) {
  const normalized = String(quality || '').trim().toUpperCase();
  switch (normalized) {
    case 'LOW':
      return ['HEAACV1', 'AACLC'];
    case 'LOSSLESS':
      return ['FLAC', 'AACLC', 'HEAACV1'];
    case 'HI_RES_LOSSLESS':
      return ['FLAC_HIRES', 'FLAC', 'AACLC', 'HEAACV1'];
    default:
      return ['FLAC_HIRES', 'FLAC', 'AACLC', 'HEAACV1'];
  }
}

function normalizeApiBase(base) {
  return String(base || '').trim().replace(/\/$/u, '');
}

function parseRetryAfterMs(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1000, Math.ceil(seconds * 1000));
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(1000, dateMs - Date.now());
  }
  return null;
}

function formatRemainingSeconds(until) {
  return Math.max(1, Math.ceil((Number(until) - Date.now()) / 1000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function detectExtension(buffer, contentType = '') {
  const normalizedContentType = String(contentType || '').toLowerCase();
  if (normalizedContentType.includes('flac')) return 'flac';
  if (buffer.length >= 4 && buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) return 'flac';
  if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return normalizedContentType.includes('video') ? 'mp4' : 'm4a';
  }
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'mp3';
  if (normalizedContentType.includes('mpeg')) return 'mp3';
  if (normalizedContentType.includes('mp4')) return 'm4a';
  return 'flac';
}

async function streamToBuffer(stream) {
  const chunks = [];
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => (c instanceof Uint8Array ? Buffer.from(c) : c)));
}

/**
 * MonochromeClient - Download client inspired by monodownload (atvalerie/monodownload)
 * Supports:
 * - Direct TIDAL trackManifests via OAuth2
 * - Monochrome API trackManifests endpoint with instance cooldown
 * - DASH/HLS/direct file stream downloading
 * - Instance-level rate limit cooldown tracking
 * - Basic/Bearer auth for Monochrome instances
 */
export class MonochromeClient {
  constructor({
    apiBase,
    apiInstances = DEFAULT_API_INSTANCES,
    quality = DEFAULT_QUALITY,
    tidalClientId = TIDAL_BROWSER_CLIENT_ID,
    tidalClientSecret = TIDAL_BROWSER_CLIENT_SECRET,
  } = {}) {
    this.apiBase = apiBase;
    this.apiInstances = apiInstances;
    this.quality = quality;
    this.tidalClientId = tidalClientId;
    this.tidalClientSecret = tidalClientSecret;
    this.tidalToken = null;
    this.tidalTokenExpiry = 0;
    this.instanceCooldownMs = Number(process.env.MONOCHROME_INSTANCE_COOLDOWN_MS || DEFAULT_INSTANCE_RATE_LIMIT_COOLDOWN_MS);
    this.instanceEndpointCooldowns = new Map();
    this.instanceProfiles = new Map();
    this.instanceValidatedTokens = new Map();
  }

  getApiBases() {
    return this.apiBase ? [this.apiBase] : this.apiInstances;
  }

  getEndpointKey(relativePath) {
    const match = String(relativePath).match(/^\/([^/?#]+)/u);
    return match ? `/${match[1].toLowerCase()}` : '/';
  }

  getEndpointCooldownUntil(base, endpointKey) {
    return this.instanceEndpointCooldowns.get(`${String(base)}::${endpointKey}`) || 0;
  }

  noteEndpointResponse(base, endpointKey, status, headers = null) {
    const mapKey = `${String(base)}::${endpointKey}`;
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(headers?.get?.('retry-after'));
      const cooldownUntil = Date.now() + (retryAfterMs ?? this.instanceCooldownMs);
      this.instanceEndpointCooldowns.set(mapKey, cooldownUntil);
      logger.warn({ base, endpointKey, cooldownUntil }, 'Endpoint cooldown set (429 rate limited)');
      return;
    }
    if (status >= 200 && status < 300) {
      if (this.instanceEndpointCooldowns.delete(mapKey)) {
        logger.info({ base, endpointKey }, 'Endpoint cooldown cleared');
      }
    }
  }

  async getApiBasesForEndpoint(endpointKey) {
    while (true) {
      const now = Date.now();
      const preferred = [];
      const coolingDown = [];

      for (const base of this.getApiBases()) {
        const cooldownUntil = this.getEndpointCooldownUntil(base, endpointKey);
        if (cooldownUntil > now) {
          coolingDown.push({ base, cooldownUntil });
        } else {
          preferred.push(base);
        }
      }

      coolingDown.sort((left, right) => left.cooldownUntil - right.cooldownUntil);

      if (coolingDown.length) {
        const suffix = coolingDown.map(({ base, cooldownUntil }) => `${base} (${formatRemainingSeconds(cooldownUntil)}s)`).join(', ');
        logger.info({ endpointKey, cooldowns: suffix }, 'Endpoint cooldown active');
      }

      if (preferred.length || !coolingDown.length) {
        return [...preferred, ...coolingDown.map((entry) => entry.base)];
      }

      const nextReady = coolingDown[0];
      const waitMs = Math.max(250, nextReady.cooldownUntil - Date.now());
      logger.info({ base: nextReady.base, endpointKey, waitMs }, 'Waiting for endpoint cooldown');
      await sleep(waitMs);
    }
  }

  async fetchDirectTidalToken(force = false) {
    if (!force && this.tidalToken && Date.now() < this.tidalTokenExpiry) {
      return this.tidalToken;
    }

    const params = new URLSearchParams({
      client_id: this.tidalClientId,
      client_secret: this.tidalClientSecret,
      grant_type: 'client_credentials',
    });

    logger.info('Fetching TIDAL OAuth2 app token...');
    const response = await fetch('https://auth.tidal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.tidalClientId}:${this.tidalClientSecret}`).toString('base64')}`,
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Failed to obtain TIDAL app token: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const token = payload?.access_token;
    const expiresIn = Number(payload?.expires_in || 3600);

    if (!token) {
      throw new Error('TIDAL app token response did not include access_token');
    }

    this.tidalToken = token;
    this.tidalTokenExpiry = Date.now() + Math.max(0, expiresIn - 60) * 1000;
    logger.info({ expiresIn }, 'TIDAL app token obtained');
    return token;
  }

  async tryDirectTidalTrackManifest(trackId) {
    const params = new URLSearchParams();
    params.append('adaptive', 'true');
    params.append('manifestType', 'MPEG_DASH');
    params.append('uriScheme', 'HTTPS');
    params.append('usage', 'PLAYBACK');
    for (const format of getManifestFormatsForQuality(this.quality)) {
      params.append('formats', format);
    }

    const url = `https://openapi.tidal.com/v2/trackManifests/${encodeURIComponent(trackId)}?${params.toString()}`;
    let token = await this.fetchDirectTidalToken(false);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      logger.info({ type: 'tidal', url }, 'Direct TIDAL trackManifests request');
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
      });

      if (response.status === 401 && attempt === 0) {
        token = await this.fetchDirectTidalToken(true);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Direct TIDAL trackManifests failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      const attributes = payload?.data?.attributes || payload?.data?.data?.attributes || null;
      const uri = attributes?.uri || null;
      const trackPresentation = attributes?.trackPresentation || 'unknown';
      const previewReason = attributes?.previewReason || null;

      logger.info({
        type: 'tidal',
        trackPresentation,
        previewReason,
        uriPresent: Boolean(uri),
      }, 'Direct TIDAL manifest response');

      if (String(trackPresentation).toUpperCase() === 'PREVIEW') {
        logger.info('Skipping direct TIDAL manifest - preview only');
        return null;
      }

      if (!uri) {
        throw new Error('Direct TIDAL trackManifests response did not include uri');
      }

      return uri;
    }

    return null;
  }

  async tryTrackManifestEndpoint(base, trackId) {
    const params = new URLSearchParams();
    for (const format of getManifestFormatsForQuality(this.quality)) {
      params.append('formats', format);
    }
    params.append('adaptive', 'true');
    params.append('manifestType', 'MPEG_DASH');
    params.append('uriScheme', 'HTTPS');
    params.append('usage', 'PLAYBACK');

    const url = `${base.replace(/\/$/u, '')}/trackManifests/?id=${encodeURIComponent(trackId)}&${params.toString()}`;
    logger.info({ type: 'api', base, trackId }, 'Monochrome trackManifests request');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }

    const payload = await response.json();
    const attributes = payload?.data?.data?.attributes || null;
    const uri = attributes?.uri || null;
    const trackPresentation = attributes?.trackPresentation || 'unknown';
    const previewReason = attributes?.previewReason || null;

    logger.info({
      type: 'api',
      base,
      trackPresentation,
      previewReason,
      uriPresent: Boolean(uri),
    }, 'Monochrome trackManifests response');

    if (String(trackPresentation).toUpperCase() === 'PREVIEW') {
      throw new Error(`Preview-only trackManifests response on ${base}${previewReason ? `: ${previewReason}` : ''}`);
    }

    if (!uri) {
      throw new Error('Monochrome trackManifests response did not include uri');
    }

    return uri;
  }

  async resolveTrackStream(trackId) {
    const diagnostics = [];

    // Try Monochrome API trackManifests endpoint across instances
    const manifestFromApi = await this.tryTrackManifestEndpointAcrossInstances(trackId).catch((error) => {
      diagnostics.push(error instanceof Error ? error.message : String(error));
      return null;
    });
    if (manifestFromApi) {
      return manifestFromApi;
    }

    // Try direct TIDAL trackManifests
    const directManifest = await this.tryDirectTidalTrackManifest(trackId).catch((error) => {
      diagnostics.push(error instanceof Error ? error.message : String(error));
      return null;
    });
    if (directManifest) {
      logger.info({ trackId }, 'Stream source: direct TIDAL trackManifests');
      return await this.downloadFromResolvedUri(directManifest);
    } else {
      diagnostics.push('Direct TIDAL manifest unavailable or preview-only');
    }

    throw new Error(`Could not resolve stream from trackManifests${diagnostics.length ? `: ${diagnostics.join(' | ')}` : ''}`);
  }

  async tryTrackManifestEndpointAcrossInstances(trackId) {
    const bases = await this.getApiBasesForEndpoint('/trackmanifests');
    let lastError = null;

    for (const base of bases) {
      try {
        const uri = await this.tryTrackManifestEndpoint(base, trackId);
        logger.info({ trackId }, 'Stream source: trackManifests endpoint fallback');
        return await this.downloadFromResolvedUri(uri);
      } catch (error) {
        lastError = error;
        logger.warn({ base, error: error.message }, 'TrackManifests failed on instance');
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error('trackManifests path unavailable on all instances');
  }

  async downloadFromResolvedUri(uri) {
    if (typeof uri !== 'string') {
      throw new Error('Unsupported stream URI');
    }

    if (uri.includes('.m3u8')) {
      logger.info({ uri }, 'Resolved URI kind: HLS');
      return await this.downloadHls(uri);
    }

    if (uri.includes('.mpd')) {
      logger.info({ uri }, 'Resolved URI kind: DASH URL');
      try {
        const manifestResponse = await fetch(uri);
        if (!manifestResponse.ok) {
          throw new Error(`Failed to fetch DASH manifest: ${manifestResponse.status}`);
        }
        const manifestText = await manifestResponse.text();
        return await this.downloadDashManifestText(manifestText, uri);
      } catch (error) {
        logger.warn({ error: error.message }, 'Manual DASH download failed, retrying via ffmpeg');
        return await this.downloadDashViaFfmpeg(uri);
      }
    }

    logger.info({ uri }, 'Resolved URI kind: direct file');
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Failed to fetch stream: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'audio/flac',
    };
  }

  async downloadHls(masterUrl) {
    const masterResponse = await fetch(masterUrl);
    if (!masterResponse.ok) {
      throw new Error(`Failed to fetch HLS manifest: ${masterResponse.status}`);
    }
    const masterText = await masterResponse.text();
    const variantUrl = this.resolveBestHlsVariant(masterUrl, masterText);
    const playlistResponse = await fetch(variantUrl);
    if (!playlistResponse.ok) {
      throw new Error(`Failed to fetch HLS playlist: ${playlistResponse.status}`);
    }
    const playlistText = await playlistResponse.text();
    const segmentUrls = playlistText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => new URL(line, variantUrl).href);

    const chunks = [];
    for (const segmentUrl of segmentUrls) {
      const segmentResponse = await fetch(segmentUrl);
      if (!segmentResponse.ok) {
        throw new Error(`Failed to fetch HLS segment: ${segmentResponse.status}`);
      }
      chunks.push(Buffer.from(await segmentResponse.arrayBuffer()));
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType: 'audio/flac',
    };
  }

  resolveBestHlsVariant(masterUrl, masterText) {
    if (!masterText.includes('#EXT-X-STREAM-INF')) {
      return masterUrl;
    }
    const lines = masterText.split(/\r?\n/u);
    const variants = [];
    let currentBandwidth = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
        const match = trimmed.match(/BANDWIDTH=(\d+)/u);
        currentBandwidth = match ? Number(match[1]) : 0;
        continue;
      }
      if (trimmed && !trimmed.startsWith('#')) {
        variants.push({ bandwidth: currentBandwidth, url: new URL(trimmed, masterUrl).href });
        currentBandwidth = 0;
      }
    }
    variants.sort((left, right) => right.bandwidth - left.bandwidth);
    return variants[0]?.url || masterUrl;
  }

  async downloadDashViaFfmpeg(manifestUrl) {
    const tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), '.dash-'));
    try {
      const args = ['-y', '-i', manifestUrl, '-map', '0:a:0', '-c', 'copy', '-f', 'flac', path.join(tempDir, 'dash-output.flac')];
      const { execFile } = await import('child_process');
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`ffmpeg failed: ${stderr?.toString() || error.message}`));
            return;
          }
          resolve();
        });
      });
      const buffer = await fs.promises.readFile(path.join(tempDir, 'dash-output.flac'));
      return { buffer, contentType: 'audio/flac' };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async downloadDashManifestText(manifestText, manifestUrl = null) {
    const manifest = this.parseDashManifest(manifestText, manifestUrl);
    if (this.isPreviewDashManifest(manifest)) {
      throw new Error(`Preview DASH manifest detected: duration=${manifest.durationSeconds}s`);
    }
    const urls = this.generateDashSegmentUrls(manifest);
    if (!urls.length) {
      throw new Error('No DASH segment URLs were generated');
    }

    logger.info({
      repId: manifest.repId,
      bandwidth: manifest.bandwidth,
      mimeType: manifest.mimeType,
      segments: Math.max(0, urls.length - 1),
      duration: manifest.durationSeconds,
    }, 'DASH segment download starting');

    const chunks = [];
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      let response = await fetch(url);
      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch DASH segment ${index + 1}/${urls.length}: ${response.status}`);
        }
      }
      chunks.push(Buffer.from(await response.arrayBuffer()));
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType: this.inferDashMimeType(manifest),
    };
  }

  parseDashManifest(manifestText, manifestUrl = null) {
    const xml = this.decodeXmlEntities(String(manifestText || ''));
    if (!xml.includes('<MPD')) {
      throw new Error('Invalid DASH manifest');
    }

    const mpdBaseUrl = this.extractFirstTagText(xml, 'BaseURL') || '';
    const periodBody = this.extractFirstTagInner(xml, 'Period') || xml;
    const adaptationSets = this.extractTagBlocks(periodBody, 'AdaptationSet').map((block) => ({
      attrs: this.parseXmlAttributes(block.attrs),
      body: block.body,
    }));

    if (!adaptationSets.length) {
      throw new Error('No AdaptationSet found');
    }

    adaptationSets.sort((left, right) => this.getMaxRepresentationBandwidth(right.body) - this.getMaxRepresentationBandwidth(left.body));

    let audioSet = adaptationSets.find((set) => String(set.attrs.mimeType || '').toLowerCase().startsWith('audio')) || adaptationSets[0];

    const representations = this.extractTagBlocks(audioSet.body, 'Representation')
      .map((block) => ({ attrs: this.parseXmlAttributes(block.attrs), body: block.body }))
      .sort((left, right) => Number(right.attrs.bandwidth || 0) - Number(left.attrs.bandwidth || 0));

    if (!representations.length) {
      throw new Error('No Representation found');
    }

    const representation = representations[0];
    const segmentTemplateBlock = this.extractFirstTagBlock(representation.body, 'SegmentTemplate') || this.extractFirstTagBlock(audioSet.body, 'SegmentTemplate');
    if (!segmentTemplateBlock) {
      throw new Error('No SegmentTemplate found');
    }

    const segmentTemplateAttrs = this.parseXmlAttributes(segmentTemplateBlock.attrs);
    const baseUrl =
      this.extractFirstTagText(representation.body, 'BaseURL') ||
      this.extractFirstTagText(audioSet.body, 'BaseURL') ||
      this.extractFirstTagText(periodBody, 'BaseURL') ||
      mpdBaseUrl ||
      this.deriveDashBaseUrl(manifestUrl);

    const timelineBlock = this.extractFirstTagBlock(segmentTemplateBlock.body, 'SegmentTimeline');
    const startNumber = Number(segmentTemplateAttrs.startNumber || 1);
    const segments = [];

    if (timelineBlock) {
      let currentTime = 0;
      let currentNumber = startNumber;
      const segmentEntries = this.extractSelfClosingOrOpenTags(timelineBlock.body, 'S');
      for (const entry of segmentEntries) {
        const attrs = this.parseXmlAttributes(entry.attrs);
        const duration = Number(attrs.d || 0);
        const repeat = Number(attrs.r || 0);
        if (attrs.t != null) currentTime = Number(attrs.t);
        segments.push({ number: currentNumber, time: currentTime });
        currentTime += duration;
        currentNumber += 1;
        for (let index = 0; index < repeat; index += 1) {
          segments.push({ number: currentNumber, time: currentTime });
          currentTime += duration;
          currentNumber += 1;
        }
      }
    }

    return {
      baseUrl,
      initialization: segmentTemplateAttrs.initialization || null,
      media: segmentTemplateAttrs.media || null,
      segments,
      repId: representation.attrs.id || null,
      mimeType: audioSet.attrs.mimeType || representation.attrs.mimeType || null,
      bandwidth: Number(representation.attrs.bandwidth || 0),
      codecs: representation.attrs.codecs || audioSet.attrs.codecs || null,
      audioSamplingRate: representation.attrs.audioSamplingRate || null,
      durationSeconds: this.computeDashDurationSeconds(segments, segmentTemplateBlock.body, segmentTemplateAttrs.timescale),
    };
  }

  generateDashSegmentUrls(manifest) {
    const urls = [];
    const { baseUrl, initialization, media, segments, repId } = manifest;
    const resolveTemplate = (template, number, time) =>
      template
        .replace(/\$RepresentationID\$/gu, repId || '')
        .replace(/\$Number(?:%0([0-9]+)d)?\$/gu, (_match, width) => (width ? String(number).padStart(Number(width), '0') : String(number)))
        .replace(/\$Time(?:%0([0-9]+)d)?\$/gu, (_match, width) => (width ? String(time).padStart(Number(width), '0') : String(time)));

    if (initialization) {
      urls.push(this.resolveDashUrl(baseUrl, resolveTemplate(initialization, 0, 0)));
    }

    if (media && segments.length) {
      for (const segment of segments) {
        urls.push(this.resolveDashUrl(baseUrl, resolveTemplate(media, segment.number, segment.time)));
      }
    }

    return urls;
  }

  inferDashMimeType(manifest) {
    const mimeType = String(manifest?.mimeType || '').toLowerCase();
    const codecs = String(manifest?.codecs || '').toLowerCase();
    if (mimeType.includes('flac') || codecs.includes('flac')) return 'audio/flac';
    if (mimeType.includes('mp4') || codecs.includes('mp4a') || codecs.includes('aac') || codecs.includes('alac')) return 'audio/mp4';
    return 'audio/flac';
  }

  resolveDashUrl(base, part) {
    if (!base) return part;
    if (/^https?:\/\//iu.test(part)) return part;
    return new URL(part, base.endsWith('/') ? base : `${base}/`).href;
  }

  deriveDashBaseUrl(manifestUrl) {
    if (!manifestUrl) return '';
    try {
      return new URL('.', manifestUrl).href;
    } catch {
      return '';
    }
  }

  decodeXmlEntities(value) {
    return String(value)
      .replace(/&amp;/gu, '&')
      .replace(/&quot;/gu, '"')
      .replace(/&apos;/gu, "'")
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>');
  }

  parseXmlAttributes(attrs) {
    const result = {};
    const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gu;
    let match = pattern.exec(attrs);
    while (match) {
      result[match[1]] = this.decodeXmlEntities(match[2]);
      match = pattern.exec(attrs);
    }
    return result;
  }

  extractTagBlocks(xml, tagName) {
    const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}>`, 'gu');
    const blocks = [];
    let match = pattern.exec(xml);
    while (match) {
      blocks.push({ attrs: match[1] || '', body: match[2] || '' });
      match = pattern.exec(xml);
    }
    return blocks;
  }

  extractFirstTagBlock(xml, tagName) {
    return this.extractTagBlocks(xml, tagName)[0] || null;
  }

  extractFirstTagInner(xml, tagName) {
    return this.extractFirstTagBlock(xml, tagName)?.body || null;
  }

  extractFirstTagText(xml, tagName) {
    const block = this.extractFirstTagBlock(xml, tagName);
    return block ? this.decodeXmlEntities(block.body.trim()) : null;
  }

  extractSelfClosingOrOpenTags(xml, tagName) {
    const pattern = new RegExp(`<${tagName}\\b([^>/]*?)(?:/?>)`, 'gu');
    const tags = [];
    let match = pattern.exec(xml);
    while (match) {
      tags.push({ attrs: match[1] || '' });
      match = pattern.exec(xml);
    }
    return tags;
  }

  getMaxRepresentationBandwidth(xml) {
    const representations = this.extractTagBlocks(xml, 'Representation');
    if (!representations.length) return 0;
    return Math.max(...representations.map((block) => Number(this.parseXmlAttributes(block.attrs).bandwidth || 0)));
  }

  computeDashDurationSeconds(segments, segmentTimelineXml, timescaleValue) {
    const timescale = Number(timescaleValue || 1);
    if (!segments.length || !timescale) return 0;
    const segmentEntries = this.extractSelfClosingOrOpenTags(segmentTimelineXml, 'S').map((entry) => this.parseXmlAttributes(entry.attrs));
    let totalUnits = 0;
    for (const entry of segmentEntries) {
      const duration = Number(entry.d || 0);
      const repeat = Number(entry.r || 0);
      totalUnits += duration * (repeat + 1);
    }
    return totalUnits / timescale;
  }

  isPreviewDashManifest(manifest) {
    const repId = String(manifest?.repId || '').toLowerCase();
    const likelyPreviewDuration = Number(manifest?.durationSeconds || 0) > 0 && Number(manifest.durationSeconds) <= 35;
    const likelyPreviewRep = repId.includes('preview');
    return likelyPreviewRep || likelyPreviewDuration;
  }

  /**
   * Download a track to a file path.
   * Returns { extension, buffer, contentType, size }
   */
  async downloadTrack(trackId) {
    const streamResult = await this.resolveTrackStream(trackId);
    const buffer = Buffer.isBuffer(streamResult.buffer) ? streamResult.buffer : await streamToBuffer(streamResult);
    const extension = detectExtension(buffer, streamResult.contentType);
    logger.info({ trackId, extension, contentType: streamResult.contentType, bytes: buffer.length }, 'Track downloaded');
    return { extension, buffer, contentType: streamResult.contentType, size: buffer.length };
  }
}

export default MonochromeClient;