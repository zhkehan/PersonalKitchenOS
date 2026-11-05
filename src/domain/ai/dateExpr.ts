import { addDays, isValidDate, localDate, weekday, type LocalDate } from '../dates';

const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export interface DateMatch {
  date: LocalDate;
  phrase: string;
}

const WEEK_RE = /(下下|下个?|这个?|本|上个?)?(?:周|星期|礼拜)([一二三四五六日天1-7])/;

/**
 * 确定性解析中文日期说法。「今天」按设备本地 America/Los_Angeles 算，
 * 所以 23:30 PST 的「明天」不会被 UTC 带到后天。周从周一开始，「下周三」是下一个日历周的周三。
 */
export function resolveDatePhrase(text: string, now: Date): DateMatch | null {
  const today = localDate(now);
  const fixed: [RegExp, number][] = [
    [/大后天/, 3], [/后天/, 2], [/明[天晚早日]|明儿/, 1], [/今[天晚早日]|今儿/, 0], [/前天/, -2], [/昨[天晚日]/, -1],
  ];
  for (const [re, n] of fixed) {
    const m = text.match(re);
    if (m) return { date: addDays(today, n), phrase: m[0] };
  }

  const week = text.match(WEEK_RE);
  if (week) {
    const target = WEEKDAY[week[2]];
    const thisMonday = addDays(today, 1 - weekday(today));
    const prefix = week[1] ?? '';
    if (prefix === '') {
      // 单说「周四」：今天或之后最近的一个周四。
      const delta = (target - weekday(today) + 7) % 7;
      return { date: addDays(today, delta), phrase: week[0] };
    }
    const offset = prefix.startsWith('下下') ? 14 : prefix.startsWith('下') ? 7 : prefix.startsWith('上') ? -7 : 0;
    return { date: addDays(thisMonday, offset + target - 1), phrase: week[0] };
  }

  const inDays = text.match(/(\d+|[一二两三四五六七八九十])\s*天(?:后|之后)/);
  if (inDays) {
    const n = /\d/.test(inDays[1]) ? Number(inDays[1]) : CN_NUM[inDays[1]];
    return { date: addDays(today, n), phrase: inDays[0] };
  }

  const md = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (md) {
    const y = Number(today.slice(0, 4));
    const fmt = (yr: number) => `${yr}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
    const candidate = fmt(y);
    if (isValidDate(candidate)) return { date: candidate < addDays(today, -60) ? fmt(y + 1) : candidate, phrase: md[0] };
  }
  return null;
}
