// 第四轮增量：把「阿萨姆奶茶抑制食欲」整合成一条结论。
// 这条值得单独提，因为它和「增重」这个核心目标直接冲突。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HEALTH = resolve('..\\health');
const KNOW = join(HEALTH, 'knowledge.json');
const know = JSON.parse(readFileSync(KNOW, 'utf8'));

const sec = know.sections.find((s) => s.key === 'diet');
if (!sec) {
  console.error('找不到「吃什么」分类');
  process.exit(1);
}

const TITLE = '别用阿萨姆奶茶顶饭：它会压掉你的食欲，而你正在增重';
if (sec.items.some((x) => x.title === TITLE)) {
  console.log('已存在，跳过');
  process.exit(0);
}

sec.items.push({
  id: 'upd4-milk-tea-appetite',
  bucket: '避免',
  title: TITLE,
  body: [
    '你 2026-10-09 自己说的：「我每次喝了统一阿萨姆奶茶都不想吃东西。」',
    '',
    '对大多数人来说这只是小事，但**对你是个明确的坑**——你的核心目标是**增重**（BMI 16.65，过轻），而含糖奶茶：',
    '',
    '- **压掉食欲** → 少吃的正餐热量，远大于奶茶本身带来的热量（一瓶约 250-350 kcal，但你可能因此少吃 500+ kcal 的一顿饭）',
    '- **糖 + 脂肪一起进来** → 对尿酸和胆囊都不友好（你尿酸 486、有慢性胆囊炎）',
    '',
    '**做法**：',
    '1. **不要饭前喝**，也不要拿它当"垫一下"。要喝就放在**正餐之后**，此时压制食欲已无影响。',
    '2. 真要喝甜饮，改成**饭后半瓶**，剩下的留到第二天；或直接换**零乳糖牛奶 / 自制增重奶昔**（这也是你增重需要的蛋白来源）。',
    '3. 如果某天已经喝了奶茶、吃不下正餐，**当天就把这顿饭拆成两三次小份**补回去，别让当天总热量掉下来。',
  ].join('\n'),
  why: [
    '依据：',
    '① 你 2026-10-09 自述喝统一阿萨姆奶茶后不想吃东西（`LIFESTYLE.md` / 事实记录）；',
    '② 你的目标与现状是增重：BMI 约 16.65（过轻），每日需要热量盈余（`goal` 类事实与 `KNOWLEDGE.md` 增重章节）；',
    '③ 同档案已有结论要求「含糖奶茶降到每周 ≤1 瓶」——本条是在此基础上补充**饮用时机**。',
  ].join('\n'),
  basedOn: ['2026-10-09 自述：喝阿萨姆奶茶后不想吃东西', 'BMI 16.65 过轻，目标增重', '尿酸 486 μmol/L', '慢性胆囊炎'],
  sources: [],
  grade: '经验',
  confidence: 'high',
  note: '依据为用户自述 + 个人目标，不涉医学判断',
  origin: '增量更新 2026-10-09',
  generatedAt: new Date().toISOString(),
});

know.updatedAt = new Date().toISOString();
writeFileSync(KNOW, JSON.stringify(know, null, 1), 'utf8');
const total = know.sections.reduce((a, s) => a + s.items.length, 0);
console.log(`+ 避免  ${TITLE}`);
console.log(`结论总数 ${total}`);
