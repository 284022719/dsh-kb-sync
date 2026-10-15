# 拉取请求 / Pull request

## 这次改了什么

<!-- 一句话说清"为什么"，以及用户能看到的变化 -->

## 影响面

- [ ] 只改文档 / 注释
- [ ] 改宿主半部（`lib/*.js`，除 `client.js`）
- [ ] 改客户端半部（`lib/client.js`）或控制页（`lib/page.js`）
- [ ] 改管线脚本（`tools/pipeline/*.mjs`）或插件⇄脚本契约
- [ ] 改包元数据 / 发布配置（`package.json`、`cordis.patch.yml`）
- [ ] 改测试

## 自查（对应 CONTRIBUTING 的硬规矩）

- [ ] `npm run preflight` 通过（用例全绿 + 语法 + 类型 + 包内容 + 能力披露）
- [ ] 加了路由 → `README.md` 路由表与 `lib/index.js` 头部清单都更新了
- [ ] 加了用例 → 两份 README 里的用例数都改了
- [ ] 改了界面文案 → 没有内部术语（段 1/段 2/整链/dry-run/落盘），英文页无残留中文
      （内联 `<style>`/`<script>` 注释也是 ASCII），`zh`/`en` 字典键集合仍一致
- [ ] 改了传给管线脚本的 `--flag` → 该标志确实存在于脚本源码里（`docs/PIPELINE-CONTRACT.md`）
- [ ] 提交里**没有** `data/` 下的任何内容（个人语料、健康事实、财务候选、凭据）
- [ ] 能力面有变化 → `docs/CAPABILITY-DISCLOSURE.md` 与 `README.md` 的「它做什么 / 不做什么」同步了

## 实测读数（可选但很加分）

<!-- 真机跑过的证据：命令 + 字面输出 + 结论。没有的话写"未在真机验证" -->
