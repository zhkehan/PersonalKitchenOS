/**
 * 只读的厨房资料：酱汁、腌料和料理速查，来自用户的配方笔记。
 * 这些不参与库存和计划，所以是静态数据：随版本发布，不写进用户的数据库。
 */

export interface Template { protein: string; name: string; formula: string }

export const TEMPLATES: Template[] = [
  { protein: '鸡胸肉', name: '煎鸡胸', formula: '煎两面金黄 → 生抽/蚝油/黑胡椒，或 BBQ、蜂蜜芥末' },
  { protein: '鸡胸肉', name: '辣炒鸡', formula: '蒜末/辣椒类爆香 → 鸡胸 → 生抽 + 蚝油或香油' },
  { protein: '鸡胸肉', name: '酱炒鸡', formula: '黄豆酱/韩式辣酱/豆瓣酱 → 鸡胸 → 快炒收汁' },
  { protein: '鸡胸肉', name: '焖鸡', formula: '煎上色 → 生抽 + 老抽 + 酱料 + 水 → 焖收汁' },
  { protein: '鸡胸肉', name: '凉拌鸡', formula: '煮熟撕条 → 麻酱/口水/芥末汁任选' },
  { protein: '牛肉', name: '快炒牛肉', formula: '分小批快炒到完全变色 → 生抽 + 蚝油 + 老抽' },
  { protein: '牛肉', name: '酱炒牛肉', formula: 'BBQ/泡菜/豆瓣/香锅料 → 牛肉 → 香油收尾' },
  { protein: '牛肉', name: '牛肉末', formula: '小火炒散 → 姜蒜 + 酱/椒 → 火开大炒香' },
  { protein: '牛肉', name: '涮牛肉', formula: '涮到完全变色 → 凉拌汁/麻辣汁' },
  { protein: '牛肉', name: '焖牛肉', formula: '煎上色 → 生抽 + 老抽 + 酱料 + 水 → 焖软' },
];

export interface Sauce { name: string; fit: string; formula: string; method: string }

/** 份量按「勺 / 小勺」计，可按食材量同比例放大。 */
export const HOT_SAUCES: Sauce[] = [
  { name: '鱼香汁', fit: '肉丝、茄子、肘子', formula: '盐 1 小勺 + 糖 2 大勺 + 黑醋 2 大勺 + 料酒 1 勺 + 白胡椒粉少许 + 老抽 0.5 勺 + 芡粉小半勺', method: '起锅烧油，爆香姜蒜末（姜 : 蒜 = 1 : 3），下泡辣椒末、葱末，倒入鱼香汁加热搅匀，出锅撒葱花。' },
  { name: '糖醋汁', fit: '排骨、里脊、脆皮鱼', formula: '白糖 2 勺 + 黑醋 2 勺 + 料酒 2 勺 + 清水 2 勺 + 老抽 0.5 勺 + 盐 0.5 小勺', method: '起锅烧油，爆香姜末，倒入糖醋汁，搅拌收汁并用水淀粉扯芡，淋明油出锅。' },
  { name: '番茄汁', fit: '大虾、松鼠鱼', formula: '番茄膏 2 勺 + 白糖 1 勺 + 盐 1 小勺 + 清水 5 勺', method: '起锅烧油，油热倒入番茄汁，水淀粉勾芡，淋少许明油出锅。' },
  { name: '照烧汁', fit: '鸡腿、鱼排、牛排', formula: '生抽 3 勺 + 蚝油 1 勺 + 老抽 0.5 勺 + 白糖 1 勺 + 蜂蜜 1 勺 + 料酒 2 勺 + 米酒 4 勺 + 盐 1 小勺', method: '起锅烧葱油，爆香姜、蒜、洋葱末，下照烧汁收到粘稠，下食材裹汁，淋少许明油。' },
  { name: '黑椒汁', fit: '牛排、牛仔骨、土豆泥', formula: '生抽 2 勺 + 老抽 0.5 勺 + 料酒 1 勺 + 白糖 0.5 勺 + 盐 0.5 小勺 + 清水 4 勺', method: '小火炒低筋面粉到微黄，加 1 小勺黄油化开，加半碗水搅匀倒出成面捞。另起锅干焙黑胡椒碎，加小半勺葱油，姜葱蒜爆香，倒入调汁烧开，再倒入面捞调稠，加炸干葱碎，淋葱油。' },
  { name: '宫保汁', fit: '鸡丁、虾球、鳕鱼', formula: '盐 1 小勺 + 白糖 2 勺 + 黑醋 2.5 勺 + 料酒 2 勺 + 老抽 0.5 勺 + 清水 4 勺 + 白胡椒粉适量 + 花椒油少许 + 香油少许 + 水淀粉少许', method: '起锅烧油，加少许糊辣油，下葱段、姜片、干辣椒节、干花椒炒香，倒入宫保汁收到粘稠，下料裹汁。' },
];

export const DIPS: { name: string; formula: string; use: string }[] = [
  { name: '万能凉拌', formula: '生抽 : 陈醋 : 香油 = 2 : 1 : 1，加蒜末 + 辣椒粉', use: '拌菜，或蘸涮牛肉' },
  { name: '川味红油', formula: '老干妈 + 生抽 + 陈醋 + 藤椒油 + 香油', use: '淋鸡片，或蘸涮牛肉' },
  { name: '韩式烧烤', formula: '韩式 BBQ 酱 + 韩式辣酱 + 蒜末 + 香油', use: '烤肉蘸酱' },
  { name: '花生麻酱', formula: '花生酱 + 生抽 + 陈醋 + 香油，热水调稀', use: '拌鸡丝' },
  { name: '芥末蜂蜜', formula: '黄芥末酱 + 蜂蜜 + 陈醋 + 橄榄油（1 : 1 : 0.5 : 2）', use: '煎鸡胸收尾，或拌鸡丝' },
];

export interface Marinade {
  name: string;
  trait: string;
  prep: string;
  /** 两列用量对应的肉重。 */
  bases: [string, string];
  rows: { item: string; amounts: [string, string]; role: string }[];
  steps: string[];
  note?: string;
}

export const MARINADES: Marinade[] = [
  {
    name: '鸡胸肉腌制', trait: '去腥嫩肉，不带固定风味，适合炒、焖、蒸、煮', prep: '横着进刀，一块鸡胸分成三片，用厨房纸吸干水分。',
    bases: ['1200g', '1361g（3lb）'],
    rows: [
      { item: '小苏打', amounts: ['7g', '8g'], role: '嫩肉' },
      { item: '洋葱粉', amounts: ['2g', '2g'], role: '去腥增香' },
      { item: '大蒜粉', amounts: ['2g', '2g'], role: '去腥增香' },
      { item: '白胡椒粉', amounts: ['0.5g', '0.5g'], role: '去腥' },
      { item: '盐', amounts: ['5.5g', '6g'], role: '底味' },
      { item: '味精', amounts: ['5g', '6g'], role: '提鲜' },
      { item: '玉米淀粉', amounts: ['90g', '100g'], role: '锁水保嫩（煮的话去掉）' },
      { item: '料酒', amounts: ['15ml', '20ml'], role: '去腥（可用姜蓉代替）' },
      { item: '清水', amounts: ['250ml', '280ml'], role: '帮助腌料渗透' },
    ],
    steps: ['所有调料和清水混合均匀。', '加入鸡胸肉充分揉搓。', '冷藏隔夜腌制。', '按一天的量分袋，冷冻保存。'],
  },
  {
    name: '牛肉腌制', trait: '去腥嫩肉，低钠底味，适合炒、焖、涮', prep: '逆纹切片，厚度 3–5mm，用厨房纸吸干血水。',
    bases: ['1000g', '1120g（2.47lb）'],
    rows: [
      { item: '小苏打', amounts: ['5g', '6g'], role: '嫩肉（减量避免碱味）' },
      { item: '盐', amounts: ['7g', '8g'], role: '底味（减量避免过咸）' },
      { item: '姜蓉', amounts: ['20g', '22g'], role: '去腥' },
      { item: '冷冻葱', amounts: ['20g', '22g'], role: '去腥（可省略）' },
      { item: '清水', amounts: ['600ml', '672ml'], role: '做葱姜水（过滤后约 560ml）' },
    ],
    steps: ['姜蓉、葱、清水混合，过滤得到葱姜水。', '牛肉加小苏打和盐充分揉搓。', '分次少量加入葱姜水，揉到肉吸收不再出水，剩余的水倒掉。', '按一天的量分袋，冷冻保存。'],
  },
];

export const MARINADE_NOTE = '平时的做法：腌好后按一天的量分袋冷冻，解冻后直接烹饪，不用再腌。下面是笔记里的两份配方，腌法可以换。冷冻前平铺冷藏 2–4 小时让腌料渗透，效果更好。';
