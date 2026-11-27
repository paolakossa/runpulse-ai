export const ACTIVITIES_CHANGED_EVENT = 'runpulse:activities-changed';

export function notifyActivitiesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACTIVITIES_CHANGED_EVENT));
  }
}
