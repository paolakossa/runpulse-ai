import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpx, ActivityImportError, MAX_GPX_BYTES } from './gpx-parser.ts';
import { gpx, point } from './gpx-fixtures.ts';

function rejects(xml: string | Uint8Array, code: string): void {
  assert.throws(() => parseGpx(xml), (error: unknown) =>
    error instanceof ActivityImportError && error.code === code);
}

test('normalizes coordinates, UTC timestamps, elevation and Garmin heart rate', () => {
  const result = parseGpx(gpx(point({ lat: '-12.5', lon: '43.25', time: '2026-01-01T03:00:00.125+03:00', elevation: '-4.5',
    extra: '<extensions><t:TrackPointExtension xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><t:hr>145</t:hr></t:TrackPointExtension></extensions>' })));
  assert.deepEqual(result, { segments: [{ samples: [{ position: { latitude: -12.5, longitude: 43.25 },
    timestamp: '2026-01-01T00:00:00.125Z', elevationMeters: -4.5, heartRateBpm: 145 }] }] });
});

test('missing sensors stay absent and actual zero elevation stays zero', () => {
  const samples = parseGpx(gpx(point() + point({ elevation: '0' }))).segments[0].samples;
  assert.equal('elevationMeters' in samples[0], false);
  assert.equal('heartRateBpm' in samples[0], false);
  assert.equal(samples[1].elevationMeters, 0);
});

test('retains disconnected segments and multiple tracks in document order', () => {
  const xml = `<gpx><trk><trkseg>${point()}</trkseg><trkseg>${point({ lat: '80' })}</trkseg></trk><trk><trkseg>${point({ lat: '-80' })}</trkseg></trk></gpx>`;
  assert.deepEqual(parseGpx(xml).segments.map(s => s.samples.map(p => p.position?.latitude)), [[0], [80], [-80]]);
  assert.equal('distanceMeters' in parseGpx(xml), false);
});

test('accepts UTF-8 bytes, BOM, prefixed GPX and coordinate boundaries', () => {
  assert.deepEqual(parseGpx(Buffer.from('\ufeff' + gpx())), parseGpx(gpx()));
  const prefixed = '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg><g:trkpt lat="90" lon="-180"><g:time>2024-02-29T00:00:00Z</g:time></g:trkpt></g:trkseg></g:trk></g:gpx>';
  assert.deepEqual(parseGpx(prefixed).segments[0].samples[0].position, { latitude: 90, longitude: -180 });
  assert.doesNotThrow(() => parseGpx(gpx(point({ lat: '-90', lon: '180' }))));
});

test('enforces a 10 MiB byte limit before parsing, including multibyte text', () => {
  assert.equal(MAX_GPX_BYTES, 10 * 1024 * 1024);
  const base = gpx();
  const exact = base + ' '.repeat(MAX_GPX_BYTES - Buffer.byteLength(base));
  assert.doesNotThrow(() => parseGpx(exact));
  rejects(exact + ' ', 'INPUT_TOO_LARGE');
  rejects(Buffer.alloc(MAX_GPX_BYTES + 1), 'INPUT_TOO_LARGE');
  rejects('é'.repeat(MAX_GPX_BYTES / 2 + 1), 'INPUT_TOO_LARGE');
});

test('rejects external, internal, parameter and standalone entity declarations', () => {
  for (const declaration of [
    '<!DOCTYPE gpx SYSTEM "file:///synthetic-secret">',
    '<!DOCTYPE gpx SYSTEM "https://example.invalid/external.dtd">',
    '<!DOCTYPE gpx [<!ENTITY x "expanded">]>',
    '<!DOCTYPE gpx [<!ENTITY % x SYSTEM "https://example.invalid/evil">%x;]>',
  ]) rejects(declaration + gpx(), 'UNSAFE_XML');
  for (const declaration of ['<!ENTITY x "expanded">', '<!doctype gpx>']) rejects(declaration + gpx(), 'INVALID_XML');
});

test('rejects malformed XML, duplicate attributes, multiple roots and invalid UTF-8', () => {
  for (const xml of ['', '<gpx>', '<gpx><trk></gpx>', '<gpx lat="1" lat="2"/>',
    gpx() + gpx(), gpx() + '<other/>', 'garbage' + gpx(), gpx().replace('</time>', '</oops>')]) {
    rejects(xml, 'INVALID_XML');
  }
  rejects(new Uint8Array([0xc3, 0x28]), 'INVALID_XML');
});

test('rejects forbidden XML characters and excessive nesting even in ignored metadata', () => {
  for (const character of ['\u0000', '\u0001', '\uffff', '\ud800']) {
    rejects(gpx().replace('<trk>', `<metadata>${character}</metadata><trk>`), 'INVALID_XML');
  }
  rejects(gpx().replace('<trk>', `<metadata>${'<nested>'.repeat(65)}${'</nested>'.repeat(65)}</metadata><trk>`), 'RESOURCE_LIMIT');
});

test('rejects wrong structure and activities with no usable points', () => {
  rejects('<other/>', 'UNSUPPORTED_FORMAT');
  for (const xml of ['<gpx/>', '<gpx><trk/></gpx>', gpx(''),
    '<gpx><rte><rtept lat="0" lon="0"/></rte></gpx>', `<gpx>${point()}</gpx>`]) rejects(xml, 'INVALID_ACTIVITY');
});

test('rejects missing, out-of-range and nondecimal coordinates', () => {
  for (const value of ['', 'NaN', 'Infinity', '0x10', '1e2', '12x', '91', '-91']) {
    rejects(gpx(point({ lat: value })), 'INVALID_ACTIVITY');
  }
  for (const value of ['', '181', '-181', 'NaN']) rejects(gpx(point({ lon: value })), 'INVALID_ACTIVITY');
  rejects(gpx(point().replace('lat="0"', '')), 'INVALID_ACTIVITY');
  rejects(gpx(point().replace('lon="0"', '')), 'INVALID_ACTIVITY');
});

test('requires real calendar timestamps with an explicit timezone', () => {
  for (const time of ['', 'yesterday', '2026-01-01', '2026-01-01T00:00:00',
    '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+01:60']) {
    rejects(gpx(point({ time })), 'INVALID_ACTIVITY');
  }
  rejects(gpx(point().replace(/<time>.*<\/time>/, '')), 'INVALID_ACTIVITY');
  rejects(gpx(point({ extra: '<time>2026-01-01T00:00:00Z</time>' })), 'INVALID_ACTIVITY');
});

test('preserves duplicate timestamps but rejects backwards time inside a segment', () => {
  assert.equal(parseGpx(gpx(point() + point())).segments[0].samples.length, 2);
  rejects(gpx(point({ time: '2026-01-01T00:00:01Z' }) + point()), 'INVALID_ACTIVITY');
});

test('rejects invalid present sensors instead of silently inventing or dropping values', () => {
  for (const extra of ['<ele/>', '<ele>NaN</ele>', '<ele>1</ele><ele>2</ele>', '<ele><value>2</value></ele>',
    ...['', '0', '-1', '1.5', 'Infinity'].map(hr => `<extensions><TrackPointExtension xmlns="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><hr>${hr}</hr></TrackPointExtension></extensions>`)]) {
    rejects(gpx(point({ extra })), 'INVALID_ACTIVITY');
  }
});

test('ignores unrelated extensions and never exposes input in errors', () => {
  assert.equal(parseGpx(gpx(point({ extra: '<extensions><other><hr>150</hr></other></extensions>' })))
    .segments[0].samples[0].heartRateBpm, undefined);
  assert.throws(() => parseGpx(gpx(point({ lat: 'synthetic-private-value' }))), (error: unknown) =>
    error instanceof Error && !error.message.includes('synthetic-private-value'));
});
