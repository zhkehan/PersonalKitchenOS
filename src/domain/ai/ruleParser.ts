import type { KitchenState } from '../types';
import { resolveDatePhrase } from './dateExpr';
import { ingredientInText, recipeInText } from './match';
import type { RequestedChange } from './schema';

/**
 * 离线规则解析器 —— 不是 AI。它只覆盖常见说法，电脑关机、模型不可用时兜底，
 * 输出和模型完全相同的草稿格式，再走相同的校验。界面上明确标注「规则识别」。
 */

const CN: Record<string, number> = { 半: 0.5, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const toNum = (s: string) => (/\d/.test(s) ? Number(s) : CN[s]);
const NUM = '(\\d+(?:\\.\\d+)?|[半一两二三四五六七八九十])';

function slotIn(text: string): 'lunch' | 'dinner' | null {
  const lunch = /中午|午饭|午餐/.test(text);
  const dinner = /晚上|晚饭|晚餐|今晚|明晚/.test(text);
  if (lunch && !dinner) return 'lunch';
  if (dinner && !lunch) return 'dinner';
  return null;
}

/** 一句话里午晚都出现时，以动作所在的分句为准：「中午出去吃了，晚上只做一顿」说的是午餐。 */
function clauseSlot(text: string, action: RegExp): 'lunch' | 'dinner' | null {
  const clause = text.split(/[，,。；;！!]/).find((c) => action.test(c));
  return clause ? slotIn(clause) : null;
}

function draft(intent: string, text: string, now: Date, change: RequestedChange = {}, extra: Record<string, unknown> = {}) {
  const d = resolveDatePhrase(text, now);
  return {
    intent, date: d?.date ?? null, date_phrase: d?.phrase ?? null, meal_slot: slotIn(text),
    requested_change: change, ambiguities: [] as string[], needs_confirmation: true, confidence: 0.9, ...extra,
  };
}

function quantityOf(text: string): { quantity: number; unit: string } | null {
  const m = text.match(new RegExp(`${NUM}\\s*(kg|g|克|千克|公斤|oz|lb|lbs|磅|盎司|ml|毫升|升|颗|个|根|把|袋|罐|盒|瓶|包)`, 'i'));
  return m ? { quantity: toNum(m[1]), unit: m[2] } : null;
}

export function ruleParse(input: string, state: KitchenState, now: Date): unknown | null {
  const text = input.trim();
  if (!text) return null;
  const ing = ingredientInText(state, text);

  if (/买什么|要买|采购清单|该买|缺什么/.test(text) && !/买了/.test(text)) return draft('ask_what_to_buy', text, now);

  if (/买了|入库|买到了/.test(text)) {
    const q = quantityOf(text);
    return draft('add_purchase_proposal', text, now, { ingredient: ing?.name ?? null, quantity: q?.quantity ?? null, unit: q?.unit ?? null, evidence_quote: text });
  }

  if (/坏了|变质|发霉|扔了|丢了|倒掉|不能吃了/.test(text)) {
    return draft('discard_food_proposal', text, now, { ingredient: ing?.name ?? null, recipe_name: recipeInText(state, text)?.name ?? null, evidence_quote: text });
  }

  const corrected = text.match(new RegExp(`(?:只用了|用了|少用了)\\s*${NUM}?\\s*(g|克|颗|个|根|把|ml)?`));
  if (/多用了/.test(text) && ing) {
    const q = quantityOf(text);
    return draft('correct_cook_quantities', text, now, { ingredient: ing.name, delta: q?.quantity ?? null, unit: q?.unit ?? null, evidence_quote: text });
  }
  if (/少用了/.test(text) && ing) {
    const q = quantityOf(text);
    return draft('correct_cook_quantities', text, now, { ingredient: ing.name, delta: q ? -q.quantity : null, unit: q?.unit ?? null, evidence_quote: text });
  }
  if (/没用|没放/.test(text) && ing) {
    return draft('correct_cook_quantities', text, now, { ingredient: ing.name, quantity: 0, evidence_quote: text });
  }
  if (corrected && ing && (corrected[1] || /只用了/.test(text))) {
    const q = quantityOf(text);
    return draft('correct_cook_quantities', text, now, { ingredient: ing.name, quantity: q?.quantity ?? null, unit: q?.unit ?? null, evidence_quote: text });
  }

  if (/剩菜/.test(text) && /吃/.test(text) && !/想/.test(text)) return draft('consume_prepared_portions', text, now, { portions: 1 });
  const many = text.match(new RegExp(`${NUM}\\s*份`));
  if (many && /吃了|吃掉|吃完|吃光/.test(text)) {
    return draft('consume_prepared_portions', text, now, { total_portions: toNum(many[1]) }, { meal_slot: clauseSlot(text, /吃了|吃掉|吃完|吃光/) });
  }

  if (/这顿.*没吃|这餐.*没吃|这顿不吃/.test(text)) {
    return draft('skip_meal', text, now, {}, { meal_slot: null, ambiguities: ['是午餐还是晚餐？'] });
  }
  if (/没吃|不吃了|不吃/.test(text) && slotIn(text)) return draft('skip_meal', text, now);

  if (/外食|出去吃|外面吃|不在家吃|在外吃|聚餐|下馆子|点外卖|不在家/.test(text)) {
    const allDay = /整天|一整天|全天|一天都/.test(text);
    const OUT = /外食|出去吃|外面吃|不在家吃|在外吃|聚餐|下馆子|点外卖|不在家/;
    const d = draft('eat_out', text, now, { status: 'eating_out', scope: allDay ? 'all_day' : 'meal' }, { meal_slot: clauseSlot(text, OUT) ?? slotIn(text) });
    if (!allDay && !d.meal_slot) d.ambiguities = ['是午餐、晚餐还是一整天？'];
    return d;
  }

  if (/饿|加餐|再吃点|想多吃/.test(text)) return draft('request_extra_meal', text, now, { hunger: 'high' });

  const recipe = recipeInText(state, text);
  const streak = text.match(new RegExp(`(?:连续|连着)\\s*${NUM}\\s*天`));
  if (streak && recipe) return draft('swap_recipe', text, now, { recipe_name: recipe.name, days: toNum(streak[1]) });

  const only = /空气炸锅/.test(text);
  const spicy = /想吃辣|吃辣|辣的/.test(text);
  const excludeMatch = text.match(/不想吃([一-龥]{1,8}?)(?:[，,。]|$)/);
  if (only || spicy || excludeMatch) {
    return draft('set_equipment', text, now, { equipment: only ? 'airfryer' : null, spicy: spicy || null, exclude_recipe: excludeMatch?.[1] ?? null });
  }

  const minutes = text.match(/(\d+)\s*分钟/);
  if (minutes) {
    const frozen = /冻着|没解冻|还没化/.test(text) ? ing?.name ?? null : null;
    return draft('set_available_minutes', text, now, { minutes: Number(minutes[1]), frozen_ingredient: frozen });
  }

  const count = text.match(new RegExp(`(?:只吃|只做|吃|做)\\s*${NUM}\\s*顿`));
  if (count) return draft('change_meal_count', text, now, { meal_count: toNum(count[1]), keep_slot: slotIn(text) });

  if (/挪到|换到|改到|调到/.test(text)) {
    const [before, after] = text.split(/挪到|换到|改到|调到/);
    return draft('move_meal', before, now, { to_date_phrase: after ?? null });
  }

  if (/开始做|现在做/.test(text)) return draft('start_cooking', text, now, { recipe_name: recipe?.name ?? null });
  if (/做完了|做好了/.test(text)) return draft('finish_cooking_proposal', text, now, { recipe_name: recipe?.name ?? null });

  if (/吃了|吃掉/.test(text) && ing) {
    const q = quantityOf(text);
    return draft('record_snack', text, now, { ingredient: ing.name, quantity: q?.quantity ?? null, unit: q?.unit ?? null, evidence_quote: text });
  }

  if (recipe && /换成|改成|想吃|吃/.test(text)) return draft('swap_recipe', text, now, { recipe_name: recipe.name });
  if (/吃什么|做什么|推荐|吃啥|做啥/.test(text)) return draft('ask_what_to_cook', text, now);
  return null;
}
