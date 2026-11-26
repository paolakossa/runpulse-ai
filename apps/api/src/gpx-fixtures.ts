// Synthetic coordinates, timestamps and sensors only; never real activity files.
export function point(options: { lat?: string; lon?: string; time?: string; elevation?: string; extra?: string } = {}): string {
  const { lat = '0', lon = '0', time = '2026-01-01T00:00:00Z', elevation, extra = '' } = options;
  const ele = elevation === undefined ? '' : `<ele>${elevation}</ele>`;
  return `<trkpt lat="${lat}" lon="${lon}">${ele}<time>${time}</time>${extra}</trkpt>`;
}

export function gpx(points = point()): string {
  return `<gpx version="1.1" creator="synthetic-tests" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points}</trkseg></trk></gpx>`;
}
