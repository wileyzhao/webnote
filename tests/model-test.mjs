/**
 * 数据层单元测试（Node 环境，无需浏览器）
 * 运行： node tests/model-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'model.js'), 'utf8');
new Function(code)();

const M = globalThis.WN.model;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  ✅ ' + name);
  } else {
    failed += 1;
    failures.push(name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
    console.log('  ❌ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

// ---------------------------------------------------------------- URL
section('URL 规范化');
check('补全尾斜杠', M.normalizeUrl('https://example.com') === 'https://example.com/');
check('保留查询串', M.normalizeUrl('https://a.com/x?b=1') === 'https://a.com/x?b=1');
check('非法 URL 原样返回', M.normalizeUrl('not a url') === 'not a url');
check('空值返回空串', M.normalizeUrl('') === '');

// ---------------------------------------------------------------- 基本流程
section('标注增删改');
let state = M.emptyState();
check('初始无页面', Object.keys(state.pages).length === 0);

M.mutate(state, 'addAnnotation', {
  url: 'https://example.com/post/1',
  title: '一篇文章',
  annotation: { start: 10, end: 22, quote: 'hello world', color: 'yellow', note: '我的批注' }
});
const page1 = state.pages['https://example.com/post/1'];
check('页面被自动创建', !!page1);
check('标注已写入', page1 && page1.annotations.length === 1);
check('标注内容正确', page1 && page1.annotations[0].quote === 'hello world');
check('笔记已保存', page1 && page1.annotations[0].note === '我的批注');

const dup = M.mutate(state, 'addAnnotation', {
  url: 'https://example.com/post/1',
  annotation: { start: 10, end: 22, quote: 'hello world', color: 'blue', note: '' }
});
check('相同位置重复标注被合并', dup.merged === true);
check('合并后颜色更新', page1.annotations[0].color === 'blue');
check('合并后仍只有一条', page1.annotations.length === 1);

const annId = page1.annotations[0].id;
M.mutate(state, 'updateAnnotation', {
  url: 'https://example.com/post/1',
  id: annId,
  patch: { note: '改过的批注', color: 'green' }
});
check('批注可更新', page1.annotations[0].note === '改过的批注');
check('颜色可更新', page1.annotations[0].color === 'green');

let threw = false;
try {
  M.mutate(state, 'updateAnnotation', { url: 'https://example.com/post/1', id: 'nope', patch: {} });
} catch (e) {
  threw = true;
}
check('更新不存在的标注会报错', threw);

M.mutate(state, 'deleteAnnotation', { url: 'https://example.com/post/1', id: annId });
check('标注可删除', page1.annotations.length === 0);

// 空 quote 拒绝
threw = false;
try {
  M.mutate(state, 'addAnnotation', {
    url: 'https://example.com/post/1',
    annotation: { start: 0, end: 0, quote: '   ', color: 'yellow' }
  });
} catch (e) {
  threw = true;
}
check('纯空白 quote 被拒绝', threw);

// ---------------------------------------------------------------- 标签
section('标签树');
const tagA = M.mutate(state, 'addTag', { name: '技术' }).tag;
const tagB = M.mutate(state, 'addTag', { name: '前端', parentId: tagA.id }).tag;
const tagC = M.mutate(state, 'addTag', { name: '后端', parentId: tagA.id }).tag;
const tagD = M.mutate(state, 'addTag', { name: 'React', parentId: tagB.id }).tag;

check('标签创建成功', state.tags.length === 4);
check('父子关系正确', M.getTag(state.tags, tagB.id).parentId === tagA.id);
check('子标签顺序递增', M.getTag(state.tags, tagC.id).order > M.getTag(state.tags, tagB.id).order);
check('子树包含自身与后代', M.tagSubtreeIds(state.tags, tagA.id).sort().join(',') === [tagA.id, tagB.id, tagC.id, tagD.id].sort().join(','));
check('路径正确', M.tagPath(state.tags, tagD.id).map((t) => t.name).join('/') === '技术/前端/React');

let dupThrew = false;
try {
  M.mutate(state, 'addTag', { name: '技术' });
} catch (e) {
  dupThrew = true;
}
check('同级重名标签被拒绝', dupThrew);

let nestedOk = true;
try {
  M.mutate(state, 'addTag', { name: '技术', parentId: tagA.id });
} catch (e) {
  nestedOk = false;
}
check('不同层级可以同名', nestedOk);
state.tags = state.tags.filter((t) => t.id !== state.tags[state.tags.length - 1].id);

M.mutate(state, 'setPageTags', { url: 'https://example.com/post/1', tagIds: [tagD.id, tagC.id] });
check('页面打标签成功', page1.tagIds.length === 2);
check('重复标签被去重', (M.mutate(state, 'setPageTags', { url: 'https://example.com/post/1', tagIds: [tagD.id, tagD.id] }), page1.tagIds.length === 1));
check('无效标签被过滤', (M.mutate(state, 'setPageTags', { url: 'https://example.com/post/1', tagIds: [tagD.id, 'ghost'] }), page1.tagIds.length === 1));

// 改名 + 改色 + 移动
M.mutate(state, 'updateTag', { id: tagD.id, name: 'React 18', color: 'pink' });
check('标签改名生效', M.getTag(state.tags, tagD.id).name === 'React 18');
check('标签改色生效', M.getTag(state.tags, tagD.id).color === 'pink');

M.mutate(state, 'updateTag', { id: tagD.id, parentId: tagC.id });
check('标签可移动', M.getTag(state.tags, tagD.id).parentId === tagC.id);

threw = false;
try {
  M.mutate(state, 'updateTag', { id: tagA.id, parentId: tagD.id });
} catch (e) {
  threw = true;
}
check('阻止把父标签移进自己的子孙', threw);

M.mutate(state, 'updateTag', { id: tagD.id, parentId: tagB.id });
check('标签可再次移动回来', M.getTag(state.tags, tagD.id).parentId === tagB.id);

// 删除中间节点：子标签级联删除，页面标签引用被清理
M.mutate(state, 'deleteTag', { id: tagC.id });
check('删除标签后子树移除', state.tags.length === 3);
check('删除后不残留引用', page1.tagIds.every((id) => !!M.getTag(state.tags, id)));

// ---------------------------------------------------------------- 脏数据
section('脏数据容错');
const dirty = M.normalizeState({
  pages: {
    'https://x.com/a': { url: 'https://x.com/a', annotations: [{ quote: 'ok' }, { quote: '' }, null] },
    'https://x.com/b': null
  },
  tags: [
    { id: 't1', name: '父' },
    { id: 't2', name: '子', parentId: 't1' },
    { id: 't3', name: '孤儿', parentId: 'not-exist' },
    { id: 't1', name: '重复 ID' },
    { name: '' }
  ],
  settings: { defaultColor: 'rainbow', theme: 'neon', enabled: 'yes' }
});
check('空页面被剔除', Object.keys(dirty.pages).length === 1);
check('空标注被剔除', dirty.pages['https://x.com/a'].annotations.length === 1);
check('重复 ID 标签被去重', dirty.tags.filter((t) => t.id === 't1').length === 1);
check('无名称标签被丢弃', dirty.tags.length === 3);
check('孤儿标签挂到根', M.getTag(dirty.tags, 't3').parentId === null);
check('非法颜色回退', dirty.settings.defaultColor === 'yellow');
check('非法主题回退', dirty.settings.theme === 'auto');
check('enabled 非布尔值修正', dirty.settings.enabled === true);

// 循环引用防护
const cyclic = M.normalizeState({
  pages: {},
  tags: [
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' }
  ]
});
check('循环父子关系被打断', cyclic.tags.some((t) => t.parentId === null));

// ---------------------------------------------------------------- 合并导入
section('导入合并');
const imported = {
  pages: {
    'https://example.com/post/1': {
      url: 'https://example.com/post/1',
      title: '一篇文章',
      annotations: [{ id: 'imported-1', quote: '另一段文字', start: 100, end: 105, color: 'purple', note: '' }]
    },
    'https://example.com/post/2': {
      url: 'https://example.com/post/2',
      title: '新文章',
      annotations: [{ quote: '新标注', start: 0, end: 3, color: 'yellow', note: '' }]
    }
  },
  tags: [{ id: 'x1', name: '导入的标签' }]
};
const mergeResult = M.mergeState(state, imported);
check('合并统计页面数', mergeResult.pages === 2);
check('新页面被加入', !!state.pages['https://example.com/post/2']);
check('已有页面追加标注', state.pages['https://example.com/post/1'].annotations.length >= 1);
check('新标签被加入', state.tags.some((t) => t.name === '导入的标签'));

// 重复导入不产生重复数据
const before = state.pages['https://example.com/post/1'].annotations.length;
M.mergeState(state, imported);
check('重复导入不重复添加标注', state.pages['https://example.com/post/1'].annotations.length === before);

// ---------------------------------------------------------------- 设置
section('设置');
M.mutate(state, 'updateSettings', { patch: { enabled: false, disabledHosts: ['a.com'] } });
check('设置可更新', state.settings.enabled === false);
check('站点黑名单生效', state.settings.disabledHosts.indexOf('a.com') >= 0);

M.mutate(state, 'clearAll', {});
check('清空后无页面', Object.keys(state.pages).length === 0);
check('清空后无标签', state.tags.length === 0);

// ---------------------------------------------------------------- 结果
console.log('\n' + '='.repeat(46));
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
if (failed) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
