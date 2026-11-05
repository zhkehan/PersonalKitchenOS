import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { COMMANDS, type CommandName } from '../domain/commands';
import { preview } from '../domain/engine';
import { DomainError } from '../domain/tx';
import { reportFacts, reportIntake, reportLog, reportPlan, reportRecipe, reportRecipes, reportShopping, reportStock, reportToday } from './report';
import { applyCommand, initState, makeCtx, openState } from './store';

const HELP = `用法：npm run -s kitchen -- <动作>

查询（只读）：
  today                今天吃什么、能做的菜、提醒、今天吃的
  stock [词]           库存
  recipes [词]         菜谱和主料是否齐
  recipe <菜名>        用量、步骤、一份的营养
  plan [天数]          计划，默认 7 天
  shop                 该买什么
  intake [天数]        最近吃了什么和营养，默认 7 天
  facts [词]           食材营养资料
  log [条数]           最近的操作，含操作 id

修改（都走领域命令，可撤销）：
  preview <命令> <JSON>         算结果但不写入
  run <命令> <JSON> [--key 键]  执行。同一个键只执行一次
  undo <操作 id>                撤销
  commands                      列出所有命令
  init [清单.json]              第一次建数据文件，已有时拒绝`;

function result(r: { summary: string; details: string[]; warnings: string[]; operationId: string; undoable: boolean; deduped?: boolean }): string {
  return [
    r.deduped ? `已经执行过：${r.summary}` : r.summary,
    ...r.details.map((d) => `  ${d}`),
    ...r.warnings.map((w) => `  注意：${w}`),
    r.undoable && !r.deduped ? `操作 id：${r.operationId}` : '',
  ].filter(Boolean).join('\n');
}

function commandName(name: string | undefined): CommandName {
  if (!name || !(name in COMMANDS)) throw new Error(`未知命令：${name ?? ''}。用 commands 查看。`);
  return name as CommandName;
}

export function main(argv: string[], now: Date): string {
  const [action, a, b, ...rest] = argv;
  switch (action) {
    case 'today': return reportToday(openState(now), now);
    case 'stock': return reportStock(openState(now), a, now);
    case 'recipes': return reportRecipes(openState(now), a, now);
    case 'recipe': return reportRecipe(openState(now), a ?? '', now);
    case 'plan': return reportPlan(openState(now), Number(a ?? 7), now);
    case 'shop': return reportShopping(openState(now), now);
    case 'intake': return reportIntake(openState(now), Number(a ?? 7), now);
    case 'facts': return reportFacts(a);
    case 'log': return reportLog(openState(now), Number(a ?? 15));
    case 'commands': return Object.keys(COMMANDS).join('\n');
    case 'preview': return `预览，没有写入：\n${result(preview(openState(now), makeCtx(now), commandName(a), JSON.parse(b ?? '{}')))}`;
    case 'run': {
      const keyAt = rest.indexOf('--key');
      return result(applyCommand(openState(now), now, commandName(a), JSON.parse(b ?? '{}'), keyAt >= 0 ? rest[keyAt + 1] : undefined).result);
    }
    case 'undo': return result(applyCommand(openState(now), now, 'undoTransaction', { operationId: a }).result);
    case 'init': {
      const state = initState(now);
      if (!a) return '已建好空的数据文件';
      const list = JSON.parse(readFileSync(a, 'utf8')) as { stock?: [string, number, string?][]; have?: string[] };
      const entries = (list.stock ?? []).map(([ingredientId, qty, unit]) => ({ ingredientId, qty, ...(unit ? { unit } : {}) }));
      return result(applyCommand(state, now, 'importStock', { entries, have: list.have ?? [] }).result);
    }
    default: return HELP;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(main(process.argv.slice(2), new Date()));
  } catch (e) {
    console.error(e instanceof DomainError || e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
