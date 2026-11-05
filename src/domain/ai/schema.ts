import { z } from 'zod';

/** 白名单动作。模型输出只能落在这里，不能是 SQL、代码或任意命令。 */
export const INTENTS = [
  'skip_meal', 'eat_out', 'change_meal_count', 'move_meal', 'swap_recipe', 'set_available_minutes', 'set_equipment',
  'request_extra_meal', 'change_hunger_level', 'consume_prepared_portions', 'record_snack',
  'start_cooking', 'finish_cooking_proposal', 'correct_cook_quantities', 'discard_food_proposal',
  'add_purchase_proposal', 'correct_inventory_proposal', 'ask_what_to_cook', 'ask_what_to_buy',
] as const;
export type Intent = (typeof INTENTS)[number];

const nullish = <T extends z.ZodType>(t: T) => t.nullable().optional();

export const RequestedChange = z.object({
  status: nullish(z.enum(['eating_out', 'skipped'])),
  scope: nullish(z.enum(['meal', 'all_day'])),
  recipe_name: nullish(z.string().max(40)),
  days: nullish(z.number().int().min(1).max(7)),
  meal_count: nullish(z.number().int().min(0).max(2)),
  keep_slot: nullish(z.enum(['lunch', 'dinner'])),
  portions: nullish(z.number().positive().max(20)),
  /** 这一餐一共吃了几份（用于修正已有记录）。 */
  total_portions: nullish(z.number().positive().max(20)),
  servings: nullish(z.number().positive().max(20)),
  minutes: nullish(z.number().int().positive().max(240)),
  equipment: nullish(z.enum(['airfryer', 'pan', 'pot'])),
  spicy: nullish(z.boolean()),
  exclude_recipe: nullish(z.string().max(40)),
  hunger: nullish(z.enum(['low', 'normal', 'high'])),
  ingredient: nullish(z.string().max(40)),
  quantity: nullish(z.number().min(0).max(100000)),
  delta: nullish(z.number().min(-100000).max(100000)),
  unit: nullish(z.string().max(10)),
  location: nullish(z.enum(['fridge', 'freezer', 'pantry'])),
  level: nullish(z.enum(['have', 'low', 'out'])),
  to_date_phrase: nullish(z.string().max(20)),
  /** 用户说某食材还冻着。 */
  frozen_ingredient: nullish(z.string().max(40)),
  /** 用户原话中支持这个事实的片段。涉及库存事实时必填，由程序核对。 */
  evidence_quote: nullish(z.string().max(120)),
}).strict();
export type RequestedChange = z.infer<typeof RequestedChange>;

export const ActionProposal = z.object({
  intent: z.enum(INTENTS),
  date: nullish(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  /** 用户原话里的日期说法，程序用它自己算日期，不信任模型算的结果。 */
  date_phrase: nullish(z.string().max(20)),
  meal_slot: nullish(z.enum(['lunch', 'dinner', 'snack'])),
  requested_change: RequestedChange.default({}),
  ambiguities: z.array(z.string().max(120)).max(3).default([]),
  needs_confirmation: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.8),
}).strict();
export type ActionProposal = z.infer<typeof ActionProposal>;

const str = { type: ['string', 'null'] };
const num = { type: ['number', 'null'] };
const enumOf = (...v: string[]) => ({ type: ['string', 'null'], enum: [...v, null] });

const CHANGE_PROPERTIES: Record<string, unknown> = {
  status: enumOf('eating_out', 'skipped'),
  scope: enumOf('meal', 'all_day'),
  recipe_name: str, days: num, meal_count: num, keep_slot: enumOf('lunch', 'dinner'),
  portions: num, total_portions: num, servings: num, minutes: num,
  equipment: enumOf('airfryer', 'pan', 'pot'),
  spicy: { type: ['boolean', 'null'] }, exclude_recipe: str,
  hunger: enumOf('low', 'normal', 'high'),
  ingredient: str, quantity: num, delta: num, unit: str,
  location: enumOf('fridge', 'freezer', 'pantry'),
  level: enumOf('have', 'low', 'out'),
  to_date_phrase: str, frozen_ingredient: str, evidence_quote: str,
};

/** 发给模型的 JSON Schema：所有字段必填可为 null，便于本地和云端模型严格约束输出。 */
export const PROPOSAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'date', 'date_phrase', 'meal_slot', 'requested_change', 'ambiguities', 'needs_confirmation', 'confidence'],
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    date: str,
    date_phrase: str,
    meal_slot: enumOf('lunch', 'dinner', 'snack'),
    requested_change: {
      type: 'object', additionalProperties: false,
      required: Object.keys(CHANGE_PROPERTIES),
      properties: CHANGE_PROPERTIES,
    },
    ambiguities: { type: 'array', items: { type: 'string' } },
    needs_confirmation: { type: 'boolean' },
    confidence: { type: 'number' },
  },
};

export function parseProposal(raw: unknown): { ok: true; proposal: ActionProposal } | { ok: false; errors: string[] } {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { ok: false, errors: ['不是合法 JSON'] }; }
  }
  const r = ActionProposal.safeParse(value);
  if (r.success) return { ok: true, proposal: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}
