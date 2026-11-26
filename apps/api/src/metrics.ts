export function averagePaceSecondsPerKm(distanceMeters: number, elapsedSeconds: number): number | null {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(elapsedSeconds) || distanceMeters < 0 || elapsedSeconds < 0) {
    throw new RangeError('Distance and duration must be finite and non-negative');
  }
  if (distanceMeters === 0 || elapsedSeconds === 0) return null;
  return elapsedSeconds / (distanceMeters / 1000);
}
