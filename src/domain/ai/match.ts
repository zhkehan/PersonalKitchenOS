import type { Id, Ingredient, KitchenState, Recipe } from '../types';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** 按菜名找菜：完全匹配 > 包含 > 字序匹配（孜然鸡 → 孜然洋葱鸡丁）。找不到返回 null，绝不新造菜。 */
export function findRecipe(state: KitchenState, name: string | null | undefined): Recipe | null {
  if (!name) return null;
  const q = norm(name);
  if (q.length < 2) return null;
  const pool = state.recipes.filter((r) => r.enabled);
  const rank = (r: Recipe) => ({ core: 0, variant: 1, backup: 2, snack: 3, library: 4 }[r.tier]);
  const pick = (list: Recipe[]) => [...list].sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)[0] ?? null;
  return (
    pool.find((r) => norm(r.name) === q) ??
    pick(pool.filter((r) => norm(r.name).includes(q) || q.includes(norm(r.name)))) ??
    pick(pool.filter((r) => isSubsequence(q, norm(r.name))))
  );
}

/** 用户一句话里提到的菜（用于规则解析）。 */
export function recipeInText(state: KitchenState, text: string): Recipe | null {
  const t = norm(text);
  const direct = [...state.recipes].filter((r) => r.enabled).sort((a, b) => b.name.length - a.name.length).find((r) => t.includes(norm(r.name)));
  if (direct) return direct;
  const m = t.match(/(?:吃|做|换成|改成|想吃)([一-龥a-z]{2,8}?)(?:吧|了|呢|$|，|。)/);
  return m ? findRecipe(state, m[1]) : null;
}

function names(ing: Ingredient): string[] {
  return [ing.name, ...ing.aliases].map(norm);
}

export function findIngredient(state: KitchenState, name: string | null | undefined): Ingredient | null {
  if (!name) return null;
  const q = norm(name);
  return state.ingredients.find((i) => names(i).includes(q)) ??
    state.ingredients.find((i) => names(i).some((n) => n.length >= 2 && (q.includes(n) || n.includes(q)))) ?? null;
}

/** 句子里出现的食材：长名字优先，避免「洋葱」被当成「葱」。 */
export function ingredientInText(state: KitchenState, text: string): Ingredient | null {
  const t = norm(text);
  let best: { ing: Ingredient; len: number } | null = null;
  for (const ing of state.ingredients) {
    for (const n of names(ing)) {
      if (t.includes(n) && (!best || n.length > best.len)) best = { ing, len: n.length };
    }
  }
  return best?.ing ?? null;
}

/** 模型说的食材必须真的出现在用户原话里。 */
export function ingredientMentioned(state: KitchenState, id: Id, text: string): boolean {
  const ing = state.ingredients.find((i) => i.id === id);
  if (!ing) return false;
  const t = norm(text);
  return names(ing).some((n) => t.includes(n));
}

export function quoteInText(quote: string | null | undefined, text: string): boolean {
  return !!quote && norm(text).includes(norm(quote));
}
