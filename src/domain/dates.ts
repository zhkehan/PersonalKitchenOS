/** 所有日期都是 America/Los_Angeles 的本地日历日（YYYY-MM-DD），不是 UTC 时间戳截断。 */
export const TZ = 'America/Los_Angeles';
export type LocalDate = string;

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23', minute: 'numeric' });

export function localDate(d: Date): LocalDate {
  return dateFmt.format(d);
}

/** 本地时间的小时（含分钟小数），已处理夏令时。 */
export function localHour(d: Date): number {
  const parts = hourFmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

function toUtc(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日历日加减：用 UTC 午夜算术，避开本地夏令时的 23/25 小时日。 */
export function addDays(date: LocalDate, n: number): LocalDate {
  return fromUtc(toUtc(date) + n * 86_400_000);
}

export function diffDays(later: LocalDate, earlier: LocalDate): number {
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/** 周一=1 … 周日=7 */
export function weekday(date: LocalDate): number {
  const w = new Date(toUtc(date)).getUTCDay();
  return w === 0 ? 7 : w;
}

const WEEK = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const weekdayName = (date: LocalDate) => WEEK[weekday(date)];

export function shortDate(date: LocalDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export function friendlyDate(date: LocalDate, today: LocalDate): string {
  const diff = diffDays(date, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  return `${weekdayName(date)} ${shortDate(date)}`;
}

export const isValidDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
