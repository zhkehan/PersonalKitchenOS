import type {
  Equipment, Ingredient, IngredientCategory, KitchenState, Location, Protein, Recipe, RecipeIngredient, RecipeStep, RecipeVariant,
} from './types';

/** 种子目录共用的构造函数。seed.ts 和 library.ts 都依赖这里，彼此不依赖。 */

export type IngOpts = Partial<Pick<Ingredient,
  'countUnit' | 'highRisk' | 'defaultLocation' | 'shelfDays' | 'thawedDays' | 'freezable' | 'needsThaw' | 'quickThawMinutes' | 'maybe' | 'note' | 'catalogOnly'>>;

export function ing(id: string, name: string, aliases: string[], category: IngredientCategory, unit: Ingredient['unit'], opts: IngOpts = {}): Ingredient {
  return {
    id, name, aliases, category, unit,
    unitSpecs: {},
    highRisk: false,
    defaultLocation: 'pantry' as Location,
    shelfDays: null,
    thawedDays: null,
    freezable: false,
    needsThaw: false,
    quickThawMinutes: null,
    level: unit === 'level' ? 'unconfirmed' : null,
    markedOut: false,
    rev: 0,
    ...opts,
  };
}

export const meat = (extra: IngOpts): IngOpts => ({ highRisk: true, defaultLocation: 'freezer', freezable: true, needsThaw: true, shelfDays: 2, thawedDays: 2, ...extra });
export const sauce = (id: string, name: string, aliases: string[] = [], opts: IngOpts = {}) => ing(id, name, aliases, 'seasoning', 'level', opts);

export interface MethodDef { key: string; name: string; equipment: Equipment[]; minutes: number; fit: string; airfryerOnlyOk?: boolean; steps: string[] }
export type IngDef = [id: string, qty: number | null, role?: 'required' | 'optional', label?: string];
export interface RecipeDef {
  id: string; name: string; tier: Recipe['tier']; parentId?: string; protein: Protein; flavors: string[]; spicy?: boolean;
  /** 不写时：加餐 1 份，其余 2 份。 */
  servings?: number;
  seasoning: string; cut: string; odor?: string; leftover?: string; safety: string; ingredients: IngDef[]; methods: MethodDef[];
}

export const SAFE_CHICKEN = '鸡肉中心 74°C；空气炸锅时间仅供参考，优先用温度计。';
export const SAFE_BEEF = '牛肉碎中心 71°C，炒到无粉色。';
export const SAFE_PORK = '整块猪里脊 63°C 并静置 3 分钟；切薄片也要全熟。';
export const SAFE_FISH = '鱼中心 63°C，肉质不透明、能轻松分瓣。';
export const SAFE_SHRIMP = '虾炒至不透明、肉质紧实。';
export const LEFTOVER = '吃不完及时冷藏，3 天内吃完或冷冻；复热到 74°C。';
export const ODOR_CHICKEN = '冷冻鸡胸有腥味时，用姜片、花椒或一点醋改善风味（只改善风味，不会让变质食材变安全）。';
export const ODOR_FISH = '鱼腥味重时加姜丝、蒜和少量酸味；只改善风味，不能挽救变质食材。';
export const AF = '空气炸锅内侧约 19.5×20cm，单层摆放，放不下就分批。';

export function expandRecipes(defs: RecipeDef[]): Pick<KitchenState, 'recipes' | 'recipe_variants' | 'recipe_ingredients' | 'recipe_steps'> {
  const recipes: Recipe[] = [];
  const recipe_variants: RecipeVariant[] = [];
  const recipe_ingredients: RecipeIngredient[] = [];
  const recipe_steps: RecipeStep[] = [];
  for (const d of defs) {
    recipes.push({
      id: d.id, name: d.name, tier: d.tier, parentId: d.parentId ?? null, protein: d.protein, flavors: d.flavors,
      spicy: d.spicy ?? false, baseServings: d.servings ?? (d.tier === 'snack' ? 1 : 2), seasoningTemplate: d.seasoning, cutSize: d.cut,
      odorTip: d.odor ?? '', leftoverTip: d.leftover ?? '', safetyTip: d.safety, enabled: true, feedback: null, notes: '',
      lastCookedAt: null, rev: 0,
    });
    d.methods.forEach((m, i) => {
      const variantId = `${d.id}:${m.key}`;
      recipe_variants.push({
        id: variantId, recipeId: d.id, name: m.name, equipment: m.equipment, minutes: m.minutes, fit: m.fit,
        isDefault: i === 0, airfryerOnlyOk: m.airfryerOnlyOk ?? false,
      });
      m.steps.forEach((text, order) => recipe_steps.push({ id: `${variantId}:${order}`, variantId, order, text }));
    });
    d.ingredients.forEach(([ingredientId, qty, role, label], i) =>
      recipe_ingredients.push({ id: `${d.id}:i${i}`, recipeId: d.id, ingredientId, qty, role: role ?? 'required', label }));
  }
  return { recipes, recipe_variants, recipe_ingredients, recipe_steps };
}
