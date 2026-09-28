# gpt-image-2 图片生成与编辑接口

本文档描述当前 Sub2API 项目中 `gpt-image-2` 的图片生成和图片编辑接口，包括 JSON、`multipart/form-data`、非流式响应和流式 SSE 响应。

> 本文以当前仓库实现为准。部分参数只由 Sub2API 解析或透传，具体枚举值和取值范围最终仍可能由所选上游账号校验。

## 1. 接口概览

| 功能 | 方法 | 标准路径 | 无 `/v1` 别名 |
|---|---|---|---|
| 图片生成 | `POST` | `/v1/images/generations` | `/images/generations` |
| 图片编辑 | `POST` | `/v1/images/edits` | `/images/edits` |

所有请求都需要 API Key：

```http
Authorization: Bearer sk-your-key
```

JSON 请求使用：

```http
Content-Type: application/json
```

文件上传请求使用：

```http
Content-Type: multipart/form-data; boundary=...
```

调用前还需要满足以下条件：

- API Key 有效，且所属分组已开启图片生成权限。
- 分组中存在支持 `gpt-image-2` 和对应图片能力的可用账号。
- 默认网关请求体上限为 256 MiB，可通过配置修改。
- multipart 解析时每个上传文件最多读取 20 MiB。

## 2. 请求参数

### 2.1 通用参数

以下字段可用于图片生成和图片编辑。图片生成通常使用 JSON；图片编辑既支持 JSON 图片 URL，也支持 multipart 文件上传。

| 字段 | JSON 类型 | multipart 类型 | 必填 | 默认值 | 当前项目行为 |
|---|---|---|---|---|---|
| `model` | string | text | 否 | `gpt-image-2` | 本文档只讨论 `gpt-image-2`，建议显式传入 |
| `prompt` | string | text | 是 | 无 | OAuth 转换链路明确要求非空；API Key 链路由上游校验 |
| `n` | integer | integer text | 否 | `1` | 必须大于 `0`；项目未限制最大值 |
| `size` | string | text | 否 | 上游默认值 | 原样传递；项目不做尺寸枚举校验 |
| `quality` | string | text | 否 | 上游默认值 | 原样传递，如 `auto`、`low`、`medium`、`high` |
| `background` | string | text | 否 | 上游默认值 | 原样传递，如 `auto`、`opaque`、`transparent` |
| `output_format` | string | text | 否 | 上游默认值 | 图片编码格式，如 `png`、`jpeg`、`webp` |
| `output_compression` | integer | integer text | 否 | 上游默认值 | 项目只校验为整数，不校验范围 |
| `response_format` | string | text | 否 | `b64_json` | 推荐 `b64_json` 或 `url` |
| `moderation` | string | text | 否 | 上游默认值 | 原样传递 |
| `style` | string | text | 否 | 上游默认值 | 原样传递；是否被 `gpt-image-2` 上游接受由上游决定 |
| `stream` | boolean | boolean text | 否 | `false` | JSON 必须是布尔值；multipart 使用 `true`/`false` |
| `partial_images` | integer | integer text | 否 | 上游默认值 | 控制流式预览图；项目只校验为整数 |
| `input_fidelity` | string | text | 否 | 上游默认值 | 主要用于图片编辑；OAuth 差异见第 7 节 |

参数说明：

- `output_format` 决定图片二进制编码，例如 PNG 或 WebP。
- `response_format` 决定非流式结果放在 `data[].b64_json` 还是 `data[].url` 中。
- 当前项目只对 `n`、`stream`、`output_compression` 和 `partial_images` 做基本类型校验。
- `size` 会用于计费尺寸归类，但不会因为是不常见尺寸而在本地拒绝。

### 2.2 图片编辑专用参数

#### JSON 图片 URL

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `images` | array | 是 | 至少包含一个输入图片对象 |
| `images[].image_url` | string | 是 | HTTP(S) URL 或上游可接受的图片 URL |
| `mask` | object | 否 | 遮罩对象 |
| `mask.image_url` | string | 否 | 遮罩图片 URL |

JSON 编辑不支持以下字段：

```text
images[].file_id
mask.file_id
```

#### multipart 文件上传

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | file | 是 | 输入图片，可重复传多个同名字段 |
| `image[n]` | file | 否 | 多图的另一种字段名形式，例如 `image[0]` |
| `mask` | file | 否 | 遮罩图片 |

## 3. 非流式图片生成

### 3.1 请求

```bash
curl 'https://your-domain.example/v1/images/generations' \
  -H 'Authorization: Bearer sk-your-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一座雨夜中的未来城市，街道有霓虹灯倒影，电影摄影风格",
    "n": 1,
    "size": "1024x1024",
    "quality": "high",
    "background": "opaque",
    "output_format": "png",
    "output_compression": 90,
    "moderation": "auto",
    "response_format": "b64_json",
    "stream": false
  }'
```

### 3.2 `b64_json` 响应

```json
{
  "created": 1784426400,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA...",
      "revised_prompt": "A cinematic futuristic city at night..."
    }
  ],
  "background": "opaque",
  "output_format": "png",
  "quality": "high",
  "size": "1024x1024",
  "model": "gpt-image-2",
  "usage": {
    "input_tokens": 46,
    "output_tokens": 2459,
    "output_tokens_details": {
      "image_tokens": 2459
    },
    "images": 1
  }
}
```

### 3.3 `url` 响应

请求中设置：

```json
{
  "response_format": "url",
  "stream": false
}
```

响应示例：

```json
{
  "created": 1784426400,
  "data": [
    {
      "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "revised_prompt": "A cinematic futuristic city at night..."
    }
  ],
  "output_format": "png",
  "model": "gpt-image-2"
}
```

OAuth 转换链路中的 `url` 是 `data:` URL。API Key 透传链路则返回上游原始 `url`，可能是 HTTP(S) URL，也可能是其他上游格式。

### 3.4 非流式响应字段

| 字段 | 类型 | 是否固定出现 | 说明 |
|---|---|---|---|
| `created` | integer | 是 | Unix 秒级时间戳 |
| `data` | array | 是 | 生成结果数组 |
| `data[].b64_json` | string | 条件出现 | `response_format` 不是 `url` 时返回 Base64 图片 |
| `data[].url` | string | 条件出现 | `response_format` 为 `url` 时返回 |
| `data[].revised_prompt` | string | 否 | 上游返回改写后的提示词时出现 |
| `background` | string | 否 | 实际输出背景模式 |
| `output_format` | string | 否 | 实际输出图片格式 |
| `quality` | string | 否 | 实际输出质量 |
| `size` | string | 否 | 实际输出尺寸 |
| `model` | string | 否 | 实际图片模型；OAuth 链路会至少回填请求模型 |
| `usage` | object | 否 | 图片工具用量信息 |
| `usage.input_tokens` | integer | 否 | 输入 Token 数量 |
| `usage.output_tokens` | integer | 否 | 输出 Token 数量 |
| `usage.output_tokens_details.image_tokens` | integer | 否 | 图片输出 Token 数量 |
| `usage.images` | integer | 否 | 图片数量 |

## 4. 流式图片生成

### 4.1 请求

```bash
curl -N 'https://your-domain.example/v1/images/generations' \
  -H 'Authorization: Bearer sk-your-key' \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一座雨夜中的未来城市，街道有霓虹灯倒影",
    "n": 1,
    "size": "1024x1024",
    "quality": "high",
    "output_format": "png",
    "response_format": "b64_json",
    "partial_images": 2,
    "stream": true
  }'
```

OAuth 标准化链路的响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 4.2 OAuth 标准化 SSE 响应

预览事件：

```text
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","created_at":1784426400,"partial_image_index":0,"b64_json":"cGFydGlhbC1pbWFnZQ==","model":"gpt-image-2","output_format":"png","quality":"high","size":"1024x1024","background":"opaque"}

```

完成事件：

```text
event: image_generation.completed
data: {"type":"image_generation.completed","created_at":1784426412,"b64_json":"ZmluYWwtaW1hZ2U=","model":"gpt-image-2","output_format":"png","quality":"high","size":"1024x1024","background":"opaque","usage":{"input_tokens":46,"output_tokens":2459,"output_tokens_details":{"image_tokens":2459},"images":1}}

```

当 `response_format` 为 `url` 时，流式事件仍包含 `b64_json`，并额外包含 `url`：

```json
{
  "b64_json": "ZmluYWwtaW1hZ2U=",
  "url": "data:image/png;base64,ZmluYWwtaW1hZ2U="
}
```

### 4.3 图片生成 SSE 字段

| 字段 | partial | completed | 说明 |
|---|---|---|---|
| `type` | 是 | 是 | 事件类型 |
| `created_at` | 是 | 是 | Unix 秒级时间戳 |
| `partial_image_index` | 是 | 否 | 预览图片序号 |
| `b64_json` | 是 | 是 | Base64 图片内容 |
| `url` | 条件出现 | 条件出现 | `response_format=url` 时额外返回的 data URL |
| `model` | 否 | 否 | 可用时返回 |
| `output_format` | 否 | 否 | 可用时返回 |
| `quality` | 否 | 否 | 可用时返回 |
| `size` | 否 | 否 | 可用时返回 |
| `background` | 否 | 否 | 可用时返回 |
| `usage` | 否 | 否 | 通常只在完成事件中出现 |

流式完成事件当前不会输出 `revised_prompt`。

当 `n > 1` 时，OAuth 转换链路会针对每张最终图片各发出一个 `image_generation.completed` 事件。

## 5. 非流式图片编辑

### 5.1 multipart 文件上传请求

```bash
curl 'https://your-domain.example/v1/images/edits' \
  -H 'Authorization: Bearer sk-your-key' \
  -F 'model=gpt-image-2' \
  -F 'prompt=保留主体不变，将背景替换成夜晚的极光雪原' \
  -F 'image=@./source.png;type=image/png' \
  -F 'mask=@./mask.png;type=image/png' \
  -F 'n=1' \
  -F 'size=1024x1024' \
  -F 'quality=high' \
  -F 'input_fidelity=high' \
  -F 'background=opaque' \
  -F 'output_format=webp' \
  -F 'output_compression=90' \
  -F 'moderation=auto' \
  -F 'response_format=b64_json' \
  -F 'stream=false'
```

### 5.2 JSON 图片 URL 请求

```bash
curl 'https://your-domain.example/v1/images/edits' \
  -H 'Authorization: Bearer sk-your-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-image-2",
    "prompt": "保留主体不变，将背景替换成夜晚的极光雪原",
    "images": [
      {
        "image_url": "https://example.com/source.png"
      }
    ],
    "mask": {
      "image_url": "https://example.com/mask.png"
    },
    "n": 1,
    "size": "1024x1024",
    "quality": "high",
    "input_fidelity": "high",
    "background": "opaque",
    "output_format": "webp",
    "output_compression": 90,
    "response_format": "b64_json",
    "stream": false
  }'
```

### 5.3 响应

图片编辑的非流式响应结构与图片生成相同：

```json
{
  "created": 1784426500,
  "data": [
    {
      "b64_json": "UklGRiQAAABXRUJQVlA4...",
      "revised_prompt": "Keep the subject unchanged and replace the background with an aurora snowfield at night."
    }
  ],
  "background": "opaque",
  "output_format": "webp",
  "quality": "high",
  "size": "1024x1024",
  "model": "gpt-image-2",
  "usage": {
    "input_tokens": 128,
    "output_tokens": 2459,
    "output_tokens_details": {
      "image_tokens": 2459
    },
    "images": 1
  }
}
```

## 6. 流式图片编辑

### 6.1 JSON URL 请求

```bash
curl -N 'https://your-domain.example/v1/images/edits' \
  -H 'Authorization: Bearer sk-your-key' \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "model": "gpt-image-2",
    "prompt": "将背景替换成极光雪原，保持人物细节",
    "images": [
      {
        "image_url": "https://example.com/source.png"
      }
    ],
    "mask": {
      "image_url": "https://example.com/mask.png"
    },
    "size": "1024x1024",
    "quality": "high",
    "output_format": "webp",
    "response_format": "url",
    "partial_images": 2,
    "stream": true
  }'
```

multipart 流式编辑也受支持，只需在第 5.1 节的请求中将 `stream` 改为 `true`，并可增加 `partial_images`。

### 6.2 OAuth 标准化 SSE 响应

```text
event: image_edit.partial_image
data: {"type":"image_edit.partial_image","created_at":1784426500,"partial_image_index":0,"b64_json":"cGFydGlhbA==","url":"data:image/webp;base64,cGFydGlhbA==","model":"gpt-image-2","output_format":"webp","quality":"high","size":"1024x1024","background":"opaque"}

event: image_edit.completed
data: {"type":"image_edit.completed","created_at":1784426515,"b64_json":"ZWRpdGVk","url":"data:image/webp;base64,ZWRpdGVk","model":"gpt-image-2","output_format":"webp","quality":"high","size":"1024x1024","background":"opaque","usage":{"input_tokens":128,"output_tokens":2459,"output_tokens_details":{"image_tokens":2459},"images":1}}

```

图片编辑的流式字段与第 4.3 节相同，仅事件前缀从 `image_generation` 改为 `image_edit`。

## 7. API Key 与 OAuth 账号差异

Sub2API 会根据实际选中的上游账号类型走不同链路。

### 7.1 API Key 账号

- 请求发送到上游 `/v1/images/generations` 或 `/v1/images/edits`。
- 除模型映射或模型重写外，请求体基本原样透传。
- 非流式 JSON 响应基本原样透传。
- 流式 SSE 响应基本原样透传，事件名、字段和是否包含 `[DONE]` 由上游决定。
- 客户端不能假设所有 API Key 上游都会返回本文 OAuth 示例中的完整元数据。

### 7.2 OAuth 账号

- 项目内部将 Images 请求转换成 `/responses` 的 `image_generation` 工具调用。
- 项目再把上游 Responses 事件转换回 Images JSON 或 Images SSE。
- `response_format=url` 返回 `data:image/...;base64,...`，不是托管的公网图片链接。
- 非流式响应中，`url` 和 `b64_json` 二选一。
- 流式响应始终包含 `b64_json`；`response_format=url` 时再额外增加 `url`。
- 当前实现会解析 `input_fidelity`，但构建 OAuth 上游工具参数时不会写入该字段。因此必须保真编辑时，应确保路由到支持该参数的 API Key 账号，或先修正 OAuth 转换实现。
- OAuth 标准化流在完成事件发出后结束，不保证额外发送 `data: [DONE]`。

### 7.3 推荐的流式终止逻辑

客户端应同时支持以下终止条件：

1. 收到 `image_generation.completed` 或 `image_edit.completed`，并取得预期数量的最终图片。
2. 收到 `error` 事件。
3. 收到上游透传的 `data: [DONE]`。
4. HTTP 连接正常 EOF。

不要只依赖 `[DONE]`，否则 OAuth 标准化流可能无法正常结束客户端状态。

## 8. 错误响应

### 8.1 请求尚未进入 SSE 时

错误使用 OpenAI 风格 JSON：

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "n must be greater than 0"
  }
}
```

上游错误还可能包含：

```json
{
  "error": {
    "type": "image_generation_user_error",
    "code": "content_policy_violation",
    "param": "prompt",
    "message": "The request was rejected by the image service."
  }
}
```

常见 HTTP 状态包括：

| 状态码 | 常见原因 |
|---|---|
| `400` | JSON 无效、字段类型错误、缺少编辑图片、内容策略拒绝 |
| `401` | API Key 无效 |
| `403` | 分组未开启图片生成权限 |
| `413` | 请求体超过网关限制 |
| `429` | 并发限制、频率限制或上游限流 |
| `502` | 上游无有效图片输出或全部账号失败 |

### 8.2 SSE 已经开始后

错误以 SSE `error` 事件返回：

```text
event: error
data: {"type":"error","error":{"type":"upstream_error","message":"upstream request failed"}}

```

上游提供错误类型时，`error` 对象还可能包含 `code` 和 `param`。

## 9. 最小请求

最小图片生成请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "画一只猫"
}
```

最小 JSON 图片编辑请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "将背景改成白色",
  "images": [
    {
      "image_url": "https://example.com/source.png"
    }
  ]
}
```

最小 multipart 图片编辑请求：

```bash
curl 'https://your-domain.example/v1/images/edits' \
  -H 'Authorization: Bearer sk-your-key' \
  -F 'model=gpt-image-2' \
  -F 'prompt=将背景改成白色' \
  -F 'image=@./source.png'
```

## 10. 异步图片任务

项目还提供以下异步接口：

```text
POST /v1/images/generations/async
POST /v1/images/edits/async
GET  /v1/images/tasks/{task_id}
```

异步提交使用与同步接口相同的 JSON 或 multipart 请求体，但不允许 `stream: true`。异步能力默认关闭，并依赖对象存储配置。完整说明见 [ASYNC_IMAGE_TASKS.md](./ASYNC_IMAGE_TASKS.md)。

## 11. 实现位置

- 路由：`backend/internal/server/routes/gateway.go`
- 请求解析与 API Key 透传：`backend/internal/service/openai_images.go`
- OAuth 请求转换和响应转换：`backend/internal/service/openai_images_responses.go`
- 网关处理与权限、计费、并发、故障转移：`backend/internal/handler/openai_images.go`
