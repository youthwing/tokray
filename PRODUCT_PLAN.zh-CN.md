# Tokray 产品发展规划书

> 文档状态：执行中（M0 已完成，M1 维护，M2 聚焦单一闭环）
> 规划周期：未来 6-12 个月，按里程碑推进
> 产品属性：开源、厂商中立、Local-first、自托管优先
> 核心方向：从 Context Token X-ray 演进为 Agent Token 效率与上下文治理平台

> **当前范围锁定（2026-07-28）**：近期只完成一件事，即在一个本地 Codex 会话中跑通“发现高成本工具输出 -> 预览 Tokray Native 过滤 -> 用户批准并信任 `PostToolUse` Hook -> 用后续 Provider Usage 与任务质量信号验证 -> 可回滚”。Request Governor 保留为独立实验能力，不纳入 Codex 端到端闭环声明。该闭环完成前，新增 Agent 适配器、跨会话/团队能力、模型路由、工作流编排、自托管和 RTK 横向扩展全部冻结。

## 1. 执行摘要

Tokray 当前能够从本地 Agent 日志重建模型在每次调用中看到的上下文，分析 Token 构成、工具开销、缓存、Usage 和压缩结果。这个能力解决了“Token 花在哪里”，但用户最终需要解决的是：

- 哪些 Token 对任务结果没有贡献；
- 哪些内容应该按需加载、压缩、缓存或移出上下文；
- 哪些工作应该由脚本、CLI 或 API 完成，而不是继续调用模型；
- 一项优化到底节省了多少 Token，是否引入质量损失；
- 如何让同一套治理规则适用于 Claude Code、Codex、Cursor、Trae、CodeBuddy 等不同 Agent。

因此，Tokray 的下一阶段定位为：

> **Tokray 是开源、厂商中立的 Agent Token 效率与上下文治理平台。它帮助用户观察、诊断、治理、优化并验证每一段进入模型的上下文。**

产品不以“Token 越少越好”为目标，而以“在不降低任务完成质量的前提下，提高每个 Token 的有效信息密度”为目标。

整体演进路径：

```text
Monitor        Govern         Optimize        Orchestrate
实时观察   ->  策略治理   ->  模拟与验证   ->  Token 感知编排
发生了什么     哪里违规       怎么改更好       让确定性步骤退出模型
```

## 2. 产品使命与原则

### 2.1 产品使命

让个人开发者和团队能够跨 Agent、跨模型理解 Token 的真实流向，将有限的上下文预算用于最有价值的推理和决策。

### 2.2 核心原则

1. **证据优先**：每个结论必须能回到会话、调用、内容块、工具结果或 Usage 记录。
2. **质量优先于压缩率**：任何节省建议都要同时说明信息损失风险。
3. **能力驱动**：不同 Agent 能提供的数据和 Hook 能力不同，不能假装完全一致。
4. **默认只读**：初次使用只观察和建议；修改配置、安装 Hook、拦截输出必须明确授权。
5. **原始内容本地优先**：远程 Collector 默认只发送标准化指标和引用，不发送原始对话内容。
6. **厂商中立**：Agent 客户端和模型供应商使用两个独立维度建模。
7. **渐进增强**：没有精确 Usage、完整请求或运行时 Hook 时，仍能以明确置信度提供部分分析。
8. **可逆治理**：所有自动动作必须可预览、可回退，并保存执行记录。
9. **先验证再自动化**：先证明规则在真实会话上有效，再开放自动执行。

## 3. 产品边界

### 3.1 Tokray 要做什么

- Coding Agent 的实时 Token 和上下文监控；
- 跨 Agent 的统一上下文、Usage、工具和缓存模型；
- 基于证据的上下文问题检测和治理建议；
- Token 预算、规则、告警和团队策略；
- RTK 等压缩工具的集成、收益验证和 Agent Hook 配置；
- 删除、截断、摘要、缓存、工具裁剪和模型路由的模拟；
- 优化前后实验与质量回归检查；
- 面向 Token 效率的轻量工作流配方和运行器；
- Local-first、Collector + 自托管中心两种部署模式。

### 3.2 Tokray 暂时不做什么

- 不做另一个通用 n8n、Dify 或 LangGraph；
- 不替代模型网关、Prompt 管理平台或完整 LLM 可观测平台；
- 不承诺恢复日志中从未记录的隐藏上下文；
- 不直接声称“节省 60%-90% 总账单”；
- 不默认上传原始会话、代码、路径或工具结果；
- 不在缺少质量验证时自动删除用户上下文；
- 不在第一阶段建设复杂的可视化节点画布。

## 4. 目标用户与应用场景

### 4.1 个人开发者

- 实时观察 Claude Code、Codex、Cursor、Trae 等会话的 Token 增长；
- 找到过大的命令输出、文件读取和 MCP 返回；
- 判断是否应该开启 RTK、裁剪工具、拆分会话或触发压缩；
- 比较同一任务在不同 Agent 和模型上的效率。

### 4.2 Agent、Skill 和插件开发者

- 检查 System Prompt、Skill、工具 Schema 的常驻成本；
- 验证渐进式披露、工具白名单和上下文外化的效果；
- 对适配器、Hook 和治理规则进行样例日志测试；
- 发现日志格式漂移或 Usage 语义变化。

### 4.3 使用 Multi-Agent 的团队

- 按项目、角色、Wave、Agent 和模型汇总成本；
- 检测重复加载的需求、设计稿、Skill 和长期记忆；
- 判断拆分 Agent 的收益是否覆盖多份系统提示词开销；
- 为不同角色配置工具白名单、模型路由和 Token 预算；
- 生成可复现的优化前后报告。

### 4.4 平台与基础设施团队

- 自托管收集多台开发机的标准化指标；
- 设置组织级预算、规则和异常告警；
- 建立 Agent/模型/项目成本基线；
- 在不上传原始代码和对话的前提下治理 Token 使用。

## 5. 产品能力架构

### 5.1 观测层 Monitor

观测层回答“发生了什么”：

- 文件实时监听与增量解析；
- SSE 实时事件流；
- 当前上下文、单轮增量、缓存复用和输出 Usage；
- 内容块生命周期与驻留轮次；
- 工具定义、工具输入、工具结果和 MCP 活动；
- Compaction 前后 kept、summarized、truncated、dropped、unobserved；
- Agent、模型供应商、模型、项目和会话维度聚合；
- 解析异常、能力缺失和估算置信度。

### 5.2 诊断层 Diagnose

诊断层回答“哪里存在浪费或风险”：

- 单次过大工具输出；
- 长期驻留且后续未再引用的结果；
- 重复文件、文档、Skill 或工具结果；
- 空闲但常驻的工具 Schema；
- 低缓存命中率和前缀不稳定；
- 频繁 Compaction 或关键内容丢失；
- 不必要的串行工具调用候选；
- 模型能力与任务复杂度不匹配候选；
- Token 预算和成本阈值超限；
- 数据不足、日志漂移和不可信估算。

每条诊断输出统一为 `GovernanceFinding`：

```text
ruleId / scope / severity / confidence / evidenceRefs
currentCost / estimatedWaste / estimatedSaving
risk / recommendation / actionAvailability
```

### 5.3 治理层 Govern

治理层回答“应该遵守什么规则”：

- 全局、项目、Agent、模型和工作流多级策略；
- 单轮、单会话、每日和项目预算；
- 工具输出软上限与硬上限；
- 工具 Schema 数量或估算 Token 上限；
- 内容驻留轮次和重复度阈值；
- 缓存命中率与非缓存输入告警；
- Compaction 频率和关键块保护规则；
- 模型路由建议和允许列表；
- 原始内容采集、脱敏和保留周期策略。

策略支持四种运行级别：

```text
observe  仅记录
suggest  生成建议
approve  用户确认后执行
enforce  自动执行，限低风险且可回退动作
```

### 5.4 优化层 Optimize

优化层回答“改动后会怎样”：

- 删除或截断内容块的 Token 模拟；
- 工具结果摘要与原文对比；
- RTK 输出压缩预览；
- Prompt/Skill 渐进式披露建议；
- 工具白名单变化模拟；
- 缓存前缀重排建议；
- 模型替换的价格、上下文窗口和能力对比；
- 单 Agent 与 Multi-Agent 成本结构对比；
- 基线与候选方案的 A/B 实验；
- Token、费用、耗时和质量代理指标联合报告。

### 5.5 编排层 Orchestrate

编排层只处理 Token 效率相关的确定性工作流，不发展为通用低代码平台。

首批节点类型：

- `shell`：执行确定性 CLI；
- `http`：调用 API；
- `filter`：裁剪输入字段；
- `transform`：结构化清洗与格式转换；
- `retrieve`：按需检索文件或知识；
- `condition`：条件跳过；
- `parallel`：并行无依赖节点；
- `model`：只在需要语义判断时调用模型；
- `validate`：Schema、测试或规则校验；
- `output`：模板化输出和落盘。

工作流首先采用 YAML/JSON 配方和 CLI 运行器，证明场景价值后再考虑可视化编辑器。

## 6. Agent 与模型生态

### 6.1 两类身份必须分离

```text
Agent/Harness：Claude Code、Codex、Cursor、Trae、CodeBuddy、Cline
Model Provider：Anthropic、OpenAI、DeepSeek、豆包、通义千问、Gemini
```

一个 Agent 可以切换多个模型供应商；同一个模型也可能被多个 Agent 使用。筛选、报表和策略不能把两者混为一谈。

### 6.2 内置适配器规划

第一梯队：

- Claude Code；
- Codex；
- OpenAI/Anthropic 兼容请求捕获；
- Cursor；
- Cline / Roo Code；
- Continue；
- Windsurf；
- OpenCode；
- Aider；
- Gemini CLI；
- CodeBuddy；
- Trae。

第二梯队按日志和 Hook 可获得性推进：

- GitHub Copilot Chat / CLI；
- 通义灵码；
- MarsCode；
- CodeArts Snap；
- 百度 Comate；
- Kimi CLI；
- LangChain / LangGraph；
- LlamaIndex；
- Ollama 和其他 OpenAI-compatible 调用。

### 6.3 能力矩阵

每个 Agent 适配器必须声明：

```text
readLogs            是否可读取会话日志
exactUsage          是否有供应商精确 Usage
exactRequest        是否能看到完整请求体
compactionMarkers   是否有压缩边界
preToolHook         是否支持工具调用前 Hook
rewriteOutput       是否可修改工具输出
toolAllowlist       是否可配置工具白名单
modelRouting        是否可控制模型路由
compactionControl   是否可主动触发或配置压缩
```

UI 只展示适配器真实具备的动作。缺少能力时显示“仅建议”“不可观测”或“需要代理采集”。

### 6.4 自定义格式适配

提供两级扩展机制：

1. **JSON/YAML 声明式适配器**：面向 JSON、JSONL 和常见结构化日志，无需编写 TypeScript。
2. **TypeScript Adapter SDK**：处理 SQLite、多文件关联、流式事件、加密封装和复杂状态机。

声明式适配器包含：

- 文件路径和平台规则；
- 格式探测签名；
- JSON Pointer/JSONPath 字段映射；
- 记录类型判别；
- 消息、工具、模型和 Usage 映射；
- 缓存语义与 Compaction 标记；
- SourceRef 生成规则；
- 能力声明；
- 脱敏规则；
- 样例日志和期望事件测试。

## 7. 内置治理引擎与 RTK

### 7.1 产品关系

Tokray 需要同时承担发现、决策、原生治理和验证职责。内置引擎提供厂商中立、确定性、无需外部依赖的模型请求治理与工具输出过滤；RTK 继续作为可选外部 Provider，擅长在命令执行前重写其支持的 Shell 命令。两者可按 Agent 独立注册并共存。

内置引擎覆盖九个治理面：模型请求、工具输出、渐进式披露、上下文去重、工具 Schema 按需加载、记忆外化、稳定缓存前缀、Compaction 保护和确定性工作流外置。当前模型请求治理与工具输出过滤是可执行转换；上下文去重、Schema、记忆、缓存和 Compaction 先提供证据诊断；渐进式披露与工作流外置仍处于规划阶段。

模型请求治理直接接受 OpenAI、Anthropic 兼容请求体：保持 `system/messages/input` 不变，压缩工具描述，移除完全相同的重复定义，仅在用户显式提供 allowlist 时裁剪具名工具，并用估算输入预算返回 `sendAllowed`。它能生成可发送的候选请求，但在厂商 Hook 或请求代理未验证接入前，不宣称已自动控制 Claude Code、Codex 等 Agent。

### 7.2 集成闭环

```text
发现高成本请求或工具输出
-> 选择 Tokray Native 请求治理、输出过滤或 RTK Provider
-> 原始/治理后请求与输出预览
-> 估算信息损失与 Token 收益
-> 用户批准安装 Agent Hook
-> 采集 Provider 指标和后续 Usage
-> 验证真实节省
-> 保留、调整或回退策略
```

### 7.3 Tokray Native 与 RTK 的职责

- Tokray Native Request Governor 在模型调用前工作，输出完整治理后请求，并以 `sendAllowed` 执行估算输入预算门禁；
- Tokray Native 输出过滤在工具返回后工作，可覆盖非 Shell 工具输出，并以失败透传为默认边界；
- RTK 在命令执行前工作，通过官方二进制改写其支持的 Shell 命令；
- 使用实际 Tokenizer 或供应商 Usage 校正 `bytes / 4` 估算；
- 计算工具结果在后续调用中的累计驻留成本；
- 区分“命令输出减少”和“总输入/账单减少”；
- 检查压缩是否隐藏失败原因和关键标识符；
- 对比开启前后的任务成功、重试次数、耗时和模型调用数；
- 为 Claude Code、Codex、CodeBuddy、Trae 提供统一 Bridge 注册协议；
- 在多个 Agent 和项目间统一治理策略。

### 7.4 安全与回退

- 默认只建议，不自动安装 Hook；
- 原生过滤异常或 Bridge 未注册时原样透传；
- 命令失败时保留失败原因、退出码和诊断窗口；
- 支持项目级排除命令；
- 高风险命令只透传；
- 所有修改保存 diff 和回滚入口；
- 不把 Native 或 RTK 的输出缩减率直接当作账单节省率。
- 不把序列化请求体的估算缩减率当作供应商 tokenizer 或账单 Usage。

## 8. 部署与数据边界

### 8.1 本地模式

```bash
tokray web
```

- 文件发现、解析、规则执行和 Web UI 全部在本机；
- 默认监听当前用户的 Agent 日志；
- 无账号、无云端依赖；
- 适合个人开发和本地排查。

### 8.2 自托管模式

```bash
tokray serve
tokray agent --server https://tokray.example.internal
```

- `tokray agent` 在开发机读取日志并执行本地 Hook；
- `tokray serve` 聚合项目、成员、Agent 和模型指标；
- 默认只上传标准化事件、Token 数和不可逆哈希；
- 原始文本上传必须显式配置；
- 支持 Docker 和内网部署，不要求官方 SaaS。

### 8.3 数据模式

建议提供三档采集策略：

```text
metrics-only   只发送指标和类型
fingerprinted  发送内容哈希、长度和结构特征
full-content   发送脱敏后的原始内容，显式开启
```

## 9. Web UI 信息架构

### 9.1 一级导航

```text
实时监控 / 问题 / 会话 / 优化 / 策略 / 工作流 / 适配器 / 术语库
```

### 9.2 实时监控

- Live、Stale、Paused、Disconnected 状态；
- 最新活动倒序展示；
- 当前上下文、最近增量、缓存复用和问题数；
- Token 速率和单轮异常；
- 自动跟随最新调用；
- 会话对话正文仍按时间正序展示；
- 跳转到最新活动和问题证据。

### 9.3 问题中心

- 严重度、置信度、影响范围和预计浪费；
- 证据、建议、风险和适用能力；
- 预览、应用、忽略和创建例外；
- 应用后自动创建验证实验；
- 不使用无法解释的综合健康分。

### 9.4 会话导航与搜索

- 会话按最近活动排序并分组为 Active、Today、Earlier；
- 项目、Agent、模型、时间、问题和 Compaction 组合筛选；
- 虚拟列表或自动增量加载，不显示笨重分页；
- 统一搜索标题、路径、Session ID、Block ID、工具、调用序号和对话内容；
- 搜索结果包含类型、摘录、来源和直接定位入口。

### 9.5 术语库

按 Usage、上下文、缓存、证据、估算、Compaction、工具、策略和适配器分类。每个术语包含：

- 定义；
- 计算方式；
- 数据来源；
- 限制与置信度；
- 相关视图和示例。

## 10. 技术架构规划

### 10.1 保留的技术栈

- React 19；
- Vite；
- Hono；
- TanStack Query；
- ECharts；
- Lucide；
- pnpm workspace；
- TypeScript。

现阶段没有重写前端或服务端框架的收益，不进行全栈替换。

### 10.2 建议新增的基础设施

- `chokidar`：跨平台文件监听；
- Hono `streamSSE`：实时事件；
- `@tanstack/react-virtual`：大规模会话列表；
- JSON Schema 校验：声明式适配器与策略配置；
- 本地持久化抽象：策略、实验和索引，先保持文件存储，达到团队模式后引入 SQLite；
- Worker/任务队列：大日志解析、重建和批量对比；
- 内容脱敏管线：Collector 发送前执行。

### 10.3 建议新增的核心包

```text
@tokray/protocol     标准化事件和 Collector 协议
@tokray/policies     治理规则、预算和 Finding
@tokray/actions      RTK、Hook、配置修改等动作提供器
@tokray/experiments  基线、候选方案和收益验证
@tokray/workflows    Token-aware 配方与运行器
@tokray/config       声明式适配器和策略配置
```

### 10.4 领域对象演进

保留现有 `ContextFrame`、`ContextBlock`、`SourceRef`、`UsageSignal` 和 `CompactionEvent`，新增：

- `AgentEvent`：实时标准事件；
- `AgentCapabilities`：Agent 可观测和可控制能力；
- `GovernanceFinding`：带证据的治理问题；
- `PolicyDefinition`：策略定义与作用域；
- `ActionProposal`：可执行建议、风险和预览；
- `ActionReceipt`：执行记录和回滚信息；
- `OptimizationExperiment`：基线、候选方案和结果；
- `WorkflowRecipe` / `WorkflowRun`：工作流定义和运行记录。

## 11. 分阶段路线图

### 里程碑 M0：重新确立产品基础，1-2 周

目标：统一新定位和领域边界。

交付物：

- 更新 `PRODUCT.md`、README 和产品术语；
- 确定 `Monitor -> Govern -> Optimize -> Orchestrate` 信息架构；
- 定义 `AgentCapabilities`、`GovernanceFinding` 和策略协议；
- 区分 Agent 与 Model Provider；
- 建立适配器兼容性测试规范。

验收标准：

- 新功能都能归入明确产品层；
- 不再以“通用工作流平台”为目标；
- 每条治理建议都具有 Evidence 和 Confidence 字段。

### 里程碑 M1：实时监控与开放适配，3-5 周

目标：让用户在 Agent 工作时立即看到 Token 消耗和问题。

交付物：

- 文件 Watcher、SSE 和实时活动流；
- 专业会话导航、组合筛选和统一搜索；
- CodeBuddy、Trae 可观测性调研和首版适配器；
- Cursor、Cline/Roo、Continue 至少完成两个真实适配器；
- JSON/YAML 声明式适配器 MVP；
- 自定义路径和跨平台日志发现；
- 术语库首版。

验收标准：

- 新日志产生后 2 秒内进入 UI；
- 1 万条会话索引仍可流畅搜索和滚动；
- 自定义 JSONL 格式无需编写 TS 即可产生标准 Frame；
- 适配器明确展示缺失能力，不虚构数据。

当前进度（2026-07-28）：

- [x] 文件发现变更订阅、SSE `connected/heartbeat/sessions-changed` 和 60 秒断线轮询兜底；
- [x] 实时监控页：倒序活动流、自动跟随/暂停、当前上下文、本轮新增、缓存复用、累计输入和证据问题；
- [x] 专业会话索引：Agent 快速切换、标题/路径/Session ID 统一搜索、时间分组、虚拟滚动和 ID 复制；
- [x] JSONL 声明式适配器、RFC 6901 JSON Pointer 映射、自定义路径、全局/项目配置与结构化配置错误；
- [x] Cursor、Cline、Roo Code、Continue、Windsurf、Gemini CLI、CodeBuddy、Trae 来源巡检与真实读取边界；
- [x] CodeBuddy/Trae 可观测性调研；本机 Trae 核心存储为不透明数据，当前只展示检测结果并明确要求 Hook/请求采集器；
- [x] Agent 能力矩阵和中英文术语库首版；
- [ ] Cursor、Cline/Roo、Continue 中至少两个基于真实样本的解析适配器；
- [x] Tokray-managed CodeBuddy/Trae Hook Bridge 注册原型；它不等于已连接厂商原生 Hook，也不伪造不可读日志的“首版适配器”；
- [ ] YAML 配置入口、1 万会话压力基准与“2 秒内进入 UI”的自动化验收。

### 里程碑 M2：治理规则与 RTK 闭环，4-6 周

目标：从“看见问题”升级为“提供可执行治理”。

交付物：

- 治理问题中心；
- 首批规则包：大输出、长期驻留、重复内容、空闲工具、缓存异常、预算超限；
- 策略作用域和 `observe/suggest/approve/enforce` 模式；
- Tokray Native 请求治理与输出过滤，以及 RTK 检测、预览、配置和收益导入；
- Claude Code、CodeBuddy、Trae Hook Bridge 原型；
- 操作预览、Receipt 和回滚记录。

验收标准：

- 每个问题可以直接定位到证据；
- RTK 压缩前后输出可逐项比较；
- 能区分输出缩减率与实际输入 Token 节省；
- 默认状态下不自动修改任何 Agent 配置。

当前进度（2026-07-28）：

- [x] 会话治理区按“需要处理 / 优化机会 / 正常信号”分组，不使用不透明综合分；
- [x] `context.duplicate-content`：只检测同一 Frame 内同时存在、内容指纹一致且预计浪费不少于 1k Token 的可治理内容块，并保留全部 `SourceRef`；
- [x] `tool.loaded-never-called`：精确比较已加载与已调用工具集合，Schema Token 成本继续标记为 `prior`；
- [x] 大输出、长期驻留、缓存效率、上下文峰值、Compaction、校准和解析异常继续通过统一 `GovernanceFinding` 输出；
- [x] 厂商中立 `ActionProposal` 协议、执行位置、Agent 能力门槛和独立治理行动队列；当前只生成不会写文件或修改运行时的预览，并明确动作仅影响未来调用；
- [x] 可选 RTK Provider：跨平台发现并校验官方二进制，安全导入 `rtk gain --all --format json`，通过 `rtk rewrite` 只预览命令改写且不执行命令；UI 将 `bytes / 4` Bash 输出缩减与真实模型输入节省分开；
- [x] Tokray Native 输出治理：支持终端噪声清理、进度折叠、连续重复折叠、JSON 词法压缩、诊断窗口保留和低信号区段省略；暴露规则、风险、计量方法和适用范围，异常时原样透传；
- [x] Tokray Native 请求治理：支持 OpenAI/Anthropic 兼容请求体、工具描述压缩、完全重复定义去重、显式工具 allowlist、估算输入预算门禁和消息/工具契约完整性断言；CLI、Web API 与治理工作台共用同一实现；
- [x] 多治理面策略注册表：九个治理面分别标记 `available / diagnose / planned`，不把诊断或路线图伪装成已可执行能力；
- [ ] 可配置预算、规则参数与策略作用域；
- [ ] 跨会话治理问题聚合；
- [x] RTK 原始/压缩输出逐项比较：仅允许显式批准的低风险命令白名单，不经过 Shell，原命令与 RTK 命令各执行一次，并保存 `bytes / 4`、退出码、耗时、输出预览与 Receipt；
- [x] Tokray 管理的多 Provider Hook Bridge 原型：支持 Claude Code、Codex、CodeBuddy、Trae 分别注册 Tokray Native 与 RTK，提供 `tokray hook filter` / `tokray hook rewrite`、预览、显式写入、Receipt 和内容哈希保护回滚；不会修改 Agent 原生配置，也不把“已注册”说成“厂商 Hook 已连接”；
- [x] Codex `PostToolUse` 命令 Hook 调度适配：识别官方事件 JSON，对字符串及可证明为纯文本的 `output`、`text`、文本内容块返回 `continue:false` 替换反馈；未知结构化或二进制结果保持透传；
- [x] Codex 项目级 Hook 安装器：结构化合并 `.codex/hooks.json`，通过预览哈希显式批准，保存 Receipt 与回滚状态，并明确安装后仍需在 `/hooks` 中信任；
- [ ] 基于真实厂商 Hook 接口的 Claude Code 安装器，以及 CodeBuddy/Trae 原生 Hook 样本验证；
- [ ] 用后续 Provider Usage 和任务质量信号验证真实输入 Token 节省。

### 里程碑 M3：优化模拟与实验验证，4-6 周（M2 闭环前冻结）

目标：让优化建议具有可量化、可复现的结果。

交付物：

- 内容删除、截断、摘要和工具裁剪模拟；
- 缓存前缀稳定性分析；
- 模型定价与路由模拟；
- 基线/候选方案实验；
- Token、成本、耗时、重试和质量代理指标报告；
- Markdown、HTML、JSON 和脱敏报告导出。

验收标准：

- 优化建议显示预计收益区间和风险；
- 应用动作后自动生成真实对照；
- 预测与实际偏差可观测；
- 报告不把缺少质量数据的节省描述为“无损”。

### 里程碑 M4：Token-aware 工作流，6-10 周（M2 闭环前冻结）

目标：把重复的确定性步骤移出模型上下文。

交付物：

- YAML/JSON Workflow Recipe；
- CLI 运行器；
- shell/http/filter/transform/condition/parallel/model/validate/output 节点；
- 每节点 Token、成本和耗时预算；
- 从高成本 Trace 生成工作流建议；
- 失败恢复、产物落盘和结构化输出。

验收标准：

- 至少完成排障、巡检、测试或会议整理中的两个真实案例；
- 能证明确定性节点替代 LLM 带来的调用数和 Token 下降；
- 工作流失败不会丢失原始产物；
- 不依赖可视化画布即可完整定义和运行。

### 里程碑 M5：自托管与生态，持续推进（M2 闭环前冻结）

目标：支持团队治理和社区扩展。

交付物：

- `tokray agent` + `tokray serve`；
- Docker 镜像和多平台二进制；
- Homebrew、Scoop 等安装方式；
- Adapter/Policy/Action SDK；
- 适配器模板、样例测试和兼容性矩阵；
- 社区适配器目录；
- 项目级预算、团队策略和匿名聚合。

## 12. 发布版本建议

| 版本 | 对外主题 | 核心能力 |
| --- | --- | --- |
| `v0.2` | Monitor | 实时监控、专业会话导航、更多 Agent、声明式适配器 |
| `v0.3` | Govern | 问题中心、规则、预算、RTK 与 Hook 集成 |
| `v0.4` | Optimize | 模拟、实验、模型路由和收益验证 |
| `v0.5` | Orchestrate | Token-aware 工作流配方和运行器 |
| `v1.0` | Stable ContextOps | 稳定协议、自托管、跨平台分发和生态 SDK |

版本号以能力稳定性为准，不按日期强行发布。

## 13. 核心指标

### 13.1 产品价值指标

- 首次发现有效问题所需时间；
- 可定位到直接证据的问题比例；
- 建议被应用的比例；
- 应用后完成验证的比例；
- 非缓存输入 Token 的实际下降；
- 单任务模型调用数、耗时和费用变化；
- 优化后任务成功率和重试次数变化；
- 预测节省与实际节省的误差。

### 13.2 生态指标

- 内置 Agent 适配器数量；
- 社区适配器数量；
- 带完整能力声明的适配器比例；
- 格式漂移被测试捕获的比例；
- 声明式适配器成功覆盖的格式比例。

### 13.3 质量红线

- 不以单一“健康分”替代证据；
- 不把估算显示为精确值；
- 不把命令输出缩减率显示为账单节省率；
- 不因优化显著提高失败率或重试次数；
- 不在未授权时上传原始内容或修改 Agent 配置。

## 14. 开源与社区策略

- 核心协议、适配器 SDK、规则引擎和本地 UI 保持开源；
- 自托管不依赖官方云服务；
- 每个内置适配器提供匿名化样例和契约测试；
- 建立 `adapter-request` Issue 模板，自动附带脱敏结构信息；
- 社区适配器进入官方目录前必须声明数据来源、能力和限制；
- RTK 等第三方集成遵守原项目许可证并保持可选依赖；
- 不通过闭源协议锁死社区适配器；
- 产品 Roadmap 和兼容性状态公开维护。

## 15. 主要风险与应对

### 15.1 Agent 日志不可访问或字段不足

应对：同时提供日志读取、Hook、请求代理和声明式自定义格式；用能力矩阵明确真实边界。

### 15.2 压缩导致关键错误信息丢失

应对：默认预览；失败保留原始输出；关键标识符覆盖检查；提供命令级排除和一键回退。

### 15.3 建议看似节省但降低任务质量

应对：把实验验证作为产品主流程；同时观察成功率、重试、耗时和质量代理指标。

### 15.4 多 Agent 和模型路由建议过度简化

应对：先作为建议，不自动执行；明确拆分本身也会增加系统提示词和协调成本。

### 15.5 产品范围膨胀为通用平台

应对：所有新功能必须回答“是否直接改善上下文效率、Token 治理或验证闭环”。否则不进入核心产品。

### 15.6 本地隐私与远程团队模式冲突

应对：原始内容本地优先；提供三档采集；Collector 上传前脱敏；服务端不能远程读取任意本地文件。

### 15.7 原生依赖影响跨平台分发

应对：先保持当前 TypeScript 架构；引入 SQLite、Tokenizer 或 Rust 组件时同时评估预编译二进制和降级路径。

## 16. 决策检查清单

任何新功能进入开发前，需要回答：

1. 它属于 Monitor、Govern、Optimize 还是 Orchestrate？
2. 它依赖哪些日志字段或 Agent 能力？
3. 数据缺失时如何降级？
4. 结论能否直接定位到证据？
5. Token 数是精确、推算还是经验先验？
6. 动作是否可预览、可回退？
7. 如何验证优化没有降低任务质量？
8. 是否保持厂商中立和 Local-first？
9. 是否真的需要新增抽象或技术栈？
10. 是否正在滑向通用工作流平台？

## 17. 推荐的近期执行顺序

近期只按以下顺序推进；前一步没有形成可验证证据时，不开启下一条产品线：

1. [已完成] 从会话证据定位高成本工具结果，并生成确定性的 Tokray Native 过滤预览；
2. [已完成] 幂等安装项目级 Codex `PostToolUse` Hook，保留 Receipt 与受保护回滚，并通过 Codex `hooks/list` 区分未配置、待信任、已生效与已失效；
3. [已完成] 提供 `tokray hook status` 与 `tokray hook self-test`，用 0 次模型调用验证 Bridge、Hook、信任和确定性输出过滤链路；
4. [进行中] 在一个受控任务中记录治理前基线、治理后 Provider Usage、任务结果和必要的人工质量判断；首次 A/B 两组质量均通过，但治理组未触发 Hook，不能计为 Token 节省证据；
5. [待完成] 将真实对照结果展示为一次实验，明确区分输出缩减估算、实际输入 Token、耗时和质量；
6. [待完成] 验证回滚后关闭 M2；只有此时才重新评估 M3 或新增 Agent 适配器。

不进入当前排期：策略作用域、跨会话聚合、团队预算、更多厂商 Hook、模型路由、Workflow Recipe、Collector/Server、安装包分发，以及新的 RTK 能力。发现这些需求时只记录，不实现。

---

Tokray 的核心资产不是某一种日志解析器，也不是某一个压缩算法，而是跨 Agent 的上下文事实模型，以及从事实到治理动作再到真实验证的完整闭环。现有 X-ray 能力应继续作为产品地基；治理、优化和编排是在这套证据系统之上的逐层扩展。
