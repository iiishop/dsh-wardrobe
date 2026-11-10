# dsh-wardrobe · 衣柜

给 DSH 角色收衣服的独立插件。一件衣服就是四样东西：

| 字段 | 用途 |
|---|---|
| `title` | 标题 |
| `description` | 给 AI 看的文字描述——她怎么理解这件衣服 |
| `prompt` | 给绘图模型的提示词（Qwen 那套能吃的） |
| `image` | 一张图 |

内部多一个 `id` 用来引用、`createdAt/updatedAt` 用来排序。**没有别的字段**：没有标签、没有分类、没有穿搭、没有评分、没有生图入口。要加东西先单独说。

## 存在哪

```
~/.dsh/wardrobe/wardrobe.sqlite      SQLite，一条一行，0600
~/.dsh/wardrobe/images/<24位>.<ext>  图片文件，0600
```

库里只存文件名，二进制不进数据库。图片扩展名按文件头魔数判（PNG/JPG/WEBP/GIF），不信上传时给的 content-type；文件名白名单只允许 `<24位字母数字>.<ext>`，挡路径穿越。

## 用

DSH → 设置 → 「衣柜」。右上角「添一件」，四格填完保存；卡片上能编辑、删掉。图片上传后立刻能预览。

接口（同源，DSH 会话鉴权）：

```
GET  /dsh-wardrobe/api            → { ok, pluginVersion, items:[…] }
POST /dsh-wardrobe/api            → { action: create|update|delete, … }
POST /dsh-wardrobe/image          → 裸字节上传，返回 { image: 文件名 }
GET  /dsh-wardrobe/image?name=…   → 图片字节
```

## 测试

```bash
node --test test/wardrobe.test.js   # 5 条：字段契约、必填/长度、图片魔数与路径、接口鉴权与增改删、图片往返
```

零 npm 依赖，只用 Node 24+ 的 `node:sqlite`。
