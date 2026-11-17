# dsh-wardrobe · 衣柜

给 DSH 角色收衣服的独立插件。一件衣服就是四样东西，没有别的：

| 字段 | 用途 |
|---|---|
| `title` | 标题 |
| `description` | 给模型看的文字描述——它怎么理解这件衣服 |
| `prompt` | 给绘图模型的提示词 |
| `image` | 一张图 |

内部多一个 `id` 用来引用、`createdAt` / `updatedAt` 用来排序。**没有标签、没有分类、没有穿搭、没有评分、没有生图入口** —— 要加东西先单独说，不进默认契约。

## 为什么单独做成插件

衣柜不是记忆。把衣服塞进人格卡或记忆库，等于让它进每一轮提示词上下文、被摘要器压缩、在会话日志和归档里各留一份副本。做成插件之后，模型真需要某件衣服时按名字去取，字节根本不经过上下文。

顺带也让宿主干净：数据全归插件自己管，依赖只有 Node 内置模块。

## 安装

```bash
dsh plugin --profile web add link:/path/to/dsh-wardrobe
systemctl --user restart dsh-web
```

DSH 从 profile 的 `package.json` 里读插件。这个插件不需要配置，数据库和图片目录默认都在 `~/.dsh/wardrobe/`。

需要 Node 24+（要 `node:sqlite`）。

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `wardrobe_list_all` | — | 列出全部 |
| `wardrobe_list_type` | `type` | 按类型列 |
| `wardrobe_list_body` | `body` | 按穿着部位列 |
| `wardrobe_get_cloth` | `id` 或 `title` | 单件完整记录 |
| `wardrobe_wear` | `id` 列表 | 穿上 |
| `wardrobe_unwear` | `id` 列表 | 脱下 |

穿上不画图。它只记录当前状态，等后面要出图时由生成侧通过 `her_garment.json` 读取——那是衣柜交给绘图环节的东西。

## 存在哪

```
~/.dsh/wardrobe/wardrobe.sqlite          一条一行，0600
~/.dsh/wardrobe/images/<24位>.<ext>      图片文件，0600
```

库里只存文件名，二进制不进 SQLite。图片扩展名按文件头魔数判（PNG / JPG / WEBP / GIF），不信上传时给的 `content-type`；文件名白名单只允许 `<24位字母数字>.<ext>`，挡住路径穿越。

## 设置页

DSH → 设置 → 「衣柜」。右上角「添一件」，四格填完保存；卡片上能编辑、删掉。图片上传后立刻能预览。

接口（同源，DSH 会话鉴权）：

```
GET  /dsh-wardrobe/api            → { ok, pluginVersion, items: […] }
POST /dsh-wardrobe/api            → { action: create|update|delete, … }
POST /dsh-wardrobe/image          → 裸字节上传，返回 { image: 文件名 }
GET  /dsh-wardrobe/image?name=…   → 图片字节
```

## 测试

```bash
node --test test/wardrobe.test.js
```

五条：字段契约、必填与长度、图片魔数与路径穿越、接口鉴权与增改删、图片往返。

## 设计取舍

- 零 npm 依赖，只用 `node:sqlite` / `node:fs` / `node:crypto`。
- 四字段是硬约束不是文档说明：界面和接口都会拒掉范围外的东西。
- 图片放独立文件，所以备份就是 `tar` 一个目录，数据库本身一直很小。

## Star History

<a href="https://www.star-history.com/?type=date&repos=iiishop%2Fdsh-wardrobe">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=iiishop/dsh-wardrobe&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=iiishop/dsh-wardrobe&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=iiishop/dsh-wardrobe&type=date&legend=top-left" />
 </picture>
</a>
