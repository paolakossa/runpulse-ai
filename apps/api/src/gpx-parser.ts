import { SaxesParser } from 'saxes';
import type { Activity, ActivitySample, ActivitySegment } from './activity.ts';

export const MAX_GPX_BYTES = 10 * 1024 * 1024;

/** Inclusive budgets, counted across the entire XML, including ignored content. */
export const GPX_LIMITS = Object.freeze({
  depth: 64,
  elements: 500_000,
  attributes: 250_000,
  attributesPerElement: 32,
  points: 100_000,
});
const GPX_VERSIONS = new Map([['http://www.topografix.com/GPX/1/0', '1.0'], ['http://www.topografix.com/GPX/1/1', '1.1']]);
const GARMIN_NAMESPACES = new Set(['http://www.garmin.com/xmlschemas/TrackPointExtension/v1', 'http://www.garmin.com/xmlschemas/TrackPointExtension/v2']);

type ImportErrorCode = 'INPUT_TOO_LARGE' | 'UNSAFE_XML' | 'INVALID_XML' | 'INVALID_ACTIVITY' | 'RESOURCE_LIMIT';

/** Safe to surface to callers: messages never contain XML or sensor/location values. */
export class ActivityImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'ActivityImportError';
    this.code = code;
  }
}

function invalid(message: string): never {
  throw new ActivityImportError('INVALID_ACTIVITY', message);
}

function decimal(value: unknown): number {
  if (typeof value === 'string') value = value.trim();
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    invalid('Expected a decimal numeric value.');
  }
  const result = Number(value);
  if (!Number.isFinite(result)) invalid('Numeric values must be finite.');
  return result;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') invalid('A timestamp is required for each point.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) invalid('Timestamps must include a date, time and timezone.');
  const [, y, m, d, h, min, s, , , , oh = '0', om = '0'] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(h) > 23 || Number(min) > 59 || Number(s) > 59 || Number(oh) > 14 || Number(om) > 59 || (Number(oh) === 14 && Number(om) !== 0)) {
    invalid('Timestamp contains an invalid calendar date or time.');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalid('Timestamp is invalid.');
  return new Date(milliseconds).toISOString();
}

type Kind = 'root' | 'track' | 'segment' | 'point' | 'extensions' | 'garmin' | 'scalar' | 'ignored';
type Field = 'timestamp' | 'elevationMeters' | 'heartRateBpm';
interface Frame {
  kind: Kind;
  uri: string;
  field?: Field;
  text: string;
  seen?: Set<string>;
}

function limit(exceeded: boolean): void {
  if (exceeded) throw new ActivityImportError('RESOURCE_LIMIT', 'XML exceeds an activity import resource limit.');
}

function decode(input: string | Uint8Array): string {
  const size = typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength;
  if (size > MAX_GPX_BYTES) throw new ActivityImportError('INPUT_TOO_LARGE', 'GPX exceeds the 10 MiB limit.');
  try {
    return typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new ActivityImportError('INVALID_XML', 'GPX must contain valid UTF-8 XML.');
  }
}

/** Saxes owns XML validation; this handler only recognizes the GPX ingestion subset. */
export function parseGpx(input: string | Uint8Array): Activity {
  const xml = decode(input);
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true });
  const stack: Frame[] = [];
  const segments: ActivitySegment[] = [];
  let samples: ActivitySample[] = [];
  let pending: Omit<ActivitySample, 'timestamp'> & { timestamp?: string } = {};
  let gpxNamespace = '';
  let elementCount = 0, attributeCount = 0, tagAttributeCount = 0, pointCount = 0;

  parser.on('error', () => { throw new ActivityImportError('INVALID_XML', 'Malformed XML.'); });
  parser.on('doctype', () => { throw new ActivityImportError('UNSAFE_XML', 'DOCTYPE declarations are forbidden.'); });
  parser.on('xmldecl', declaration => {
    if (declaration.version !== '1.0' || (declaration.encoding && declaration.encoding.toLowerCase() !== 'utf-8')) {
      throw new ActivityImportError('INVALID_XML', 'Only XML 1.0 with UTF-8 encoding is supported.');
    }
  });
  // These events run before allocating our frames or normalized observations.
  parser.on('opentagstart', () => {
    limit(++elementCount > GPX_LIMITS.elements || stack.length + 1 > GPX_LIMITS.depth);
    tagAttributeCount = 0;
  });
  parser.on('attribute', () => {
    limit(++attributeCount > GPX_LIMITS.attributes || ++tagAttributeCount > GPX_LIMITS.attributesPerElement);
  });
  parser.on('opentag', tag => {
    const parent = stack.at(-1);
    if (parent?.kind === 'scalar') invalid('Scalar activity fields cannot contain child elements.');
    const frame: Frame = { kind: 'ignored', uri: tag.uri, text: '' };
    const core = tag.uri === gpxNamespace;
    const unqualified = (name: string): string | undefined => {
      const attribute = tag.attributes[name];
      return attribute?.uri === '' ? attribute.value : undefined;
    };
    if (!parent) {
      if (tag.local !== 'gpx' || (tag.uri !== '' && !GPX_VERSIONS.has(tag.uri))) invalid('Expected a supported GPX root.');
      gpxNamespace = tag.uri;
      const version = unqualified('version');
      if (version !== undefined && (tag.uri === '' ? !['1.0', '1.1'].includes(version) : version !== GPX_VERSIONS.get(tag.uri))) {
        invalid('GPX version does not match a supported namespace.');
      }
      frame.kind = 'root';
    } else if (core && parent.kind === 'root' && tag.local === 'trk') {
      frame.kind = 'track';
    } else if (core && parent.kind === 'track' && tag.local === 'trkseg') {
      frame.kind = 'segment';
      samples = [];
    } else if (core && parent.kind === 'segment' && tag.local === 'trkpt') {
      limit(++pointCount > GPX_LIMITS.points);
      frame.kind = 'point';
      const latitude = decimal(unqualified('lat'));
      const longitude = decimal(unqualified('lon'));
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) invalid('Coordinates are outside their valid ranges.');
      pending = { position: { latitude, longitude } };
    } else if (core && parent.kind === 'point' && (tag.local === 'time' || tag.local === 'ele')) {
      frame.kind = 'scalar';
      frame.field = tag.local === 'time' ? 'timestamp' : 'elevationMeters';
    } else if (core && parent.kind === 'point' && tag.local === 'extensions') {
      frame.kind = 'extensions';
    } else if (parent.kind === 'extensions' && GARMIN_NAMESPACES.has(tag.uri) && tag.local === 'TrackPointExtension') {
      frame.kind = 'garmin';
    } else if (parent.kind === 'garmin' && tag.uri === parent.uri && tag.local === 'hr') {
      frame.kind = 'scalar';
      frame.field = 'heartRateBpm';
    }
    if (parent && ['scalar', 'extensions', 'garmin'].includes(frame.kind)) {
      const key = frame.field ?? frame.kind;
      parent.seen ??= new Set();
      if (parent.seen.has(key)) invalid('Duplicate activity field.');
      parent.seen.add(key);
    }
    stack.push(frame);
  });
  const text = (value: string): void => {
    const frame = stack.at(-1);
    if (frame?.kind === 'scalar') frame.text += value;
    else if (frame && frame.kind !== 'ignored' && value.trim() !== '') invalid('Unexpected text in an activity element.');
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const frame = stack.pop()!;
    if (frame.kind === 'scalar') {
      const value = frame.text.trim();
      if (frame.field === 'timestamp') pending.timestamp = timestamp(value);
      else if (frame.field === 'elevationMeters') pending.elevationMeters = decimal(value);
      else {
        const bpm = decimal(value);
        if (!Number.isSafeInteger(bpm) || bpm <= 0) invalid('Heart rate must be a positive integer.');
        pending.heartRateBpm = bpm;
      }
    } else if (frame.kind === 'point') {
      if (pending.timestamp === undefined) invalid('A timestamp is required for each point.');
      const previous = samples.at(-1);
      if (previous && Date.parse(pending.timestamp) < Date.parse(previous.timestamp)) invalid('Timestamps must not go backwards within a segment.');
      samples.push({ ...pending, timestamp: pending.timestamp });
    } else if (frame.kind === 'segment' && samples.length > 0) {
      segments.push({ samples });
    }
  });
  parser.write(xml).close();
  if (segments.length === 0) invalid('GPX must contain usable track points.');
  return { segments };
}
