// Fix empty m (meaning) and pos fields in words.js
import { readFileSync, writeFileSync } from 'fs';

const MEANINGS = JSON.parse(`{
  "avoid":       {"m":"避免；回避", "pos":"v."},
  "babysit":     {"m":"临时照看小孩", "pos":"v."},
  "bare":        {"m":"光秃秃的；裸露的", "pos":"adj."},
  "bark":        {"m":"吠叫", "pos":"v."},
  "bear":        {"m":"忍受；熊", "pos":"v./n."},
  "beat":        {"m":"打；打败", "pos":"v."},
  "become":      {"m":"变成；成为", "pos":"v."},
  "begin":       {"m":"开始", "pos":"v."},
  "behave":      {"m":"行为；表现", "pos":"v."},
  "believe":     {"m":"相信", "pos":"v."},
  "belong":      {"m":"属于", "pos":"v."},
  "bend":        {"m":"使弯曲", "pos":"v."},
  "bite":        {"m":"咬", "pos":"v."},
  "bleed":       {"m":"流血", "pos":"v."},
  "buffet n":    {"m":"自助餐", "pos":"n."},
  "check":       {"m":"检查；核对", "pos":"v./n."},
  "content n":   {"m":"内容", "pos":"n."},
  "contract n":  {"m":"合同；契约", "pos":"n."},
  "decrease n":  {"m":"减少；降低", "pos":"n."},
  "desert n":    {"m":"沙漠", "pos":"n."},
  "discount n":  {"m":"折扣", "pos":"n."},
  "document n":  {"m":"文件；文档", "pos":"n."},
  "increase n":  {"m":"增加；增长", "pos":"n."},
  "object n":    {"m":"物体；目标", "pos":"n."},
  "present n/adj":{"m":"礼物；现在的；出席的", "pos":"n./adj."},
  "progress n":  {"m":"进步；进展", "pos":"n."},
  "project n":   {"m":"项目；计划", "pos":"n."},
  "record n":    {"m":"记录；唱片", "pos":"n."},
  "separate adj":{"m":"分开的；单独的", "pos":"adj."},
  "share":       {"m":"分享；共享", "pos":"v."},
  "shave":       {"m":"剃须；刮脸", "pos":"v."},
  "shine":       {"m":"发光；照耀", "pos":"v."},
  "shoot":       {"m":"射击；拍摄", "pos":"v."},
  "should":      {"m":"应该", "pos":"modal v."},
  "shout":       {"m":"呼喊；大声说", "pos":"v."},
  "show":        {"m":"展示；给..看", "pos":"v."},
  "shut":        {"m":"关闭；关上", "pos":"v."},
  "sign":        {"m":"标志；签名", "pos":"n./v."},
  "sink":        {"m":"下沉；沉没", "pos":"v."},
  "sit":         {"m":"坐", "pos":"v."},
  "ski":         {"m":"滑雪", "pos":"v."},
  "slice":       {"m":"薄片；切片", "pos":"n./v."},
  "slip":        {"m":"滑倒；溜走", "pos":"v."},
  "smell":       {"m":"闻；气味", "pos":"v./n."},
  "smile":       {"m":"微笑", "pos":"v./n."},
  "smoke":       {"m":"烟；吸烟", "pos":"n./v."},
  "sound":       {"m":"声音；听起来", "pos":"n./v."},
  "specialise":  {"m":"专门研究；专攻", "pos":"v."},
  "spell":       {"m":"拼写", "pos":"v."},
  "spend":       {"m":"花费；度过", "pos":"v."},
  "spill":       {"m":"洒出；溢出", "pos":"v."},
  "split":       {"m":"分开；分裂", "pos":"v."},
  "spoil":       {"m":"破坏；宠坏", "pos":"v."},
  "spot":        {"m":"斑点；地点", "pos":"n."},
  "squash":      {"m":"壁球；挤压", "pos":"n./v."},
  "stain":       {"m":"污渍；玷污", "pos":"n./v."},
  "stand":       {"m":"站立；忍受", "pos":"v."},
  "start":       {"m":"开始；启动", "pos":"v./n."},
  "stay":        {"m":"停留；保持", "pos":"v."},
  "steal":       {"m":"偷；窃取", "pos":"v."},
  "stick":       {"m":"棍子；粘贴", "pos":"n./v."},
  "sting":       {"m":"叮；刺痛", "pos":"v./n."},
  "stir":        {"m":"搅拌；搅动", "pos":"v."},
  "stop":        {"m":"停止；阻止", "pos":"v."},
  "stress":      {"m":"压力；强调", "pos":"n./v."},
  "stretch":     {"m":"伸展；延伸", "pos":"v."},
  "strike":      {"m":"打；罢工", "pos":"v./n."},
  "subtract":    {"m":"减去；扣除", "pos":"v."},
  "succeed":     {"m":"成功；做成", "pos":"v."},
  "suffer":      {"m":"受苦；遭受", "pos":"v."},
  "suggest":     {"m":"建议；暗示", "pos":"v."},
  "supply":      {"m":"提供；供应", "pos":"v./n."},
  "support":     {"m":"支持；支撑", "pos":"v./n."},
  "suppose":     {"m":"假设；认为", "pos":"v."},
  "surf":        {"m":"冲浪；上网", "pos":"v."},
  "surround":    {"m":"围绕；环绕", "pos":"v."},
  "sweep":       {"m":"打扫；扫过", "pos":"v."},
  "take":        {"m":"拿；带走", "pos":"v."},
  "talk":        {"m":"谈话；交谈", "pos":"v./n."},
  "teach":       {"m":"教；教授", "pos":"v."},
  "tear":        {"m":"撕；眼泪", "pos":"v./n."},
  "thank":       {"m":"感谢", "pos":"v."},
  "think":       {"m":"思考；认为", "pos":"v."},
  "throw":       {"m":"扔；投掷", "pos":"v."},
  "tick":        {"m":"勾号；打勾", "pos":"n./v."},
  "touch":       {"m":"触摸；接触", "pos":"v."},
  "transfer":    {"m":"转移；转学", "pos":"v."},
  "translate":   {"m":"翻译", "pos":"v."},
  "transport n": {"m":"交通；运输", "pos":"n."},
  "turn":        {"m":"转动；轮到", "pos":"v./n."},
  "type":        {"m":"类型；打字", "pos":"n./v."},
  "underline":   {"m":"在..下划线；强调", "pos":"v."},
  "understand":  {"m":"理解；明白", "pos":"v."},
  "undress":     {"m":"脱衣服", "pos":"v."},
  "unpack":      {"m":"打开行李；取出", "pos":"v."},
  "upset adj":   {"m":"心烦的；难过的", "pos":"adj."},
  "use":         {"m":"使用；利用", "pos":"v./n."},
  "wait":        {"m":"等待；等候", "pos":"v."},
  "wake":        {"m":"醒来；叫醒", "pos":"v."},
  "warn":        {"m":"警告；提醒", "pos":"v."},
  "watch":       {"m":"观看；手表", "pos":"v./n."},
  "wear":        {"m":"穿；戴", "pos":"v."},
  "weigh":       {"m":"称重；重量为", "pos":"v."},
  "win":         {"m":"赢；获胜", "pos":"v."},
  "wind n":      {"m":"风", "pos":"n."},
  "windsurf":    {"m":"风帆冲浪", "pos":"v."},
  "wish":        {"m":"希望；祝愿", "pos":"v./n."},
  "wonder":      {"m":"想知道；奇迹", "pos":"v./n."},
  "would":       {"m":"将会；愿意", "pos":"modal v."},
  "wrap":        {"m":"包裹；缠绕", "pos":"v."}
}`);

const file = 'js/words.js';
let content = readFileSync(file, 'utf-8');
let count = 0;

for (const [word, fix] of Object.entries(MEANINGS)) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Replace m:""
  const oldM = new RegExp(`(\\{w:"${escaped}",[^}]*?)m:""`);
  if (content.match(oldM)) {
    content = content.replace(oldM, `$1m:"${fix.m}"`);
    count++;
  }

  // Replace pos:""
  const oldPos = new RegExp(`(\\{w:"${escaped}",[^}]*?)pos:""`);
  if (content.match(oldPos)) {
    content = content.replace(oldPos, `$1pos:"${fix.pos}"`);
  }
}

writeFileSync(file, content, 'utf-8');
console.log(`Fixed ${count} words in ${file}`);

// Verify
import('./js/words.js').then(mod => {
  const empty = mod.WORDS_PET.filter(w => !w.m || w.m.length === 0);
  console.log(`Words still empty after fix: ${empty.length}`);
  if (empty.length > 0) console.log(empty.map(w=>w.w).join(', '));
});
