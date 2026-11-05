import { AF, ing, LEFTOVER, meat, ODOR_CHICKEN, SAFE_BEEF, SAFE_CHICKEN, SAFE_SHRIMP, sauce, type IngDef, type MethodDef, type RecipeDef } from './seedHelpers';
import type { Ingredient } from './types';

/**
 * 用户自己积累的菜谱库，从 06-Life/Health 下的配方笔记导入。导入后以这里为准。
 *
 * 只收菜和食材，不收旧饮食计划：每日餐单、周结构、热量目标、增肌减脂阶段、采购频率都没有进来。
 * 这些菜不进自动推荐（规格：不要不断生成陌生新菜），用户点名或自己排进计划才会出现。
 * 笔记里没写的主料用量，一律按一天 1 lb 生肉吃两顿，可在菜谱里改。
 */

const lib = (i: Ingredient): Ingredient => ({ ...i, catalogOnly: true });

export const LIBRARY_INGREDIENTS: Ingredient[] = [
  // 蛋白质
  ing('beef_slices', '牛肉片', ['sliced beef', 'beef slices'], 'protein', 'g', meat({ note: '逆纹切 3–5mm，腌好后按一天一袋冷冻' })),
  ing('chicken_drumstick', '琵琶腿', ['鸡腿', '鸡小腿', 'drumstick'], 'protein', 'g', meat({})),
  ing('pork_ribs', '排骨', ['猪排骨', 'ribs', 'pork ribs'], 'protein', 'g', meat({ shelfDays: 3, thawedDays: 3 })),
  ing('pork_belly', '五花肉', ['带皮五花肉', 'pork belly'], 'protein', 'g', meat({ shelfDays: 3, thawedDays: 3 })),
  ing('chicken_liver', '鸡肝', ['chicken liver'], 'protein', 'g', meat({ shelfDays: 1, thawedDays: 1, note: '维生素 A 和胆固醇很高，一周最多一次；孕期慎食' })),
  ing('beef_liver', '牛肝', ['小牛肝', 'beef liver', 'calf liver'], 'protein', 'g', meat({ shelfDays: 1, thawedDays: 1, note: '维生素 A 和胆固醇很高，一周最多一次；孕期慎食。Skylark 冷冻牛肝约 $2.82/lb、小牛肝约 $3.68/lb（笔记记录）' })),
  ing('protein_powder', '蛋白粉', ['乳清蛋白', 'whey', 'protein powder'], 'pantry', 'g'),
  // 主食与常温
  ing('potato', '土豆', ['马铃薯', 'Russet', 'potato', 'potatoes'], 'fresh', 'g', { shelfDays: 21, note: '笔记里常买 10 lb 袋' }),
  ing('whole_grain_bread', '全谷物面包', ['谷物面包', "Dave's Killer Bread", 'whole grain bread'], 'staple', 'count', { countUnit: '片' }),
  ing('white_toast', '白吐司', ['吐司', 'white toast'], 'staple', 'count', { countUnit: '片' }),
  ing('chickpea', '鹰嘴豆', ['chickpea', 'chickpeas', 'garbanzo'], 'pantry', 'g', { note: '干豆约 150g 煮熟后约 375g' }),
  // 新鲜与乳制品
  ing('yogurt', '脱脂酸奶', ['酸奶', 'yogurt'], 'staple', 'g', { defaultLocation: 'fridge', shelfDays: 7, note: '无添加糖；开封后 5–7 天内吃完' }),
  ing('mozzarella', '脱脂马苏里拉', ['马苏里拉', 'mozzarella'], 'staple', 'g', { defaultLocation: 'fridge' }),
  ing('cheese_slice', '芝士片', ['cheese slice'], 'staple', 'count', { countUnit: '片', defaultLocation: 'fridge' }),
  ing('banana', '香蕉', ['banana', 'bananas'], 'fresh', 'count', { countUnit: '根', shelfDays: 5 }),
  ing('celery', '芹菜', ['celery'], 'fresh', 'g', { shelfDays: 7, defaultLocation: 'fridge' }),
  ing('leek', '大葱', ['葱白', 'leek'], 'fresh', 'g', { shelfDays: 7, defaultLocation: 'fridge' }),
  // 冷冻蔬菜
  ing('frozen_kale', '冷冻羽衣甘蓝', ['羽衣甘蓝', 'kale'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('frozen_pumpkin', '冷冻南瓜', ['南瓜', 'pumpkin', 'butternut squash'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  ing('frozen_sweet_peas', '冷冻甜豌豆', ['甜豌豆', 'sweet peas'], 'frozen_veg', 'g', { defaultLocation: 'freezer', freezable: true }),
  // 调味品：菜谱用到、原调料清单里没有确认的，保持「未确认」
  sauce('doubanjiang', '豆瓣酱', ['郫县豆瓣', 'doubanjiang']),
  sauce('cooking_wine', '料酒', ['cooking wine']),
  sauce('sichuan_pepper_oil', '花椒油', ['sichuan pepper oil']),
  sauce('sugar', '白糖', ['sugar']),
  sauce('salt', '盐', ['salt']),
  sauce('msg', '味精', ['msg']),
  sauce('corn_starch', '玉米淀粉', ['淀粉', '水淀粉', 'corn starch']),
  sauce('fermented_tofu', '腐乳', ['fermented tofu']),
  sauce('rock_sugar', '冰糖', ['rock sugar']),
  sauce('chicken_bouillon', '鸡精', ['chicken bouillon']),
  sauce('lemongrass', '香茅', ['lemongrass']),
  sauce('braise_spices', '卤料香料', ['八角', '桂皮', '香叶']),
  sauce('tahini', '芝麻酱', ['tahini']),
  sauce('cocoa_powder', '可可粉', ['cocoa powder']),
].map(lib);

const SAFE_BEEF_SLICE = '牛肉片炒或涮到完全变色、不留红色。';
const SAFE_RIBS = '猪肉中心至少 63°C 并静置 3 分钟；排骨要焖到熟透。';
const SAFE_LIVER_NOTE = '一周最多一次，维生素 A 和胆固醇很高；孕期慎食。';

const CHICKEN: IngDef = ['chicken_breast', 454];
const BEEF: IngDef = ['beef_slices', 454];
const VEG: IngDef = ['frozen_mixed_veg', 283, 'optional', '任意蔬菜'];
const RICE: IngDef = ['rice', 150, 'optional', '配饭'];
const need = (id: string, label = '适量'): IngDef => [id, null, 'required', label];
const maybe = (id: string, label = '适量'): IngDef => [id, null, 'optional', label];

const CUT_CHICKEN = '鸡片 4–6mm 或鸡丁 1.5–2cm。腌好的肉解冻后直接下锅，底味偏轻，按口味调味';
const CUT_BEEF = '逆纹切片 3–5mm。腌好的肉解冻后直接下锅，底味偏轻，按口味调味';
const WEAK_STOVE = '原配方要大火；火力不强时分小批铺开，别堆在锅里';

const pan = (minutes: number, steps: string[], fit = '首选'): MethodDef[] => [{ key: 'pan', name: '炒锅', equipment: ['pan'], minutes, fit, steps }];
const pot = (minutes: number, steps: string[], fit = '首选'): MethodDef[] => [{ key: 'pot', name: '小锅', equipment: ['pot'], minutes, fit, steps }];

function chicken(id: string, name: string, flavors: string[], seasoning: string, ingredients: IngDef[], methods: MethodDef[], spicy = false): RecipeDef {
  return { id, name, tier: 'library', protein: 'chicken', flavors, spicy, seasoning, cut: CUT_CHICKEN, odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN, ingredients: [CHICKEN, ...ingredients, RICE], methods };
}

function beef(id: string, name: string, flavors: string[], seasoning: string, ingredients: IngDef[], methods: MethodDef[], spicy = false): RecipeDef {
  return { id, name, tier: 'library', protein: 'beef', flavors, spicy, seasoning, cut: CUT_BEEF, leftover: LEFTOVER, safety: SAFE_BEEF_SLICE, ingredients: [BEEF, ...ingredients, RICE], methods };
}

const COLD_BOIL = (cut: string) => `鸡胸加姜片小火煮到中心 74°C，${cut}放凉。`;

export const LIBRARY_DEFS: RecipeDef[] = [
  // —— 鸡胸：煎 / 烤 ——
  chicken('L01', '黑椒煎鸡胸', ['黑椒'], '生抽 + 蚝油 + 黑胡椒，出锅前淋', [need('light_soy'), need('oyster_sauce'), need('black_pepper', '足量')],
    pan(18, ['平底锅热油，中火把鸡胸煎到两面金黄。', '出锅前淋生抽、蚝油，撒黑胡椒。', '确认鸡肉中心 74°C。'])),
  chicken('L27', 'BBQ烤鸡胸', ['韩式', '甜咸'], '韩式 BBQ 酱，最后 3 分钟刷', [need('korean_bbq', '刷面用')],
    [{ key: 'oven', name: '烤箱', equipment: ['oven'], minutes: 25, fit: '首选', steps: ['烤箱预热 200°C。', '鸡胸铺在烤盘上，烤约 12 分钟。', '刷韩式 BBQ 酱，再烤 3 分钟收面。', '确认鸡肉中心 74°C，厚块要多烤几分钟。'] }]),
  chicken('L28', '蜂蜜芥末煎鸡', ['甜咸'], '黄芥末酱 + 蜂蜜 + 少量陈醋', [need('yellow_mustard'), need('honey'), need('black_vinegar', '少量')],
    pan(18, ['鸡胸煎到全熟，确认中心 74°C。', '锅中加黄芥末酱、蜂蜜和少量陈醋。', '翻匀出锅。'])),
  // —— 鸡胸：炒 ——
  chicken('L02', '泰式辣炒鸡', ['香辣'], '泰式尖辣椒 + 蒜末爆香，生抽 + 蚝油 + 藤椒油', [need('thai_chili'), need('minced_garlic'), need('light_soy'), need('oyster_sauce'), need('rattan_pepper_oil', '少量')],
    pan(18, ['泰式尖辣椒和蒜末爆香。', '下鸡胸炒到变色。', '加生抽、蚝油、藤椒油快炒。', '确认鸡肉中心 74°C。'], WEAK_STOVE), true),
  chicken('L03', '韩式泡菜炒鸡', ['韩式', '酸辣'], '泡菜 + 韩式辣酱，生抽 + 香油收汁', [need('kimchi', '约 150g'), need('gochujang', '少量'), need('light_soy'), need('sesame_oil', '少量')],
    pan(18, ['泡菜和韩式辣酱下锅炒香。', '下鸡胸翻炒到变色。', '加生抽和香油收汁。', '确认鸡肉中心 74°C。']), true),
  chicken('L04', '黄豆酱炒鸡', ['酱香'], '黄豆酱 + 生抽 + 蚝油', [need('minced_garlic'), need('soybean_paste'), need('light_soy'), need('oyster_sauce')],
    pan(18, ['蒜末爆香。', '加黄豆酱、生抽、蚝油炒香。', '下鸡胸快炒到全熟。', '确认鸡肉中心 74°C。'], WEAK_STOVE)),
  chicken('L05', '麻辣香锅鸡', ['麻辣'], '麻辣香锅炒料 + 豆瓣酱 + 蒜末炒红油；炒料已够咸，谨慎加盐', [need('mala_paste', '20–30g'), need('doubanjiang'), need('minced_garlic'), VEG],
    pan(20, ['炒料、豆瓣酱、蒜末炒出红油。', '下鸡胸和蔬菜翻炒。', '确认鸡肉中心 74°C。']), true),
  // —— 鸡胸：焖 / 炖 ——
  chicken('L06', '红烧鸡胸', ['酱香'], '生抽 + 老抽 + 蚝油 + 豆瓣酱，加水小火焖', [need('light_soy'), need('dark_soy', '少量'), need('oyster_sauce'), need('doubanjiang')],
    pan(25, ['鸡胸煎上色。', '加生抽、老抽、蚝油、豆瓣酱和水。', '小火焖 10 分钟。', '确认鸡肉中心 74°C。'])),
  chicken('L29', '咖喱鸡（简版）', ['咖喱'], '橄榄油炒香咖喱粉和蒜末，加水或椰奶炖到收汁', [need('olive_oil'), need('curry_powder'), need('minced_garlic')],
    pot(25, ['橄榄油炒香咖喱粉和蒜末。', '下鸡胸炒到变色。', '加水或椰奶，炖到收汁。', '确认鸡肉中心 74°C。'])),
  chicken('L07', '三杯鸡', ['酱香', '蒜香'], '生抽 : 老抽 : 料酒 = 1 : 0.3 : 1（30ml、10ml、30ml）', [need('sesame_oil'), need('minced_garlic'), need('light_soy', '30ml'), need('dark_soy', '10ml'), need('cooking_wine', '30ml，没有就用陈醋减半')],
    pan(22, ['香油爆香蒜末。', '下鸡胸煎到表面微焦。', '加生抽、老抽、料酒，中火焖到汤汁浓稠收干。', '出锅前可加罗勒叶增香，确认鸡肉中心 74°C。'])),
  {
    id: 'L08', name: '油焖鸡', tier: 'library', protein: 'chicken', flavors: ['香辣', '蒜香'], spicy: true, servings: 1,
    seasoning: '蒜 90g + 小米辣打碎，蚝油、盐、味精；番茄酱可选', cut: '琵琶腿剁成 5–6 块，不用腌；土豆切滚刀块', odor: ODOR_CHICKEN, leftover: LEFTOVER, safety: SAFE_CHICKEN,
    ingredients: [['chicken_drumstick', 200], ['potato', 600], ['tomato', 0.5], need('minced_garlic', '90g'), need('thai_chili', '微辣 40g / 中辣 60g / 特辣 80g'), ['scallion', 0.25, 'required', '约 10g'], need('ginger', '10g'), maybe('lemongrass', '5g'), need('salt', '5g'), need('msg', '2g'), need('oyster_sauce', '60g（笔记写作「耗油」，按蚝油理解）'), maybe('ketchup', '20g')],
    methods: pot(60, ['土豆切块泡水；鸡腿块清水泡 15 分钟去血水（冻鸡腿加葱、姜、大料）。', '西红柿去皮切小丁；蒜和小米辣用手持搅拌机打碎，或手剁到约 1mm；葱和香茅切末。', '土豆下盐水煮软。鸡腿块加盐煮约 15 分钟，再泡 15 分钟入味。', '锅中倒蚝油，下西红柿丁、蒜辣碎、葱末、香茅末炒香，加味精和可选的番茄酱。', '倒入土豆边压边炒约 2 分钟，关小火捣碎，加盐和味精调味。', '开火，倒入鸡块炒 2 分钟，转小火焖 2 分钟。', '确认鸡肉中心 74°C。']),
  },
  // —— 鸡胸：凉拌 ——
  chicken('L09', '花生麻酱鸡', ['花生'], '花生酱 + 生抽 + 陈醋 + 香油 + 蒜末，热水调稀', [need('peanut_butter'), need('light_soy'), need('black_vinegar'), need('sesame_oil', '少量'), need('minced_garlic')],
    pot(22, [COLD_BOIL('撕条'), '花生酱、生抽、陈醋、香油、蒜末用热水调稀。', '淋在鸡丝上拌匀。'])),
  chicken('L10', '川味口水鸡', ['麻辣', '酸辣'], '老干妈 + 生抽 + 陈醋 + 藤椒油 + 香油 + 蒜末', [need('laoganma'), need('light_soy'), need('black_vinegar'), need('rattan_pepper_oil', '少量'), need('sesame_oil', '少量'), need('minced_garlic')],
    pot(22, [COLD_BOIL('切片'), '调好老干妈、生抽、陈醋、藤椒油、香油、蒜末。', '淋在鸡片上。']), true),
  chicken('L11', '芥末鸡丝沙拉', ['甜咸'], '黄芥末酱 : 蜂蜜 : 陈醋 : 橄榄油 = 1 : 1 : 0.5 : 2', [need('yellow_mustard'), need('honey'), need('black_vinegar'), need('olive_oil')],
    pot(22, [COLD_BOIL('撕条'), '黄芥末酱、蜂蜜、陈醋、橄榄油按比例调匀。', '拌入鸡丝。'])),
  // —— 牛肉：炒 ——
  beef('L12', '葱爆牛肉', ['葱香'], '葱油爆香，生抽 + 蚝油 + 少量老抽', [need('scallion_oil'), need('light_soy'), need('oyster_sauce'), need('dark_soy', '少量')],
    pan(12, ['葱油爆香。', '牛肉分小批下锅，快炒到完全变色。', '加生抽、蚝油、少量老抽，起锅。'], `${WEAK_STOVE}；笔记的「30 秒」以完全变色为准`)),
  beef('L13', '韩式炒牛肉', ['韩式', '甜辣'], '韩式 BBQ 酱 + 韩式辣酱 + 蒜末，香油收尾', [need('korean_bbq'), need('gochujang'), need('minced_garlic'), need('sesame_oil', '少量')],
    pan(12, ['韩式 BBQ 酱、韩式辣酱、蒜末下锅。', '下牛肉分小批快炒到完全变色。', '淋香油收尾。'], WEAK_STOVE), true),
  beef('L14', '泡菜炒牛肉', ['韩式', '酸辣'], '泡菜 + 豆瓣酱炒出汤汁，生抽 + 香油', [need('kimchi', '约 150g'), need('doubanjiang'), need('light_soy'), need('sesame_oil', '少量')],
    pan(15, ['泡菜和豆瓣酱炒出汤汁。', '下牛肉翻炒到完全变色。', '加生抽和香油。']), true),
  beef('L15', '麻辣香锅牛肉', ['麻辣'], '麻辣香锅炒料 + 蒜末炒红油；炒料已够咸，谨慎加盐', [need('mala_paste', '20–30g'), need('minced_garlic'), VEG],
    pan(15, ['炒料和蒜末炒出红油。', '下牛肉和蔬菜翻炒到牛肉完全变色。'], WEAK_STOVE), true),
  {
    id: 'L16', name: '芹菜牛肉末', tier: 'library', protein: 'beef', flavors: ['酱香', '香辣'], spicy: true,
    seasoning: '花椒油、姜、蒜、豆瓣酱，生抽 + 白糖调味，水淀粉勾薄芡', cut: '牛肉末；芹菜切小段', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['celery', 200], need('sichuan_pepper_oil', '少量'), need('ginger'), need('minced_garlic'), need('doubanjiang'), need('light_soy'), need('sugar', '少量'), maybe('corn_starch', '勾薄芡'), RICE],
    methods: pan(18, ['小火把牛肉末炒散。', '加花椒油、姜米、蒜米、豆瓣酱炒香。', '火开到最大，下芹菜或同类脆口蔬菜翻炒。', '加生抽和白糖，水淀粉勾薄芡。', '确认牛肉碎中心 71°C。']),
  },
  {
    id: 'L17', name: '双椒牛肉末', tier: 'library', protein: 'beef', flavors: ['香辣'], spicy: true,
    seasoning: '料酒、姜、蒜、辣椒、生抽、白胡椒、蚝油、白糖、盐', cut: '牛肉末；辣椒切丁', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['green_pepper', 2], maybe('thai_chili', '按口味'), need('cooking_wine'), need('ginger'), need('minced_garlic'), need('light_soy'), need('white_pepper', '少许'), need('oyster_sauce'), need('sugar', '少量'), need('salt', '少量'), RICE],
    methods: pan(18, ['小火把牛肉末炒散。', '加料酒、姜米、蒜米、辣椒、生抽、白胡椒粉、蚝油、白糖、盐。', '火开到最大，炒香收干。', '确认牛肉碎中心 71°C。']),
  },
  // —— 牛肉：涮 ——
  beef('L18', '清汤涮牛肉', ['酸辣'], '万能凉拌汁：生抽 : 陈醋 : 香油 = 2 : 1 : 1，加蒜末和辣椒粉', [need('light_soy'), need('black_vinegar'), need('sesame_oil'), need('minced_garlic'), need('chili_powder', '少量')],
    pot(12, ['水烧开。', '牛肉片分批涮到完全变色。', '调好万能凉拌汁蘸着吃。'])),
  beef('L19', '麻辣涮牛肉', ['麻辣'], '老干妈 + 生抽 + 藤椒油 + 陈醋', [need('laoganma'), need('light_soy'), need('rattan_pepper_oil', '少量'), need('black_vinegar')],
    pot(12, ['水烧开。', '牛肉片分批涮到完全变色。', '调好蘸汁蘸着吃。']), true),
  // —— 牛肉：焖 ——
  beef('L20', '红烧牛肉', ['酱香'], '生抽 + 老抽 + 蚝油 + 豆瓣酱，加水小火焖', [need('light_soy'), need('dark_soy', '少量'), need('oyster_sauce'), need('doubanjiang')],
    pan(35, ['牛肉煎上色。', '加生抽、老抽、蚝油、豆瓣酱和水。', '小火焖 20 分钟。'])),
  beef('L21', '咖喱牛肉', ['咖喱'], '橄榄油炒香咖喱粉和蒜末，加水炖到软烂', [need('olive_oil'), need('curry_powder', '约 2 大勺'), need('minced_garlic')],
    pot(35, ['橄榄油炒香咖喱粉和蒜末。', '下牛肉炒到变色。', '加水炖到软烂收汁。'])),
  // —— 猪肉 ——
  {
    id: 'L22', name: '蒜香排骨', tier: 'library', protein: 'pork', flavors: ['蒜香'], servings: 1,
    seasoning: '大蒜 30g + 胡椒粉 1 小勺 + 盐 1 小勺 + 生抽 2 勺 + 白糖 1 勺 + 蚝油 1 勺 + 玉米淀粉 1 勺', cut: '排骨斩段', leftover: LEFTOVER, safety: SAFE_RIBS,
    ingredients: [['pork_ribs', 500], need('minced_garlic', '约 30g'), need('white_pepper', '1 小勺'), need('salt', '1 小勺'), need('light_soy', '2 勺'), need('sugar', '1 勺'), need('oyster_sauce', '1 勺'), need('corn_starch', '1 勺'), RICE],
    methods: [{ key: 'pan', name: '焯水后煎焖', equipment: ['pot', 'pan'], minutes: 65, fit: '首选；含腌制 30 分钟', steps: ['排骨冷水下锅焯水，捞出洗净沥干。', '大蒜切末，和全部调料拌匀，腌排骨至少 30 分钟；淀粉能锁水，提前一晚冷藏腌更入味。', '中火热油，排骨单层铺入，每面煎 3–4 分钟到金黄。', '转小火加少量水，盖盖焖 5 分钟到熟透。', '开盖收汁。'] }],
  },
  {
    id: 'L23', name: '卤肉饭', tier: 'library', protein: 'pork', flavors: ['酱香'], servings: 4,
    seasoning: '生抽 90g + 老抽 20g + 腐乳 2 块 + 冰糖 25g + 鸡精 1 勺；香料可选', cut: '带皮五花肉切 1cm 条；洋葱切丁；大葱白切马蹄块；蒜切末', leftover: LEFTOVER, safety: '猪肉炖到全熟；卤蛋和卤汁都要及时冷藏。',
    ingredients: [['pork_belly', 1000], ['yellow_onion', 200], ['leek', 50], need('minced_garlic', '30g'), ['egg', 4, 'optional', '若干'], need('light_soy', '90g'), need('dark_soy', '20g'), need('fermented_tofu', '2 块，搅碎'), need('rock_sugar', '25g'), need('chicken_bouillon', '1 勺'), maybe('braise_spices', '八角、桂皮、香叶等'), ['rice', 300, 'optional', '配饭']],
    methods: pot(130, ['鸡蛋凉水下锅，中火煮 5 分钟，凉水泡 10 分钟，剥壳竖切几刀。', '空锅中火下五花肉翻炒 5–6 分钟，到肥肉略透明、底油清亮。', '下洋葱炒到透明，加葱和蒜炒 2–3 分钟。', '锅边淋生抽和老抽翻匀，加足量开水，再加腐乳、冰糖、鸡精和香料，大火煮开。', '小火炖 30 分钟后加入熟鸡蛋（开锅后再放，久炖蛋白会变硬）。', '炖 1 小时后看水位：水和肉应齐平，水多调大火，水少缩短时间。', '挑出香料，最后半小时不时翻底防糊，收到黏稠。', '配白米饭，浇一勺卤汁。']),
  },
  // —— 肝：来自营养清单里的处理方法 ——
  {
    id: 'L24', name: '快煎鸡肝', tier: 'library', protein: 'chicken', flavors: ['家常'], servings: 1,
    seasoning: '盐和黑胡椒按口味', cut: '鸡肝小瓣整瓣下锅，不用切', leftover: LEFTOVER, safety: `鸡肝中心 74°C，不留粉色。${SAFE_LIVER_NOTE}`,
    ingredients: [['chicken_liver', 112], ['milk', 100, 'optional', '泡肝去腥'], RICE],
    methods: pan(30, ['去掉白筋、脂肪和发绿的部分。', '用牛奶泡 15–20 分钟去腥，擦干。', '整瓣下锅，用足够的火煎到全熟。', '确认中心 74°C，不留粉色。'], '笔记写「中心微粉嫩」，这里按全熟做'),
  },
  {
    id: 'L25', name: '快煎牛肝', tier: 'library', protein: 'beef', flavors: ['家常'], servings: 1,
    seasoning: '盐和黑胡椒按口味', cut: '牛肝切薄片', leftover: LEFTOVER, safety: `牛肝煎到全熟，中心不留粉色。${SAFE_LIVER_NOTE}`,
    ingredients: [['beef_liver', 112], ['milk', 100, 'optional', '泡肝去腥'], RICE],
    methods: pan(30, ['去掉白筋、脂肪和发绿的部分，切薄片。', '用牛奶泡 15–20 分钟去腥，擦干。', '用足够的火煎到全熟，别煎太久变老。'], '笔记写「中心微粉嫩」，这里按全熟做'),
  },
  {
    id: 'L26', name: 'Russet 带皮烤土豆', tier: 'library', protein: 'none', flavors: ['家常'], servings: 1,
    seasoning: '无', cut: '整个带皮，不去皮；生重 330–430g 算一份', leftover: LEFTOVER, safety: '烤到叉子能轻松穿透；放凉后及时冷藏。',
    ingredients: [['potato', 380]],
    methods: [
      { key: 'oven', name: '烤箱', equipment: ['oven'], minutes: 60, fit: '首选', steps: ['土豆洗净擦干，不去皮。', '烤箱 200°C 烤 45–60 分钟，到叉子能轻松穿透。', '可一次多烤几个，冷藏后微波复热。'] },
      { key: 'airfryer', name: '空气炸锅', equipment: ['airfryer'], minutes: 55, fit: '时间仅供参考；放不下就分批', airfryerOnlyOk: true, steps: ['土豆洗净擦干，不去皮。', `空气炸锅 190°C 烤约 45 分钟，中途翻面。${AF}`, '到叉子能轻松穿透。'] },
    ],
  },
];

const backup = (d: RecipeDef): RecipeDef => ({ ...d, tier: 'backup' });

/**
 * 常备菜：只用常备的冷冻和常温食材，不靠新鲜蔬菜。
 * 和菜谱库不同，这些菜进自动推荐，让放久的食材有机会用掉；不进 7 天轮换。
 */
export const PANTRY_DEFS: RecipeDef[] = [
  {
    id: 'L30', name: '孜然牛肉碎盖饭', tier: 'backup', protein: 'beef', flavors: ['孜然'],
    seasoning: '孜然粉 2 小勺 + 辣椒粉 1/2 小勺 + 蒜粉 1/2 小勺 + 生抽 1 大勺，老抽几滴上色', cut: '牛肉碎，不需切配', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['frozen_pepper_onion', 150], need('cumin', '2 小勺'), need('chili_powder', '1/2 小勺'), need('garlic_powder', '1/2 小勺'), need('light_soy', '1 大勺'), maybe('dark_soy', '几滴'), RICE],
    methods: pan(15, ['牛肉碎中火炒散至变色，沥掉多余油。', '下冷冻辣椒洋葱，炒到水分收干。', '加孜然粉、辣椒粉、蒜粉炒香，再加生抽和老抽翻匀，这袋腌过就先少放生抽，尝过再加。', '确认牛肉碎中心 71°C，炒到无粉色。', '米饭热透到 74°C，把牛肉盖上去。']),
  },
  {
    id: 'L31', name: '咖喱牛肉碎玉米饭', tier: 'backup', protein: 'beef', flavors: ['咖喱'],
    seasoning: '咖喱粉 1 大勺 + 蒜粉 1/2 小勺 + 洋葱粉 1/2 小勺 + 生抽 1 大勺', cut: '牛肉碎，不需切配；玉米不用解冻，算进这一餐的碳水', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['frozen_corn', 150], need('curry_powder', '1 大勺'), need('garlic_powder', '1/2 小勺'), need('onion_powder', '1/2 小勺'), need('light_soy', '1 大勺'), RICE],
    methods: pan(15, ['牛肉碎中火炒散至变色，沥掉多余油。', '下玉米炒 3 分钟。', '加咖喱粉、蒜粉、洋葱粉炒香，加生抽和 2 勺水翻匀收干。', '确认牛肉碎中心 71°C，炒到无粉色。']),
  },
  {
    id: 'L32', name: '麻辣牛肉碎粉丝', tier: 'backup', protein: 'beef', flavors: ['麻辣'], spicy: true,
    seasoning: '火锅底料半块，已经很咸，不用另外加盐', cut: '牛肉碎，不需切配；粉丝温水泡软', leftover: LEFTOVER, safety: SAFE_BEEF,
    ingredients: [['ground_beef', 454], ['glass_noodle', 4], ['hotpot_base', 0.5]],
    methods: pan(20, ['粉丝用温水泡软约 10 分钟，沥干。', '牛肉碎中火炒散至变色，沥掉多余油。', '下火锅底料炒化，加约 300ml 水煮开。', '下粉丝煮 3 分钟，到汤汁大部分被吸收。', '确认牛肉碎中心 71°C。']),
  },
  {
    id: 'L33', name: '虾仁毛豆蛋炒饭', tier: 'backup', protein: 'shrimp', flavors: ['家常'],
    seasoning: '生抽 1 大勺 + 蒜粉 1/2 小勺 + 白胡椒少许', cut: '虾解冻沥干，大的切段', leftover: LEFTOVER, safety: `${SAFE_SHRIMP}鸡蛋炒至凝固；米饭放凉后尽快冷藏，复热到 74°C。`,
    ingredients: [['frozen_shrimp', 350], ['rice', 160], ['egg', 2], ['edamame', 100], need('light_soy', '1 大勺'), need('garlic_powder', '1/2 小勺'), need('white_pepper', '少许')],
    methods: pan(25, ['煮饭或用已有米饭。', '虾放冷水解冻约 15 分钟，沥干。', '蛋液炒散盛出。', '少油炒虾到不透明、肉质紧实，下毛豆炒 3 分钟。', '下饭和鸡蛋翻炒，加蒜粉、生抽、白胡椒。']),
  },
  backup(chicken('L34', '孜然烧烤空气炸鸡', ['孜然'], '孜然烧烤料按包装用量，生抽 1 大勺；烧烤料通常带盐，先少放', [need('bbq_rub_cumin'), need('light_soy', '1 大勺')],
    [{ key: 'airfryer', name: '空气炸锅', equipment: ['airfryer'], minutes: 20, fit: '首选；时间仅供参考', airfryerOnlyOk: true, steps: ['鸡胸切 2–2.5cm 块，拌孜然烧烤料、生抽和少许油。', `空气炸锅 190°C 约 10 分钟。${AF}`, '翻面再炸 5–7 分钟。', '确认鸡肉中心 74°C。'] }])),
  backup(chicken('L35', '番茄咖喱鸡丁', ['咖喱'], '咖喱粉 1 大勺 + 蒜粉 1/2 小勺 + 洋葱粉 1/2 小勺 + 生抽 1 大勺', [['canned_tomato', 1], need('curry_powder', '1 大勺'), need('garlic_powder', '1/2 小勺'), need('onion_powder', '1/2 小勺'), need('light_soy', '1 大勺')],
    pan(25, ['鸡丁少油煎到变色。', '加咖喱粉、蒜粉、洋葱粉炒香。', '倒入番茄罐头和生抽，小火煮约 10 分钟收汁。', '确认鸡肉中心 74°C。']))),
  {
    id: 'L36', name: '番茄沙丁鱼意面', tier: 'backup', protein: 'fish', flavors: ['番茄', '蒜香'],
    seasoning: '蒜粉 1 小勺 + 黑胡椒，蒜盐尝过再加', cut: '沙丁鱼开罐沥水，掰成块', leftover: LEFTOVER, safety: '沙丁鱼和酱汁一起煮热到 74°C；开罐吃不完放冰箱。',
    ingredients: [['canned_sardine', 2], ['canned_tomato', 1], ['pasta', 160], need('garlic_powder', '1 小勺'), need('black_pepper'), maybe('garlic_salt', '少量'), maybe('chili_powder', '少量')],
    methods: [{ key: 'pan', name: '炒锅/小锅', equipment: ['pan', 'pot'], minutes: 20, fit: '首选', steps: ['另锅煮意面。', '番茄罐头加蒜粉、黑胡椒，小火煮 8 分钟。', '下沙丁鱼轻轻拌开，再煮 3 分钟。', '捞出意面拌匀，尝过再决定加不加蒜盐。'] }],
  },
  {
    id: 'L37', name: '孜然牛肉罐头炒饭', tier: 'backup', protein: 'beef', flavors: ['孜然'],
    seasoning: '孜然粉 1 小勺 + 黑胡椒；罐头本身带盐，生抽尝过再加', cut: '牛肉罐头沥汁，撕小块', leftover: LEFTOVER, safety: '牛肉罐头已熟，炒饭整体热透到 74°C；鸡蛋炒至凝固，米饭放凉后尽快冷藏。',
    ingredients: [['canned_roast_beef', 1], ['rice', 160], ['egg', 2], ['frozen_corn', 100], need('cumin', '1 小勺'), need('black_pepper'), maybe('light_soy', '少量')],
    methods: pan(20, ['煮饭或用已有米饭。', '蛋液炒散盛出。', '少油炒玉米 3 分钟，下牛肉块炒到微焦。', '下饭和鸡蛋翻炒，加孜然粉和黑胡椒，整体炒热。']),
  },
  {
    id: 'L38', name: '番茄豌豆饺子汤', tier: 'backup', protein: 'pork', flavors: ['番茄'], servings: 1,
    seasoning: '生抽 1 小勺 + 白胡椒少许，可加陈醋', cut: '饺子不用解冻，豌豆不用解冻', leftover: LEFTOVER, safety: '饺子按包装时间煮到中心 74°C。',
    ingredients: [['pork_dumpling', 13], ['canned_tomato', 1], ['frozen_sweet_peas', 85], need('light_soy', '1 小勺'), need('white_pepper', '少许'), maybe('black_vinegar', '少量')],
    methods: pot(15, ['番茄罐头加约 400ml 水煮开。', '下饺子，按包装时间煮。', '饺子快好时下豌豆，再煮 2 分钟。', '加生抽、白胡椒，喜欢酸的加陈醋，确认饺子中心 74°C。']),
  },
];
