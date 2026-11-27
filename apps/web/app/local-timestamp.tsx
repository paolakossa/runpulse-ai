'use client';

import { useEffect, useState } from 'react';
import { formatLocalTimestamp } from './activity-import-utils.ts';

export default function LocalTimestamp({ value }: { value: string | null }) {
  const [localTime, setLocalTime] = useState<string | null>(null);

  useEffect(() => {
    setLocalTime(formatLocalTimestamp(value));
  }, [value]);

  if (value === null || !Number.isFinite(Date.parse(value))) return <span>N/A</span>;

  return (
    <time dateTime={value}>
      {localTime ?? `${new Date(value).toISOString()} (UTC)`}
    </time>
  );
}
