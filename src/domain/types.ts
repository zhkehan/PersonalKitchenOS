import type { LocalDate } from './dates';

export type Id = string;
export type IsoTime = string;
export type SlotKind = 'lunch' | 'dinner' | 'snack';
export type Location = 'fridge' | 'freezer' | 'pantry';
export type Protein = 'chicken' | 'beef' | 'pork' | 'fish' | 'shrimp' | 'egg' | 'none';
export type Equipment = 'pan' | 'airfryer' | 'pot' | 'steamer';
export type Level = 'have' | 'low' | 'out' | 'unconfirmed';
/** 数量真实性：区分「提到过」「确认有但不知多少」「确认数量」「没有」。 */
export type Reality = 'mentioned' | 'confirmed_present_unknown_qty' | 'confirmed_qty' | 'out';
export type IngredientCategory = 'protein' | 'fresh' | 'frozen_veg' | 'pantry' | 'staple' | 'seasoning';

export interface Ingredient {
  id: Id;
  name: string;
  aliases: string[];
  category: IngredientCategory;
  /** 规范单位。level = 调味品四态，不做克数账。 */
  unit: 'g' | 'ml' | 'count' | 'level';
  countUnit?: string;
  /** 用户定义的单位规格，例如 { 颗: 220 }。绝不预置猜测值。 */
  unitSpecs: Record<string, number>;
  highRisk: boolean;
  defaultLocation: Location;
  /** 保守建议的冷藏/常温使用天数。null 表示不生成日期提示。 */
  shelfDays: number | null;
  /** 解冻后冷藏的保守使用天数。 */
  thawedDays: number | null;
  freezable: boolean;
  /** 需要解冻才能下锅。 */
  needsThaw: boolean;
  /** 可用冷水短时解冻（如小虾仁），单位分钟。 */
  quickThawMinutes: number | null;
  level: Level | null;
  /** 用户明确说「没有」。 */
  markedOut: boolean;
  /** 只提到过、可能有（例如黑椒酱）。 */
  maybe?: boolean;
  note?: string;
  rev: number;
}

export interface Product {
  id: Id;
  ingredientId: Id;
  name: string;
  retailer: string | null;
  packQty: number | null;
  packUnit: string | null;
  price: number | null;
  note?: string;
  rev: number;
}

export interface InventoryLot {
  id: Id;
  ingredientId: Id;
  productId: Id | null;
  /** null = 数量未知，不是 0，也不是无穷。 */
  qty: number | null;
  unit: string;
  /** 数量未知时保留用户原话的数量，例如「2颗」。 */
  rawLabel: string | null;
  location: Location;
  purchasedAt: LocalDate | null;
  openedAt: LocalDate | null;
  frozenAt: LocalDate | null;
  thawedAt: LocalDate | null;
  /** 建议使用日期（不等于变质判断）。 */
  useBy: LocalDate | null;
  useBySource: 'package' | 'rule' | 'user' | null;
  confidence: 'confirmed' | 'estimated' | 'unknown';
  status: 'active' | 'depleted' | 'discarded' | 'reverted';
  rev: number;
}

export type InventoryEventType = 'purchase' | 'consume_raw' | 'consume_prepared' | 'discard' | 'transfer' | 'adjust' | 'reversal';

export interface InventoryEvent {
  id: Id;
  txId: Id;
  lotId: Id;
  ingredientId: Id;
  type: InventoryEventType;
  /** 带符号变化量；null = 数量未知的批次上发生的事实。 */
  qtyDelta: number | null;
  unit: string;
  at: IsoTime;
  note?: string;
  reverses?: Id;
}

export interface Recipe {
  id: Id;
  name: string;
  tier: 'core' | 'variant' | 'backup' | 'snack';
  /** 变体对应的固定主菜。 */
  parentId: Id | null;
  protein: Protein;
  flavors: string[];
  spicy: boolean;
  baseServings: number;
  seasoningTemplate: string;
  cutSize: string;
  odorTip: string;
  leftoverTip: string;
  safetyTip: string;
  enabled: boolean;
  /** 用户轻反馈：good 好吃 / meh 一般 / avoid 下次别推荐。 */
  feedback: 'good' | 'meh' | 'avoid' | null;
  notes: string;
  lastCookedAt: LocalDate | null;
  rev: number;
}

export interface RecipeVariant {
  id: Id;
  recipeId: Id;
  name: string;
  equipment: Equipment[];
  minutes: number;
  /** 例如「不建议纯炸」。 */
  fit: string;
  isDefault: boolean;
  /** 纯空气炸锅是否合适（用于「只用空气炸锅」过滤）。 */
  airfryerOnlyOk: boolean;
}

export interface RecipeIngredient {
  id: Id;
  recipeId: Id;
  ingredientId: Id;
  /** baseServings 对应的用量，单位为食材规范单位。调味品为 null。 */
  qty: number | null;
  role: 'required' | 'optional';
  /** 面向用户的用量文字，例如「少许」「2g」。 */
  label?: string;
}

export interface RecipeStep {
  id: Id;
  variantId: Id;
  order: number;
  text: string;
}

export type SlotStatus = 'planned' | 'preparing' | 'eaten' | 'eating_out' | 'skipped';
export type SlotRole = 'cook' | 'reuse' | 'leftover' | 'none';

export interface MealSlot {
  id: Id;
  date: LocalDate;
  slot: SlotKind;
  status: SlotStatus;
  /** cook 这餐开火；reuse 吃同日这锅；leftover 吃已存在的熟菜批次。 */
  role: SlotRole;
  /** 计划的菜。被熟菜覆盖时仍保留，这样熟菜释放后能恢复原计划。 */
  recipeId: Id | null;
  variantId: Id | null;
  /** 这餐开火时做几份。 */
  cookServings: number;
  /** 这餐计划吃几份。 */
  portions: number;
  batchId: Id | null;
  locked: boolean;
  source: 'auto' | 'user';
  note?: string;
  rev: number;
}

export interface MealPlanVersion {
  id: Id;
  txId: Id;
  at: IsoTime;
  reason: string;
}

export interface PlanChange {
  id: Id;
  versionId: Id;
  slotId: Id;
  summary: string;
  before: Partial<MealSlot> | null;
  after: Partial<MealSlot> | null;
}

export interface CookSession {
  id: Id;
  recipeId: Id;
  variantId: Id;
  slotId: Id | null;
  status: 'started' | 'cancelled' | 'finished' | 'reverted';
  startedAt: IsoTime;
  finishedAt: IsoTime | null;
  plannedServings: number;
  actualServings: number | null;
  rev: number;
}

export interface CookSessionIngredient {
  id: Id;
  sessionId: Id;
  ingredientId: Id;
  plannedQty: number;
  actualQty: number;
  unit: string;
  /** 实际扣减到的批次。 */
  allocations: { lotId: Id; qty: number }[];
  /** 用到了数量未知的批次（只记事实，不扣数）。 */
  usedUnknownLot: boolean;
  /** 库存记录不足的差额，提示核对，绝不变成负库存。 */
  shortfall: number;
  estimated: boolean;
  rev: number;
}

export interface PreparedBatch {
  id: Id;
  recipeId: Id;
  variantId: Id | null;
  cookSessionId: Id;
  name: string;
  portionsTotal: number;
  portionsRemaining: number;
  location: 'fridge' | 'freezer';
  cookedAt: LocalDate;
  useBy: LocalDate;
  status: 'active' | 'finished' | 'discarded' | 'reverted';
  rev: number;
}

export interface PreparedPortionEvent {
  id: Id;
  txId: Id;
  batchId: Id;
  type: 'create' | 'consume' | 'discard' | 'freeze' | 'thaw' | 'reversal';
  portionsDelta: number;
  at: IsoTime;
  reverses?: Id;
}

export interface ConsumptionEvent {
  id: Id;
  txId: Id;
  at: IsoTime;
  date: LocalDate;
  slot: SlotKind;
  kind: 'prepared' | 'ready_to_eat' | 'reversal';
  batchId: Id | null;
  ingredientId: Id | null;
  recipeId: Id | null;
  portions: number;
  label: string;
  reverses?: Id;
}

export interface ShoppingList {
  id: Id;
  status: 'draft' | 'confirmed';
  createdAt: IsoTime;
  confirmedAt: IsoTime | null;
  shopDate: LocalDate;
  rev: number;
}

export type ShoppingTag = 'must' | 'optional' | 'enough' | 'short_life';

export interface ShoppingItem {
  id: Id;
  listId: Id;
  ingredientId: Id;
  productId: Id | null;
  name: string;
  tag: ShoppingTag;
  /** 建议购买量（规范单位）。 */
  suggestedQty: number | null;
  unit: string;
  packLabel: string;
  reason: string;
  rev: number;
}

export interface PurchaseConfirmation {
  id: Id;
  listId: Id | null;
  txId: Id;
  at: IsoTime;
  lotIds: Id[];
  notBought: { ingredientId: Id; name: string }[];
}

export interface ScheduleConstraint {
  id: Id;
  date: LocalDate;
  dayStatus: 'normal' | 'busy' | 'away' | null;
  minutes: number | null;
  airfryerOnly: boolean;
  spicy: boolean;
  hunger: 'low' | 'normal' | 'high' | null;
  excludeRecipeIds: Id[];
  rev: number;
}

export interface Preference {
  id: string;
  value: unknown;
  rev: number;
}

export interface ProteinWeeklyPreference {
  id: Protein;
  daysPerWeek: number;
  label: string;
  rev: number;
}

export interface IngredientSubstitution {
  id: Id;
  ingredientId: Id;
  substituteId: Id;
  note: string;
}

export interface AiActionProposal {
  id: Id;
  at: IsoTime;
  /** 用户原话，可在设置里清除。 */
  sourceText: string | null;
  provider: string;
  raw: unknown;
  validation: 'ok' | 'rejected' | 'clarify' | 'read_only';
  errors: string[];
  command: string | null;
  input: unknown;
  summary: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  operationId: Id | null;
  rev: number;
}

export interface Mutation {
  table: TableName;
  id: Id;
  before: Row | null;
  after: Row | null;
}

export interface AuditEvent {
  id: Id;
  name: string;
  at: IsoTime;
  idempotencyKey: string;
  summary: string;
  details: string[];
  mutations: Mutation[];
  appended: { table: TableName; id: Id }[];
  undoable: boolean;
  undoneBy: Id | null;
  undoOf: Id | null;
  rev: number;
}

export interface BackupMetadata {
  id: Id;
  at: IsoTime;
  schemaVersion: number;
  kind: 'export' | 'restore';
}

export interface KitchenState {
  ingredients: Ingredient[];
  products: Product[];
  inventory_lots: InventoryLot[];
  inventory_events: InventoryEvent[];
  recipes: Recipe[];
  recipe_variants: RecipeVariant[];
  recipe_ingredients: RecipeIngredient[];
  recipe_steps: RecipeStep[];
  meal_slots: MealSlot[];
  meal_plan_versions: MealPlanVersion[];
  plan_changes: PlanChange[];
  cook_sessions: CookSession[];
  cook_session_ingredients: CookSessionIngredient[];
  prepared_batches: PreparedBatch[];
  prepared_portion_events: PreparedPortionEvent[];
  consumption_events: ConsumptionEvent[];
  shopping_lists: ShoppingList[];
  shopping_items: ShoppingItem[];
  purchase_confirmations: PurchaseConfirmation[];
  schedule_constraints: ScheduleConstraint[];
  preferences: Preference[];
  protein_weekly_preferences: ProteinWeeklyPreference[];
  ingredient_substitutions: IngredientSubstitution[];
  ai_action_proposals: AiActionProposal[];
  audit_events: AuditEvent[];
  backup_metadata: BackupMetadata[];
}

export type TableName = keyof KitchenState;
export type Row = { id: Id; rev?: number } & Record<string, unknown>;

export const TABLES: TableName[] = [
  'ingredients', 'products', 'inventory_lots', 'inventory_events', 'recipes', 'recipe_variants',
  'recipe_ingredients', 'recipe_steps', 'meal_slots', 'meal_plan_versions', 'plan_changes',
  'cook_sessions', 'cook_session_ingredients', 'prepared_batches', 'prepared_portion_events',
  'consumption_events', 'shopping_lists', 'shopping_items', 'purchase_confirmations',
  'schedule_constraints', 'preferences', 'protein_weekly_preferences', 'ingredient_substitutions',
  'ai_action_proposals', 'audit_events', 'backup_metadata',
];

export function emptyState(): KitchenState {
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as KitchenState;
}
