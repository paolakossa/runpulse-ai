import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpx, ActivityImportError } from '../gpx-parser.ts';
import { gpx, point } from '../gpx-fixtures.ts';

const GPX = 'http://www.topografix.com/GPX/1/1';
const GARMIN = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
function rejects(xml: string, code: string): void {
  assert.throws(() => parseGpx(xml), (e: unknown) => e instanceof ActivityImportError && e.code === code);
}
function metadata(content: string): string {
  return gpx().replace('<trk>', `<metadata>${content}</metadata><trk>`);
}

test('foreign attributes cannot overwrite or supply coordinates', () => {
  const foreign = point().replace('lat="0"', 'lat="0" x:lat="45" xmlns:x="urn:foreign"');
  assert.equal(parseGpx(gpx(foreign)).segments[0].samples[0].position?.latitude, 0);
  rejects(gpx(foreign.replace('lat="0" ', '')), 'INVALID_ACTIVITY');
  rejects(gpx(point().replace('lon="0"', 'x:lon="0" xmlns:x="urn:foreign"')), 'INVALID_ACTIVITY');
});

test('GPX 1.0, 1.1 and explicit namespace-free compatibility are supported', () => {
  assert.doesNotThrow(() => parseGpx(gpx().replaceAll(GPX, 'http://www.topografix.com/GPX/1/0').replace('version="1.1"', 'version="1.0"')));
  assert.doesNotThrow(() => parseGpx(gpx().replace(` xmlns="${GPX}"`, '')));
  assert.doesNotThrow(() => parseGpx(`<gpx><trk><trkseg>${point()}</trkseg></trk></gpx>`));
  rejects(gpx().replace(GPX, 'urn:foreign'), 'INVALID_ACTIVITY');
  rejects(gpx().replace('version="1.1"', 'version="2.0"'), 'INVALID_ACTIVITY');
  rejects(gpx().replace('version="1.1"', 'version="1.0"'), 'INVALID_ACTIVITY');
});

test('namespace rebinding is scoped and foreign elements never supply core fields', () => {
  const xml = `<p:gpx xmlns:p="${GPX}"><p:trk><p:trkseg><p:trkpt lat="0" lon="0"><p:time>2026-01-01T00:00:00Z</p:time><p:ele xmlns:p="urn:foreign">999</p:ele><p:ele>10</p:ele></p:trkpt></p:trkseg></p:trk></p:gpx>`;
  assert.equal(parseGpx(xml).segments[0].samples[0].elevationMeters, 10);
  rejects(gpx(point().replace('<time>', '<time xmlns="urn:foreign">')), 'INVALID_ACTIVITY');
  rejects(gpx(point().replace('<time>', '<time xmlns="">')), 'INVALID_ACTIVITY');
  rejects(gpx().replace('<trk>', '<trk xmlns="urn:foreign">'), 'INVALID_ACTIVITY');
  rejects(gpx().replace('<trk>', '<x:trk>').replace('</trk>', '</x:trk>'), 'INVALID_XML');
});

test('only Garmin v1/v2 heart rate is extracted, including default namespaces', () => {
  for (const version of ['v1', 'v2']) {
    const extra = `<extensions><TrackPointExtension xmlns="${GARMIN.replace('v1', version)}"><hr>150</hr><hr xmlns="urn:foreign">999</hr></TrackPointExtension></extensions>`;
    assert.equal(parseGpx(gpx(point({ extra }))).segments[0].samples[0].heartRateBpm, 150);
  }
  for (const uri of ['urn:foreign', GPX, '']) {
    const extra = `<extensions><TrackPointExtension xmlns="${uri}"><hr>999</hr></TrackPointExtension></extensions>`;
    assert.equal(parseGpx(gpx(point({ extra }))).segments[0].samples[0].heartRateBpm, undefined);
  }
});

test('invalid XML anywhere, including ignored metadata and attributes, rejects the import', () => {
  for (const invalid of ['&#0;', '&#xD800;', '&#x110000;', '&undefined;', '<!-- bad -- comment -->',
    '<x a="<"/>', '<x a="&undefined;"/>', '<x a="&#0;"/>', '<![CDATA[unfinished', '<x/>junk]]>']) {
    rejects(metadata(invalid), 'INVALID_XML');
  }
  rejects(gpx() + '<!--unfinished', 'INVALID_XML');
});

test('valid references decode in values while predefined entities in metadata remain safe', () => {
  const xml = gpx(point({ lat: '&#48;', lon: '&#x30;', elevation: '&#49;0', time: '2026-01-01T00:00:00&#90;' }));
  assert.deepEqual(parseGpx(xml), parseGpx(gpx(point({ elevation: '10' }))));
  assert.doesNotThrow(() => parseGpx(metadata('<name>&amp;&lt;&gt;&apos;&quot;&#x1F600;</name>')));
  assert.doesNotThrow(() => parseGpx(metadata('<!-- <!DOCTYPE example> --><name><![CDATA[<!ENTITY example>]]></name>')));
});

test('timezone boundaries accept fourteen hours exactly and reject larger offsets', () => {
  for (const offset of ['+14:00', '-14:00', '+13:59', '-13:59']) {
    assert.doesNotThrow(() => parseGpx(gpx(point({ time: `2026-01-01T00:00:00${offset}` }))));
  }
  for (const offset of ['+14:01', '-14:01', '+15:00', '-15:00', '+23:59']) {
    rejects(gpx(point({ time: `2026-01-01T00:00:00${offset}` })), 'INVALID_ACTIVITY');
  }
});

test('fractional seconds beyond milliseconds reject rather than hiding backwards time', () => {
  for (const fraction of ['1', '12', '123']) assert.doesNotThrow(() => parseGpx(gpx(point({ time: `2026-01-01T00:00:00.${fraction}Z` }))));
  for (const fraction of ['0000', '0009', '123456789']) rejects(gpx(point({ time: `2026-01-01T00:00:00.${fraction}Z` })), 'INVALID_ACTIVITY');
  rejects(gpx(point({ time: '2026-01-01T00:00:00.0009Z' }) + point({ time: '2026-01-01T00:00:00.0001Z' })), 'INVALID_ACTIVITY');
});

test('ordering compares instants across offsets and retains distinct samples at equal instants', () => {
  assert.equal(parseGpx(gpx(point() + point({ lat: '1', time: '2026-01-01T01:00:00+01:00' }))).segments[0].samples.length, 2);
  rejects(gpx(point() + point({ time: '2026-01-01T00:30:00+01:00' })), 'INVALID_ACTIVITY');
});

test('empty segments/tracks are skipped without joining non-empty segments', () => {
  const xml = `<gpx><trk/><trk><trkseg/><trkseg>${point()}</trkseg><trkseg/><trkseg>${point({ lat: '80' })}</trkseg><trkseg/></trk></gpx>`;
  assert.deepEqual(parseGpx(xml).segments.map(s => s.samples.map(p => p.position?.latitude)), [[0], [80]]);
  rejects('<gpx><trk/><trk><trkseg/></trk></gpx>', 'INVALID_ACTIVITY');
});

test('duplicate known sensor fields and nested scalar content reject', () => {
  for (const hr of ['<hr>1</hr><hr>2</hr>', '<hr><value>2</value></hr>', '<hr/>']) {
    rejects(gpx(point({ extra: `<extensions><TrackPointExtension xmlns="${GARMIN}">${hr}</TrackPointExtension></extensions>` })), 'INVALID_ACTIVITY');
  }
});

test('numeric attributes accept XML Schema whitespace and scalar text can span XML events', () => {
  const xml = gpx(point({ lat: ' 0 ', lon: '\t0\n', elevation: '1<!-- split -->0', time: '<![CDATA[2026-01-01T00:00:00Z]]>' }));
  assert.deepEqual(parseGpx(xml), parseGpx(gpx(point({ elevation: '10' }))));
});

test('XML declaration policy is UTF-8 and XML 1.0, with safe parser errors', () => {
  assert.doesNotThrow(() => parseGpx('<?xml version="1.0" encoding="UTF-8"?>' + gpx()));
  for (const declaration of ['<?xml version="1.1"?>', '<?xml version="1.0" encoding="UTF-16"?>']) {
    rejects(declaration + gpx(), 'INVALID_XML');
  }
  assert.throws(() => parseGpx(metadata('&syntheticPrivateValue;')), (e: unknown) =>
    e instanceof ActivityImportError && !e.message.includes('syntheticPrivateValue'));
});

test('resource limits abort before reaching malformed trailing XML', () => {
  rejects(`<gpx>${'<x>'.repeat(64)}<malformed`, 'RESOURCE_LIMIT');
});

test('depth limit counts ignored elements and accepts the exact boundary', () => {
  assert.doesNotThrow(() => parseGpx(metadata('<x>'.repeat(62) + '</x>'.repeat(62))));
  rejects(metadata('<x>'.repeat(63) + '</x>'.repeat(63)), 'RESOURCE_LIMIT');
});

test('element count budget bounds wide ignored metadata', () => {
  // gpx, trk, trkseg, trkpt, time, plus metadata: 6.
  assert.doesNotThrow(() => parseGpx(metadata('<x/>'.repeat(500_000 - 6))));
  rejects(metadata('<x/>'.repeat(500_000 - 5)), 'RESOURCE_LIMIT');
});

test('attribute budgets include namespace declarations and ignored attributes', () => {
  const attributes = (n: number) => Array.from({ length: n }, (_, i) => ` a${i}=""`).join('');
  assert.doesNotThrow(() => parseGpx(metadata(`<x${attributes(32)}/>`)));
  rejects(metadata(`<x${attributes(33)}/>`), 'RESOURCE_LIMIT');
  // Root has 3 attributes and point has 2; namespace declarations count.
  const content = `<x${attributes(25)}/>`.repeat(9_999);
  assert.doesNotThrow(() => parseGpx(metadata(content + `<x${attributes(20)}/>`)));
  rejects(metadata(content + `<x${attributes(21)}/>`), 'RESOURCE_LIMIT');
});

test('point budget bounds normalized samples before the XML element budget', () => {
  assert.equal(parseGpx(gpx(point().repeat(100_000))).segments[0].samples.length, 100_000);
  rejects(gpx(point().repeat(100_001)), 'RESOURCE_LIMIT');
});
