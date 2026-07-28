# Creem 支付接入实现验收报告

> 日期：2026-07-13
> 分支：`codex/creem-payment-integration`
> 技术方案：`docs/plans/2026-07-13-creem-payment-integration-design.md`

## 1. 需求分析

### 功能点

- Creem 仅支持 `onetime` Product，API Host 固定为官方测试/生产地址。
- 余额充值仅允许后台 Product 绑定产生的固定档位，禁止自定义金额。
- 普通套餐、全局套餐仅在绑定有效 Product 后可用；不支持全局套餐动态升级。
- 老后台支持 Creem Provider 配置和多个 Product 的绑定、启停、同步、删除。
- 新老用户前端支持 Creem 固定商品模式与其他动态金额渠道切换。
- `checkout.completed` 验签、金额/币种/Product/实例校验和权益发放复用统一订单链路。
- Creem 主动退款和用户自主退款永远不可开启，统一出站退款接口明确拒绝。
- 已验签的 `refund.created` 不受退款开关影响，支持部分/全额累计退款和权益回收。
- React 新前端 Stripe `client_secret` 自动进入 Payment Element 支付页。

### 风险点

- 外部退款必须幂等，并防止两个累计退款事件并发重复回收权益。
- Product、金额、币种和 Provider 实例必须由服务端快照校验，不能信任用户请求。
- Creem 官方 API 当前无已确认的出站退款接口，不能虚构主动退款能力。
- 存量 Go 大包和前端项目整体覆盖率低于严格验收技能的默认覆盖率门槛。

### 假设条件

- Product 已在对应 Creem test/prod 环境创建，状态为 `active`，计费类型为 `onetime`。
- 管理员从 Creem Dashboard 发起退款，Creem 发送 `refund.created`。
- Product 价格与绑定套餐按后台汇率换算后的价格一致。

## 2. 测试策略

- 单元测试：Provider 配置、Checkout/Product API、Webhook HMAC、事件映射、固定 Offer 防篡改、配置强制约束、快照校验、累计退款比例、幂等和事务回滚。
- 集成测试：真实 PostgreSQL/Redis、迁移约束、管理 API、Checkout Info、支付完成、部分/全额退款、并发退款、错误 Product 和出站退款拒绝。
- E2E：React/Vue 浏览器交互、Creem 固定档位、后台禁用退款控件、Product 行、Stripe 恢复页面。

| 需求点 | 单元 | 集成 | E2E |
|---|---:|---:|---:|
| onetime Product 与固定 Offer | 是 | 是 | 是 |
| 余额自定义金额禁用 | 是 | 是 | 是 |
| 套餐绑定约束 | 是 | 是 | 页面可用性 |
| 支付回调与权益发放 | 是 | 是 | 订单展示 |
| 部分/全额退款和权益回收 | 是 | 是 | 订单展示 |
| 退款开关强制关闭 | 是 | 是 | 是 |
| Stripe 新前端跳转 | 构建/类型 | 路由加载 | 恢复页 |

## 3. 实际执行记录

### 阶段 0：测试能力识别

- 后端：Go 原生测试、`unit`/`e2e` build tag、Go coverage、vet、golangci-lint。
- React：Vitest、TypeScript build、Vite production build、ESLint。
- Vue：Vitest、vue-tsc、Vite production build、ESLint、agent-browser。
- 依赖：Docker PostgreSQL `55432`、Redis `56379`、后端 `18080`、React `4173`、Vue `3001`。

### 阶段 1：测试设计

- 正常：固定余额 Offer、已绑定套餐、支付完成、50% 后累计 100% 退款。
- 边界：重复事件、两个退款并发、全额退款导致余额归零、订阅剩余天数不足时撤销。
- 异常：非 onetime/非 active Product、金额/套餐篡改、错误实例密钥、错误 Product、失败退款状态、Creem 出站退款。
- 故障注入：权益扣减后强制订单更新失败，验证事务回滚后余额不变。

### 阶段 2：单元测试验收

实际执行：

```bash
cd backend
go test -tags=unit ./... -coverprofile=/private/tmp/sub2api-creem-final-unit.cover
go tool cover -func=/private/tmp/sub2api-creem-final-unit.cover
go test ./...
go vet ./...
go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.9.0 run ./...
```

结果：所有 Go 测试包退出码 0；`go vet` 退出码 0；golangci-lint 输出 `0 issues`。

覆盖率来源：`go tool cover`。全仓 statements 26.6%，`internal/service` 59.7%，`internal/payment/provider` 56.6%，`internal/handler` 42.4%。这些是含大量存量代码的整体覆盖率，未达到默认 95% 门槛。

需求相关新增函数具有专项测试和真实 E2E，但文件级覆盖率也不统一达到 95%；例如 `NewCreem` 92.3%、`VerifyNotification` 75.0%、`HandleCreemRefundCreated` 70.0%、`applyCreemRefund` 62.0%。

### 阶段 3：集成测试验收

实际执行：

```bash
BASE_URL=http://localhost:18080 go test -tags=e2e ./internal/integration -v
```

该命令退出码 0；无 Claude/Gemini 外部密钥的网关用例明确跳过。用户注册路由在当前测试配置返回 404，相关通用用户流程跳过，不属于 Creem 需求链路。

真实 PostgreSQL + HTTP 验证结果：

- 两张迁移表和约束创建成功。
- Provider 创建/更新强制 `refund_enabled=false`、`allow_user_refund=false`、`supported_types=creem`，响应不泄露密钥。
- Checkout Info 不把 Creem 暴露为动态金额 method，只返回固定 `$20 -> 100 credits` Offer。
- 错误实例密钥验签失败；正确 `checkout.completed` 完成订单并发放余额。
- 错误 Product 的 `refund.created` 返回 500，事件记录为 failed，余额不变。
- 50% 退款、重复投递、累计 100% 退款均返回 200，最终订单 `REFUNDED`、退款额度 100、余额 0。
- 50% 与 100% 事件并发时，100% 事件 applied、旧 50% 事件 ignored，最终只回收一次完整权益。
- 故障注入证明订单更新失败时权益扣减随事务回滚。
- Creem 管理端主动退款返回 `CREEM_OUTBOUND_REFUND_UNSUPPORTED`。

### 阶段 4：E2E 测试验收

React：

- 28 个测试文件，109 个测试全部通过。
- TypeScript + Vite production build 通过；ESLint 通过。
- 浏览器切到 Creem 后仅显示 `$20 / 100 credits`，自定义金额输入消失。
- `/payment/stripe?order_id=missing` 正确显示恢复页；Stripe Payment Element 页面可加载，真实扣款未使用生产凭据执行。

Vue：

- 144 个测试文件，921 个测试全部通过。
- `vue-tsc --noEmit`、Vite production build、ESLint 全部通过。
- 用户充值页仅显示 `$20 +$100` 固定 Offer 和 Creem，无自定义金额输入。
- 老后台退款与用户退款开关关闭，Product 行显示 `prod_e2e / onetime / test / balance +100 / healthy`。

E2E coverage：当前浏览器工具链未配置运行时代码覆盖率，无法生成 E2E coverage 百分比。

## 4. 阶段结果

| 阶段 | 通过 | 失败 | 跳过 | 覆盖率/结论 |
|---|---:|---:|---:|---|
| Go 单元/全仓 | 全部测试包 | 0 | 无测试文件包 | 全仓 26.6%，未达默认 95% |
| React | 109 | 0 | 0 | 测试、lint、build 通过 |
| Vue | 921 | 0 | 0 | 测试、lint、typecheck、build 通过 |
| 通用 Go E2E | 可执行项通过 | 0 | 外部密钥/路由相关 | 退出码 0 |
| Creem HTTP E2E | 全部需求场景 | 0 | 0 | 支付、退款、并发、错误路径通过 |
| 浏览器 E2E | 全部需求页面 | 0 | 0 | 新老前端关键交互通过 |

## 5. 代码审查结论

审查发现并修复：

1. 退款权益扣减、订单快照和事件状态原先非原子，已改为同一事务并加 PostgreSQL 订单行锁。
2. 非成功退款和跨 Product 退款原先缺少完整拒绝，已增加状态和快照校验。
3. 多次部分退款审计 action 冲突，已改为每事件唯一 action。
4. Provider 创建/更新响应可能泄露密钥，已统一返回脱敏 DTO。
5. Product `enabled:false` 原先可能被 JSON `omitempty` 省略，已改为始终返回。

未发现未修复的 Critical 或 Important 级问题。

## 6. 未覆盖项与原因说明

- Creem 真实资金扣款：测试环境没有可使用的真实 Creem Product/API Key，使用官方结构的已验签 Webhook 和本地 HTTP E2E 替代。风险：中。
- Stripe 真实银行卡扣款：没有 Stripe 测试商户凭据；验证到 Payment Element 路由、上下文恢复、类型检查和构建。风险：中。
- 全仓 95% 单元覆盖率：仓库现有大型包整体覆盖率远低于该门槛，本次未通过无关测试堆叠追求数字。风险：低至中；建议后续按支付模块拆包并设置增量覆盖率门禁。
- E2E coverage 百分比：工具链未接入浏览器 coverage。风险：低。

## 7. 最终验收结论

**基本达到验收标准，但存在已记录风险。**

所有需求相关实现、代码审查修复、自动化测试、真实 PostgreSQL/HTTP E2E 和浏览器 E2E 均通过，可进入人工验收或提交评审。未达到的是严格验收技能的默认全仓覆盖率门槛，以及需要外部商户凭据的真实资金扣款；两项均已明确记录，未被误报为通过。
