import { LIBRARY_DEFS, LIBRARY_INGREDIENTS, PANTRY_DEFS } from './library';
import {
  AF, expandRecipes, ing, LEFTOVER, meat, mixRice, ODOR_CHICKEN, ODOR_FISH, SAFE_BEEF, SAFE_CHICKEN, SAFE_FISH, SAFE_PORK, SAFE_SHRIMP, sauce, type RecipeDef,
} from './seedHelpers';
import type { Ingredient, IngredientSubstitution, KitchenState, Product, ProteinWeeklyPreference } from './types';
import { emptyState } from './types';

/**
 * 种子只初始化「目录」：食材名称、菜谱、调料的「未确认」状态。
 * 这里没有任何库存批次 —— 用户何时买的、买了多少、价格多少一律未知，不编造。
 */

export const SEED_INGREDIENTS: Ingredient[] = [
  // 蛋白质
  ing('chicken_breast', '鸡胸肉', ['鸡胸', '鸡肉', 'chicken breast', 'chicken'], 'protein', 'g', meat({ note: '腌好后按一天一袋冷冻；腌法可以换，配方见菜谱页的厨房资料' })),
  ing('ground_beef', '牛肉碎', ['牛肉末', '碎牛肉', '牛肉', 'ground beef', 'beef'], 'protein', 'g', meat({})),
  ing('pork_loin', '猪里脊', ['里脊', '猪肉', 'pork loin', 'pork'], 'protein', 'g', meat({ shelfDays: 3, thawedDays: 3 })),
  ing('frozen_fish', '冷冻鱼片', ['鱼片', '鱼', '罗非鱼', 'tilapia', 'fish fillet', 'fish'], 'protein', 'g', meat({ shelfDays: 1 })),
  ing('frozen_shrimp', '冷冻虾', ['虾', '虾仁', 'shrimp', 'prawn'], 'protein', 'g', meat({ shelfDays: 1, quickThawMinutes: 15 })),
  ing('canned_sardine', '水浸沙丁鱼罐头', ['沙丁鱼', '沙丁鱼罐头', 'sardine', 'sardines'], 'protein', 'count', { countUnit: '罐' }),
  ing('canned_roast_beef', '牛肉罐头', ['罐头牛肉', 'roast beef', 'canned beef'], 'protein', 'count', { countUnit: '罐', note: '已经全熟，开罐即食。开罐后吃不完放冰箱。' }),
  ing('egg', '鸡蛋', ['蛋', 'egg', 'eggs'], 'staple', 'count', { countUnit: '颗', defaultLocation: 'fridge' }),
  // 主食与常温
  ing('rice', '大米', ['米', '米饭', 'rice'], 'staple', 'g'),
  ing('brown_rice', '糙米', ['brown rice'], 'staple', 'g'),
  ing('pasta', '意面', ['意大利面', 'pasta', 'spaghetti'], 'staple', 'g'),
  ing('glass_noodle', '粉丝', ['绿豆粉丝', 'glass noodles', 'vermicelli'], 'staple', 'count', { countUnit: '袋' }),
  ing('buldak_noodle', '火鸡面', ['buldak', '三养火鸡面'], 'staple', 'count', { countUnit: '包' }),
  ing('pork_dumpling', '猪肉饺子', ['比比古猪肉饺子', 'pork mandu'], 'staple', 'count', { countUnit: '个', defaultLocation: 'freezer', freezable: true }),
  ing('glass_noodle_dumpling', '粉丝饺子', ['比比古粉丝饺子'], 'staple', 'count', { countUnit: '个', defaultLocation: 'freezer', freezable: true }),
  ing('chia_seed', '奇亚籽', ['chia', 'chia seeds'], 'pantry', 'g'),
  ing('hotpot_base', '火锅底料', ['海底捞', '海底捞底料', 'hot pot base'], 'pantry', 'count', { countUnit: '块' }),
  ing('oats', '燕麦', ['燕麦片', 'oats', 'oatmeal'], 'staple', 'g'),
  ing('flour', '面粉', ['flour'], 'staple', 'g'),
  ing('wholewheat_flour', '全麦面粉', ['whole wheat flour'], 'staple', 'g'),
  ing('milk', '牛奶', ['milk'], 'staple', 'ml', { defaultLocation: 'fridge' }),
  ing('canned_tomato', '番茄罐头', ['罐头番茄', 'canned tomato', 'diced tomato'], 'pantry', 'count', { countUnit: '罐' }),
  // 新鲜蔬菜（采购候选，不代表已入库）
  ing('yellow_onion', '黄洋葱', ['洋葱', 'yellow onion', 'onion'], 'fresh', 'g', { shelfDays: 30, defaultLocation: 'pantry', freezable: true }),
  ing('scallion', '小葱', ['葱', '香葱', 'scallion', 'scallions', 'green onion', 'green onions'], 'fresh', 'count', { countUnit: '把', shelfDays: 7, defaultLocation: 'fridge', freezable: true, note: '葱白前段炒香、葱绿起锅前加；剩下可切碎冷冻' }),
  ing('mushroom', '褐蘑菇', ['蘑菇', 'Baby Bella', 'Cremini', 'mushroom', 'mushrooms'], 'fresh', 'g', { shelfDays: 7, defaultLocation: 'fridge', note: '偏好 whole 未切 8oz；先安排在前几天，剩余及时炒熟冷冻' }),
  ing('white_mushroom', '白蘑菇', ['white mushroom'], 'fresh', 'g', { shelfDays: 7, defaultLocation: 'fridge' }),
  ing('carrot', '胡萝卜', ['carrot', 'carrots'], 'fresh', 'count', { countUnit: '根', shelfDays: 21, defaultLocation: 'fridge', note: '优先散装 1–2 根，不买 2lb 整袋' }),
  ing('green_pepper', '青椒', ['green pepper'], 'fresh', 'count', { countUnit: '个', shelfDays: 7, defaultLocation: 'fridge' }),
  ing('bell_pepper', '彩椒', ['bell pepper'], 'fresh', 'count', { countUnit: '个', shelfDays: 7, defaultLocation: 'fridge' }),
  ing('tomato', '番茄', ['西红柿', 'tomato'], 'fresh', 'count', { countUnit: '个', shelfDays: 5, defaultLocation: 'fridge' }),
  ing('green_bean', '四季豆', ['green bean', 'green beans'], 'fresh', 'g', { shelfDays: 5, defaultLocation: 'fridge' }),
  // 冷冻蔬菜
  ing('frozen_broccoli', '冷冻西兰花', ['西兰花', 'broccoli'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('frozen_mixed_veg', '冷冻混合蔬菜', ['冷冻杂蔬', '杂蔬', 'mixed vegetables'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('frozen_spinach', '冷冻菠菜', ['菠菜', 'spinach'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('frozen_corn', '冷冻玉米', ['玉米', '玉米粒', 'corn', 'sweet corn'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('edamame', '冷冻毛豆', ['毛豆', '毛豆仁', 'edamame'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('frozen_pepper_onion', '冷冻辣椒洋葱', ['混合辣椒洋葱', '辣椒洋葱', '彩椒洋葱', 'pepper onion blend'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  // 调味品：用户声称拥有，数量未知 → 四态「未确认」
  sauce('olive_oil', '橄榄油', ['olive oil']),
  sauce('sesame_oil', '香油', ['sesame oil']),
  sauce('rattan_pepper_oil', '藤椒油'),
  sauce('scallion_oil', '葱油'),
  sauce('light_soy', '生抽', ['soy sauce']),
  sauce('dark_soy', '老抽', ['dark soy sauce']),
  sauce('oyster_sauce', '蚝油', ['oyster sauce']),
  sauce('black_vinegar', '陈醋', ['醋', 'vinegar']),
  sauce('honey', '蜂蜜', ['honey']),
  sauce('peanut_butter', '花生酱', ['peanut butter']),
  sauce('soybean_paste', '黄豆酱', ['豆酱', 'soybean paste']),
  sauce('ketchup', '番茄酱', ['ketchup']),
  sauce('minced_garlic', '蒜末', ['蒜', '大蒜', 'garlic']),
  sauce('ginger', '姜', ['生姜', 'ginger']),
  sauce('gochujang', '韩式辣酱', ['gochujang']),
  sauce('kimchi', '泡菜', ['kimchi']),
  sauce('laoganma', '老干妈', ['lao gan ma']),
  sauce('korean_bbq', '韩式BBQ酱', ['韩式 BBQ 酱', 'korean bbq']),
  sauce('mala_paste', '麻辣香锅炒料', ['香锅料']),
  sauce('thai_chili', '泰式尖辣椒', ['小米辣', '辣椒', 'thai chili']),
  sauce('yellow_mustard', '黄芥末酱', ['芥末', 'yellow mustard', 'mustard']),
  sauce('cfa_sauce', 'Chick-fil-A 蘸酱', ['cfa sauce']),
  sauce('curry_powder', '咖喱粉', ['咖喱', 'curry powder']),
  sauce('chili_powder', '辣椒粉', ['chili powder']),
  sauce('cumin', '孜然粉', ['孜然', 'cumin']),
  sauce('sichuan_pepper', '花椒', ['sichuan pepper']),
  sauce('black_pepper', '黑胡椒', ['black pepper']),
  sauce('white_pepper', '白胡椒', ['white pepper']),
  sauce('garlic_salt', '蒜盐', ['garlic salt']),
  sauce('garlic_powder', '蒜粉', ['garlic powder']),
  sauce('onion_powder', '洋葱粉', ['onion powder']),
  sauce('mushroom_seasoning', '蘑菇调味粉', ['蘑菇粉', 'mushroom seasoning']),
  sauce('sesame_seed', '芝麻', ['白芝麻', 'sesame seeds']),
  sauce('fennel_seed', '茴香籽', ['小茴香', 'fennel seed']),
  sauce('bbq_rub_spicy', '香辣烧烤料'),
  sauce('bbq_rub_cumin', '孜然烧烤料'),
  sauce('black_pepper_sauce', '黑椒酱', ['black pepper sauce'], { maybe: true, note: '可能有/待核实；菜谱用黑胡椒替代' }),
];

export const SEED_PRODUCTS: Product[] = [
  { id: 'p_mushroom_8oz', ingredientId: 'mushroom', name: 'Baby Bella / Cremini 整颗 8oz', retailer: null, packQty: 8, packUnit: 'oz', price: null, note: 'whole 未切', rev: 0 },
  { id: 'p_carrot_loose', ingredientId: 'carrot', name: '散装胡萝卜', retailer: null, packQty: 1, packUnit: '根', price: null, note: '不买 2lb 整袋', rev: 0 },
  { id: 'p_scallion', ingredientId: 'scallion', name: '小葱一把', retailer: null, packQty: 1, packUnit: '把', price: null, rev: 0 },
  { id: 'p_beef_1lb', ingredientId: 'ground_beef', name: '牛肉碎 93/7 1lb', retailer: null, packQty: 1, packUnit: 'lb', price: null, rev: 0 },
  { id: 'p_shrimp_2lb', ingredientId: 'frozen_shrimp', name: '冷冻虾 16–20 2lb', retailer: null, packQty: 2, packUnit: 'lb', price: null, rev: 0 },
  { id: 'p_tilapia_2lb', ingredientId: 'frozen_fish', name: '冷冻罗非鱼 2lb', retailer: null, packQty: 2, packUnit: 'lb', price: null, rev: 0 },
  { id: 'p_peas_2lb', ingredientId: 'frozen_sweet_peas', name: 'Great Value 甜豌豆 2lb', retailer: null, packQty: 2, packUnit: 'lb', price: null, rev: 0 },
  { id: 'p_pepper_onion_20oz', ingredientId: 'frozen_pepper_onion', name: 'Great Value 辣椒洋葱 20oz', retailer: null, packQty: 20, packUnit: 'oz', price: null, rev: 0 },
];

export const SEED_SUBSTITUTIONS: IngredientSubstitution[] = [
  { id: 's1', ingredientId: 'mushroom', substituteId: 'white_mushroom', note: '白蘑菇可替代' },
  { id: 's2', ingredientId: 'black_pepper_sauce', substituteId: 'black_pepper', note: '没有黑椒酱时用黑胡椒' },
  { id: 's3', ingredientId: 'carrot', substituteId: 'frozen_mixed_veg', note: '可用冷冻混合蔬菜代替胡萝卜' },
  { id: 's4', ingredientId: 'green_pepper', substituteId: 'bell_pepper', note: '彩椒可替代青椒' },
];

export const SEED_PROTEIN_PREFS: ProteinWeeklyPreference[] = [
  { id: 'chicken', daysPerWeek: 3, label: '鸡胸肉', rev: 0 },
  { id: 'beef', daysPerWeek: 1, label: '牛肉碎', rev: 0 },
  { id: 'pork', daysPerWeek: 1, label: '猪里脊', rev: 0 },
  { id: 'fish', daysPerWeek: 1, label: '冷冻鱼片', rev: 0 },
  { id: 'shrimp', daysPerWeek: 1, label: '虾 + 沙丁鱼', rev: 0 },
];

/** 默认 7 天结构：鸡肉日隔开排，不规定星期几。 */
export const ROTATION_CYCLE = ['R01', 'R04', 'R02', 'R05', 'R06', 'R03', 'R07'];

const DEFS: RecipeDef[] = [
  {
    id: 'R01', name: '黑椒蘑菇鸡丁', tier: 'core', protein: 'chicken', flavors: ['黑椒', '蒜香'],
    seasoning: '黑胡椒足量 + 蒜末 + 蚝油 10g/250g 肉；有黑椒酱可替换', cut: '鸡丁 1.5–2cm；空气炸 2–2.5cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['mushroom', 120], ['yellow_onion', 80], ['black_pepper', null, 'required', '足量'], ['minced_garlic', null, 'required', '适量'], ['oyster_sauce', null, 'required', '约 20g'], ['black_pepper_sauce', null, 'optional', '可替换黑胡椒'], ['rice', 150, 'optional', '配饭']],
    methods: [
      { key: 'pan', name: '炒锅煎焖收汁', equipment: ['pan'], minutes: 25, fit: '首选', steps: ['鸡胸切 1.5–2cm 丁，蘑菇切厚片，洋葱切块。', '少油中火把鸡丁铺开，先煎不翻，表面变白后盛出。', '同锅炒洋葱和蘑菇到出水变软。', '鸡丁回锅，加蒜末、蚝油、黑胡椒和 2 勺水，盖盖焖 3–4 分钟收汁。', '确认鸡肉中心 74°C 后出锅。'] },
      { key: 'hybrid', name: '空气炸 + 炒锅拌酱', equipment: ['airfryer', 'pan'], minutes: 25, fit: '适合混合', steps: ['鸡切 2–2.5cm 块，少油拌黑胡椒。', `空气炸锅 190°C 约 12 分钟，中途翻面。${AF}`, '另用炒锅炒蘑菇、洋葱。', '把鸡块倒回，加蚝油、蒜末翻匀。', '确认鸡肉中心 74°C。'] },
    ],
  },
  {
    id: 'R02', name: '孜然洋葱鸡丁', tier: 'core', protein: 'chicken', flavors: ['孜然', '香辣'], spicy: true,
    seasoning: '孜然粉 2g + 辣椒粉 1g + 生抽 5ml（每 250g 肉）', cut: '鸡丁 1.5–2cm；空气炸 2–2.5cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['yellow_onion', 100], ['cumin', null, 'required', '4g'], ['chili_powder', null, 'required', '2g'], ['light_soy', null, 'required', '10ml'], ['green_pepper', 1, 'optional', '可选'], ['rice', 150, 'optional', '配饭']],
    methods: [
      { key: 'airfryer', name: '空气炸锅', equipment: ['airfryer'], minutes: 20, fit: '非常适合', airfryerOnlyOk: true, steps: ['鸡切 2–2.5cm 块，拌孜然粉、辣椒粉、生抽，少许油。', `空气炸锅 190°C 约 10 分钟。${AF}`, '翻面，放洋葱（切大块防焦），再炸 5–7 分钟。', '确认鸡肉中心 74°C，洋葱别烤焦。'] },
      { key: 'pan', name: '低火力煎焖', equipment: ['pan'], minutes: 20, fit: '首选之一', steps: ['鸡丁拌孜然、辣椒粉、生抽。', '少油中火铺开煎到两面变色。', '加洋葱翻炒，淋 2 勺水盖盖焖 3 分钟。', '开盖收干，确认鸡肉中心 74°C。'] },
    ],
  },
  {
    id: 'R03', name: '咖喱鸡肉杂蔬', tier: 'core', protein: 'chicken', flavors: ['咖喱'],
    seasoning: '咖喱粉 + 少量牛奶或水', cut: '鸡丁 1.5–2cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['yellow_onion', 100], ['carrot', 1], ['frozen_mixed_veg', 283], ['curry_powder', null, 'required', '约 2 大勺'], ['milk', 100, 'optional', '也可用水'], ['rice', 150, 'optional', '配饭']],
    methods: [
      { key: 'pot', name: '小锅焖煮', equipment: ['pot'], minutes: 30, fit: '首选', steps: ['洋葱切丁炒软，胡萝卜切小块同炒。', '加鸡丁炒到变色。', '撒咖喱粉炒香，加水没过一半，小火焖 10 分钟。', '加冷冻杂蔬再煮 5 分钟，加少量牛奶收稠。', '确认鸡肉中心 74°C。'] },
      { key: 'hybrid', name: '鸡先烤后入咖喱汁', equipment: ['airfryer', 'pot'], minutes: 30, fit: '不建议纯炸：酱汁菜', steps: ['鸡块空气炸 190°C 约 10 分钟。', '小锅炒洋葱、胡萝卜，加咖喱粉和水煮软。', '放杂蔬和鸡块，再煮 5 分钟。', '确认鸡肉中心 74°C。'] },
    ],
  },
  {
    id: 'R04', name: '番茄牛肉碎意面', tier: 'core', protein: 'beef', flavors: ['番茄'],
    seasoning: '蒜末 + 黑胡椒 + 香草；番茄罐头作酱汁主体', cut: '牛肉碎，不需切配', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['canned_tomato', 1], ['yellow_onion', 100], ['pasta', 160], ['minced_garlic', null, 'required', '适量'], ['black_pepper', null, 'required', '适量'], ['mushroom', 80, 'optional', '可选']],
    methods: [
      { key: 'pan', name: '炒锅/小锅煮肉酱', equipment: ['pan', 'pot'], minutes: 30, fit: '首选；不建议空气炸', steps: ['洋葱切丁，蒜末备好。', '牛肉碎中火炒散至变色，沥掉多余油。', '加洋葱蒜末炒香，倒入番茄罐头，小火煮 12 分钟。', '另锅煮意面，捞出与肉酱拌匀。', '确认牛肉碎中心 71°C。'] },
    ],
  },
  {
    id: 'R05', name: '黄豆酱炒猪里脊', tier: 'core', protein: 'pork', flavors: ['酱香', '微辣'], spicy: true,
    seasoning: '黄豆酱约 12g/250g 肉 + 蒜末 + 小米辣，少量水收汁', cut: '薄片 4–6mm', leftover: LEFTOVER, safety: SAFE_PORK,
    ingredients: [['pork_loin', 454], ['yellow_onion', 80], ['soybean_paste', null, 'required', '约 24g'], ['minced_garlic', null, 'required', '适量'], ['thai_chili', null, 'optional', '按口味'], ['green_pepper', 1, 'optional', '可选'], ['rice', 150, 'optional', '配饭']],
    methods: [
      { key: 'pan', name: '薄片低火力煎焖', equipment: ['pan'], minutes: 20, fit: '首选', steps: ['里脊切 4–6mm 薄片。', '少油铺开两面煎到变色盛出。', '炒洋葱、蒜末、小米辣，加黄豆酱炒香。', '肉回锅加 2 勺水翻匀收汁，确认全熟。'] },
      { key: 'hybrid', name: '肉先烤后拌酱', equipment: ['airfryer', 'pan'], minutes: 20, fit: '适合混合', steps: ['里脊切厚片，少油拌匀。', `空气炸锅 190°C 约 8 分钟。${AF}`, '炒锅炒洋葱和黄豆酱，加少量水。', '肉片回锅翻匀。'] },
    ],
  },
  {
    id: 'R06', name: '番茄炖鱼片', tier: 'core', protein: 'fish', flavors: ['番茄', '酸甜'],
    seasoning: '番茄罐头 + 蒜末 + 黑胡椒', cut: '鱼片切块，提前冰箱解冻', odor: ODOR_FISH, leftover: LEFTOVER, safety: SAFE_FISH,
    ingredients: [['frozen_fish', 454], ['canned_tomato', 1], ['minced_garlic', null, 'required', '适量'], ['black_pepper', null, 'required', '适量'], ['frozen_spinach', 80, 'optional', '可选蔬菜'], ['rice', 150, 'optional', '配饭']],
    methods: [
      { key: 'pot', name: '小锅轻炖', equipment: ['pot'], minutes: 20, fit: '首选', steps: ['鱼片提前放冰箱解冻，擦干切块。', '小锅炒蒜末，倒番茄罐头煮 5 分钟。', '放鱼块，小火轻炖 6–8 分钟，不要大力搅。', '确认鱼中心 63°C、能分瓣。'] },
      { key: 'hybrid', name: '鱼先烤后浇番茄汁', equipment: ['airfryer', 'pot'], minutes: 20, fit: '可选混合', steps: ['鱼片解冻擦干，空气炸 190°C 约 8 分钟。', '小锅煮番茄蒜末汁。', '浇在鱼上，确认鱼中心 63°C。'] },
    ],
  },
  {
    id: 'R07', name: '蒜香番茄虾仁 + 沙丁鱼', tier: 'core', protein: 'shrimp', flavors: ['蒜香', '番茄'],
    seasoning: '蒜 + 黑胡椒 + 少量辣椒', cut: '虾解冻沥干', leftover: LEFTOVER, safety: SAFE_SHRIMP,
    ingredients: [['frozen_shrimp', 350], ['canned_sardine', 1], ['canned_tomato', 1], ['minced_garlic', null, 'required', '足量'], ['black_pepper', null, 'required', '适量'], ['chili_powder', null, 'optional', '少量'], ['rice', 150, 'optional', '配饭']],
    methods: [
      { key: 'pan', name: '虾炒锅，沙丁鱼另配', equipment: ['pan'], minutes: 15, fit: '首选', steps: ['虾放冷水解冻约 15 分钟，沥干。', '炒蒜末，倒番茄罐头煮 4 分钟。', '放虾炒到不透明、肉质紧实。', '沙丁鱼开罐沥水，可并入或分开吃，不必混在一道菜。'] },
      { key: 'hybrid', name: '虾空气炸，番茄汁另做', equipment: ['airfryer', 'pot'], minutes: 18, fit: '部分适合；沙丁鱼不需炸', steps: ['虾解冻沥干，少油拌蒜末。', `空气炸 190°C 约 6 分钟。${AF}`, '小锅煮番茄汁，拌入虾。', '沙丁鱼开罐另配。'] },
    ],
  },
  // —— 风味变体（默认启用，但不挤占首屏）——
  {
    id: 'V01', name: '蒜香蚝油鸡', tier: 'variant', parentId: 'R01', protein: 'chicken', flavors: ['蒜香'],
    seasoning: '蚝油 10g + 生抽 5ml + 蒜末（每 250g 肉）', cut: '鸡丁 1.5–2cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['oyster_sauce', null, 'required', '20g'], ['light_soy', null, 'required', '10ml'], ['minced_garlic', null, 'required', '足量']],
    methods: [{ key: 'pan', name: '煎焖收汁', equipment: ['pan'], minutes: 18, fit: '首选', steps: ['鸡丁少油煎到变色。', '加蒜末炒香，加蚝油、生抽和 2 勺水。', '盖盖焖 3 分钟收汁，确认中心 74°C。'] }],
  },
  {
    id: 'V02', name: '韩式 BBQ 空气炸鸡', tier: 'variant', parentId: 'R02', protein: 'chicken', flavors: ['韩式', '甜咸'],
    seasoning: 'BBQ 酱 15–20g + 蒜末（每 250g 肉），烤后再拌防焦', cut: '鸡块 2–2.5cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['korean_bbq', null, 'required', '30–40g'], ['minced_garlic', null, 'required', '适量']],
    methods: [{ key: 'airfryer', name: '空气炸锅，酱后拌', equipment: ['airfryer'], minutes: 18, fit: '非常适合', airfryerOnlyOk: true, steps: ['鸡块少油拌匀。', `空气炸 190°C 约 14 分钟，中途翻面。${AF}`, '确认中心 74°C。', '出锅拌 BBQ 酱和蒜末（含糖酱后拌，防烤焦）。'] }],
  },
  {
    id: 'V03', name: '韩式甜辣空气炸鸡', tier: 'variant', parentId: 'R02', protein: 'chicken', flavors: ['韩式', '甜辣'], spicy: true,
    seasoning: '韩式辣酱 12g + 蜂蜜 5g + 生抽 5ml（每 250g 肉），烤后再拌', cut: '鸡块 2–2.5cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['gochujang', null, 'required', '24g'], ['honey', null, 'required', '10g'], ['light_soy', null, 'required', '10ml']],
    methods: [{ key: 'airfryer', name: '空气炸锅，酱后拌', equipment: ['airfryer'], minutes: 18, fit: '非常适合', airfryerOnlyOk: true, steps: ['鸡块少油拌匀。', `空气炸 190°C 约 14 分钟，中途翻面。${AF}`, '确认中心 74°C。', '调好甜辣酱，出锅拌匀（含糖酱后拌）。'] }],
  },
  {
    id: 'V04', name: '韩式甜辣鸡 + 杂蔬', tier: 'variant', parentId: 'R03', protein: 'chicken', flavors: ['韩式', '甜辣'], spicy: true,
    seasoning: '韩式辣酱 12g + 蜂蜜 5g + 生抽 5ml（每 250g 肉）', cut: '鸡丁 1.5–2cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['frozen_mixed_veg', 283], ['gochujang', null, 'required', '24g'], ['honey', null, 'required', '10g'], ['light_soy', null, 'required', '10ml']],
    methods: [{ key: 'pan', name: '煎焖拌酱', equipment: ['pan'], minutes: 22, fit: '首选', steps: ['鸡丁煎到变色。', '下杂蔬炒 3 分钟。', '加酱和 2 勺水焖 3 分钟，确认中心 74°C。'] }],
  },
  {
    id: 'V05', name: '韩式泡菜牛肉饭', tier: 'variant', parentId: 'R04', protein: 'beef', flavors: ['韩式', '酸辣'], spicy: true,
    seasoning: '泡菜 + 少量韩式辣酱 + 生抽', cut: '牛肉碎', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['kimchi', null, 'required', '约 150g'], ['rice', 160], ['light_soy', null, 'required', '少量'], ['gochujang', null, 'optional', '少量']],
    methods: [{ key: 'pan', name: '炒锅', equipment: ['pan'], minutes: 20, fit: '首选', steps: ['煮饭。', '牛肉碎炒散至变色，沥多余油。', '加泡菜炒 3 分钟，加生抽。', '确认牛肉碎中心 71°C，盖在饭上。'] }],
  },
  {
    id: 'V06', name: '藤椒猪里脊', tier: 'variant', parentId: 'R05', protein: 'pork', flavors: ['藤椒', '麻'], spicy: true,
    seasoning: '生抽 8ml + 陈醋 5ml（每 250g 肉）+ 少量藤椒油，出锅前加', cut: '薄片 4–6mm', leftover: LEFTOVER, safety: SAFE_PORK,
    ingredients: [['pork_loin', 454], ['rattan_pepper_oil', null, 'required', '少量'], ['light_soy', null, 'required', '16ml'], ['black_vinegar', null, 'required', '10ml']],
    methods: [{ key: 'pan', name: '薄片煎炒', equipment: ['pan'], minutes: 15, fit: '首选', steps: ['里脊切薄片。', '少油煎到两面变色、全熟。', '加生抽、陈醋翻匀。', '关火后淋藤椒油。'] }],
  },
  {
    id: 'V07', name: '孜然烤猪里脊', tier: 'variant', parentId: 'R05', protein: 'pork', flavors: ['孜然'], spicy: true,
    seasoning: '孜然粉 + 辣椒粉 + 生抽', cut: '厚片或 2cm 块', leftover: LEFTOVER, safety: SAFE_PORK,
    ingredients: [['pork_loin', 454], ['cumin', null, 'required', '4g'], ['chili_powder', null, 'required', '2g'], ['light_soy', null, 'required', '10ml']],
    methods: [{ key: 'airfryer', name: '空气炸锅', equipment: ['airfryer'], minutes: 18, fit: '适合', airfryerOnlyOk: true, steps: ['肉拌调料和少许油。', `空气炸 190°C 约 12 分钟，中途翻面。${AF}`, '确认中心 63°C 后静置 3 分钟。'] }],
  },
  {
    id: 'V08', name: '葱姜鱼', tier: 'variant', parentId: 'R06', protein: 'fish', flavors: ['葱姜'],
    seasoning: '姜丝 + 小葱 + 生抽', cut: '鱼片提前解冻', odor: ODOR_FISH, leftover: LEFTOVER, safety: SAFE_FISH,
    ingredients: [['frozen_fish', 454], ['ginger', null, 'required', '几片'], ['scallion', 0.5], ['light_soy', null, 'required', '少量']],
    methods: [{ key: 'steamer', name: '蒸', equipment: ['steamer'], minutes: 15, fit: '首选', steps: ['鱼解冻擦干，铺姜丝。', '水开后蒸 8 分钟。', '撒葱花淋生抽，确认中心 63°C。'] }],
  },
  {
    id: 'V09', name: '蒜香烤鱼', tier: 'variant', parentId: 'R06', protein: 'fish', flavors: ['蒜香'],
    seasoning: '蒜末 + 黑胡椒 + 少量橄榄油', cut: '鱼片提前解冻', odor: ODOR_FISH, leftover: LEFTOVER, safety: SAFE_FISH,
    ingredients: [['frozen_fish', 454], ['minced_garlic', null, 'required', '适量'], ['black_pepper', null, 'required', '适量'], ['olive_oil', null, 'required', '少量']],
    methods: [{ key: 'airfryer', name: '空气炸锅', equipment: ['airfryer'], minutes: 12, fit: '适合', airfryerOnlyOk: true, steps: ['鱼解冻擦干，抹蒜末黑胡椒和少量油。', `空气炸 190°C 约 8 分钟。${AF}`, '确认中心 63°C。'] }],
  },
  {
    id: 'V10', name: '老干妈虾仁炒饭', tier: 'variant', parentId: 'R07', protein: 'shrimp', flavors: ['香辣'], spicy: true,
    seasoning: '老干妈少量起步', cut: '虾解冻沥干', leftover: LEFTOVER, safety: SAFE_SHRIMP,
    ingredients: [['frozen_shrimp', 350], ['rice', 160], ['egg', 2], ['laoganma', null, 'required', '少量起步'], ['canned_sardine', 1, 'optional', '可分开吃']],
    methods: [{ key: 'pan', name: '炒锅', equipment: ['pan'], minutes: 15, fit: '首选', steps: ['虾冷水解冻 15 分钟，沥干。', '炒蛋盛出；炒虾至不透明、肉质紧实。', '下米饭和老干妈翻炒，蛋回锅。'] }],
  },
  // —— 备选 ——
  {
    id: 'B01', name: '花生酱鸡丝拌面', tier: 'backup', protein: 'chicken', flavors: ['花生', '酸辣'],
    seasoning: '花生酱 10g + 生抽 5ml + 陈醋 8ml + 水调稀（每份）', cut: '鸡胸煮熟撕丝', leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['pasta', 160], ['peanut_butter', null, 'required', '20g'], ['light_soy', null, 'required', '10ml'], ['black_vinegar', null, 'required', '16ml']],
    methods: [{ key: 'pot', name: '煮', equipment: ['pot'], minutes: 25, fit: '首选', steps: ['鸡胸加姜片小火煮到中心 74°C，撕丝。', '煮面过水。', '调花生酱汁，拌匀。'] }],
  },
  {
    id: 'B02', name: '麻辣香锅牛肉杂蔬', tier: 'backup', protein: 'beef', flavors: ['麻辣'], spicy: true,
    seasoning: '炒料 10–15g，谨慎额外加盐和油', cut: '牛肉碎', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['frozen_mixed_veg', 283], ['mala_paste', null, 'required', '20–30g']],
    methods: [{ key: 'pan', name: '炒锅', equipment: ['pan'], minutes: 18, fit: '首选', steps: ['牛肉碎炒散至变色。', '加炒料炒香，下杂蔬炒 4 分钟。', '确认牛肉碎中心 71°C。'] }],
  },
  {
    id: 'B03', name: '葱花鸡蛋炒饭', tier: 'backup', protein: 'egg', flavors: ['家常'],
    seasoning: '生抽少量', cut: '葱切葱花', leftover: LEFTOVER, safety: '鸡蛋炒至凝固；米饭放凉后尽快冷藏，复热到 74°C。',
    ingredients: [['egg', 3], ['rice', 160], ['scallion', 0.25], ['light_soy', null, 'required', '少量']],
    methods: [{ key: 'pan', name: '炒锅', equipment: ['pan'], minutes: 12, fit: '首选', steps: ['煮饭或用已有米饭。', '蛋液炒散。', '下饭翻炒，加生抽和葱绿。'] }],
  },
  {
    id: 'B04', name: '蜂蜜芥末鸡丁', tier: 'backup', protein: 'chicken', flavors: ['甜咸'],
    seasoning: '黄芥末 10g + 蜂蜜 5g + 少量醋（每 250g 肉）', cut: '鸡块 2–2.5cm', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 454], ['yellow_mustard', null, 'required', '20g'], ['honey', null, 'required', '10g'], ['black_vinegar', null, 'optional', '少量']],
    methods: [{ key: 'airfryer', name: '空气炸锅，酱后拌', equipment: ['airfryer'], minutes: 18, fit: '适合', airfryerOnlyOk: true, steps: ['鸡块少油拌匀。', `空气炸 190°C 约 14 分钟。${AF}`, '确认中心 74°C，出锅拌酱。'] }],
  },
  {
    id: 'B05', name: '番茄鱼块意面', tier: 'backup', protein: 'fish', flavors: ['番茄'],
    seasoning: '番茄罐头 + 蒜末 + 黑胡椒', cut: '鱼块提前解冻', odor: ODOR_FISH, leftover: LEFTOVER, safety: SAFE_FISH,
    ingredients: [['frozen_fish', 454], ['canned_tomato', 1], ['pasta', 160], ['minced_garlic', null, 'required', '适量']],
    methods: [{ key: 'pot', name: '小锅', equipment: ['pot'], minutes: 25, fit: '首选', steps: ['煮面。', '蒜末炒香加番茄煮 5 分钟。', '放鱼块轻煮 6 分钟，拌面，确认中心 63°C。'] }],
  },
  // —— 加餐（不计入每周肉类日）——
  {
    id: 'S01', name: '快手空气炸鸡块 + 主食', tier: 'snack', protein: 'chicken', flavors: ['家常'],
    seasoning: '黑胡椒、一点生抽', cut: '鸡块 2–2.5cm', leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_breast', 150], ['rice', 80, 'optional', '已有主食'], ['black_pepper', null, 'optional', '适量']],
    methods: [{ key: 'airfryer', name: '空气炸锅', equipment: ['airfryer'], minutes: 15, fit: '非常适合', airfryerOnlyOk: true, steps: ['鸡块少油拌胡椒。', `空气炸 190°C 约 11 分钟，中途翻面。${AF}`, '确认中心 74°C，配已有主食。'] }],
  },
  {
    id: 'S02', name: '牛奶燕麦 + 鸡蛋', tier: 'snack', protein: 'egg', flavors: ['家常'],
    seasoning: '无', cut: '无', leftover: '现吃现做。', safety: '鸡蛋煮或煎至凝固。',
    ingredients: [['oats', 50], ['milk', 200], ['egg', 1]],
    methods: [{ key: 'pot', name: '小锅/微波', equipment: ['pot'], minutes: 8, fit: '首选', steps: ['燕麦加牛奶煮 3 分钟。', '另煮或煎 1 颗蛋。'] }],
  },
];

/** 新装的数据本来就是 454g，不需要走 syncCatalog 里的用量迁移。 */
export const BAG_QTY_MIGRATION = 'migration:bag_qty_454g';
/** 同上：瘦肉 454g、冷冻混合蔬菜 283g。 */
export const PORTION_QTY_MIGRATION = 'migration:portion_qty';
/** 同上：配饭白米糙米各一半。 */
export const RICE_QTY_MIGRATION = 'migration:mixed_rice';

export function seedRecipes(): Pick<KitchenState, 'recipes' | 'recipe_variants' | 'recipe_ingredients' | 'recipe_steps'> {
  return expandRecipes([...DEFS, ...LIBRARY_DEFS, ...PANTRY_DEFS].map(mixRice));
}

export function seedState(): KitchenState {
  return {
    ...emptyState(),
    ingredients: [...SEED_INGREDIENTS, ...LIBRARY_INGREDIENTS].map((i) => ({ ...i })),
    products: SEED_PRODUCTS.map((p) => ({ ...p })),
    ingredient_substitutions: SEED_SUBSTITUTIONS.map((s) => ({ ...s })),
    protein_weekly_preferences: SEED_PROTEIN_PREFS.map((p) => ({ ...p })),
    ...seedRecipes(),
    preferences: [
      { id: 'rotationCursor', value: 0, rev: 0 },
      { id: 'shopIntervalDays', value: 14, rev: 0 },
      { id: 'nextShopDate', value: null, rev: 0 },
      { id: BAG_QTY_MIGRATION, value: true, rev: 0 },
      { id: PORTION_QTY_MIGRATION, value: true, rev: 0 },
      { id: RICE_QTY_MIGRATION, value: true, rev: 0 },
    ],
  };
}
