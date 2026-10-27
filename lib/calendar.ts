import { addDays, tzOffsetMinutes } from './conditions';

/** nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

function holidays(year: number): Map<string, string> {
  const k = (m: number, d: number) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const map = new Map<string, string>([
    [k(1, 1), "New Year's Day"],
    [k(1, nthWeekday(year, 1, 1, 3)), 'MLK Day'],
    [k(2, 14), "Valentine's Day"],
    [k(2, nthWeekday(year, 2, 1, 3)), "Presidents' Day"],
    [k(3, 17), "St. Patrick's Day"],
    [k(5, nthWeekday(year, 5, 0, 2)), "Mother's Day"],
    [k(5, nthWeekday(year, 5, 1, -1)), 'Memorial Day'],
    [k(6, nthWeekday(year, 6, 0, 3)), "Father's Day"],
    [k(6, 19), 'Juneteenth'],
    [k(7, 4), 'Independence Day'],
    [k(9, nthWeekday(year, 9, 1, 1)), 'Labor Day'],
    [k(10, 31), 'Halloween'],
    [k(11, 11), 'Veterans Day'],
    [k(11, nthWeekday(year, 11, 4, 4)), 'Thanksgiving'],
    [k(12, 24), 'Christmas Eve'],
    [k(12, 25), 'Christmas'],
    [k(12, 31), "New Year's Eve"],
  ]);
  if (year % 2 === 0) {
    // First Tuesday after the first Monday in November
    map.set(k(11, nthWeekday(year, 11, 1, 1) + 1), 'Election Day');
  }
  return map;
}

/** Tags for a local date: holidays plus DST changes in `tz`. */
export function dateTags(date: string, tz: string): string[] {
  const tags: string[] = [];
  const h = holidays(Number(date.slice(0, 4))).get(date);
  if (h) tags.push(h);

  // Compare the offset at local noon today vs yesterday
  const noon = (d: string) => new Date(`${d}T18:00:00Z`);
  const today = tzOffsetMinutes(noon(date), tz);
  const prev = tzOffsetMinutes(noon(addDays(date, -1)), tz);
  if (today < prev) tags.push('Clocks fall back 1 hr');
  else if (today > prev) tags.push('Clocks spring forward 1 hr');
  return tags;
}
