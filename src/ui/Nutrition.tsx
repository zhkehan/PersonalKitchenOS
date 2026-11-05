import { friendlyDate, localDate } from '../domain/dates';
import { cookingOil, recentIntake, type DayIntake } from '../domain/intake';
import { macroLine, type Macros } from '../domain/nutrition';
import { SLOT_LABEL } from '../domain/planner';
import { Screen, Stepper } from './components';
import { useKitchen } from './store';

const hasRecord = (d: DayIntake) => d.entries.length > 0 || d.uncounted.length > 0;

/** 只看记录，不设目标，也不要求录入。入口放在今天页底部，不把数字放到首屏。 */
export function Nutrition({ onClose }: { onClose: () => void }) {
  const { state, now, run } = useKitchen();
  const today = localDate(now());
  const oil = cookingOil(state);
  const [day, ...past] = recentIntake(state, today, 7);
  const earlier = past.filter(hasRecord);

  return (
    <Screen title="营养记录" onBack={onClose}>
      <section aria-label="今天">
        <h3>今天</h3>
        {day.entries.length > 0 ? (
          <>
            <MacroGrid m={day.macros} />
            <ul className="ref-list">
              {day.entries.map((e, i) => (
                <li key={`${e.slot}${e.label}${i}`}>
                  <strong>{SLOT_LABEL[e.slot]}：{e.label}{e.portions !== 1 ? ` × ${e.portions}` : ''}</strong>
                  <span className="meta">{e.macros ? macroLine(e.macros) : '算不出来'}</span>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="meta">今天还没有吃过的记录。</p>}
        <Uncounted items={day.uncounted} />
      </section>

      {earlier.length > 0 && (
        <section aria-label="最近几天">
          <h3>最近几天</h3>
          <ul className="ref-list">
            {earlier.map((d) => (
              <li key={d.date}>
                <strong>{friendlyDate(d.date, today)}</strong>
                <span className="meta">{d.entries.length > 0 ? macroLine(d.macros) : '没有可算的记录'}</span>
                <Uncounted items={d.uncounted} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="用油">
        <Stepper label="每份默认用油（g）" value={oil} min={0} max={30} step={5} onChange={(grams) => void run('setCookingOil', { grams }, { silent: true })} />
        <p className="hint">10g 油约 89 kcal、10g 脂肪。加餐类的菜不算油。改了之后，已有记录的估算也会跟着变。</p>
      </section>

      <p className="hint">根据做饭时记下的用量和吃掉的份数估算，全部是大概值。按生重算，不含调味料和腌料。没在 App 里记过的不算。</p>
    </Screen>
  );
}

function MacroGrid({ m }: { m: Macros }) {
  const cells: [string, string][] = [
    ['蛋白质', `${Math.round(m.protein)}g`],
    ['碳水', `${Math.round(m.carbs)}g`],
    ['脂肪', `${Math.round(m.fat)}g`],
    ['热量', `${Math.round(m.kcal)}`],
  ];
  return (
    <dl className="macro-grid">
      {cells.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function Uncounted({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <p className="hint">没算进去：{items.join('、')}</p>;
}
