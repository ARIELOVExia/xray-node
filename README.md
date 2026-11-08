# AOZUMI xray 部署包

状态：用户已于 2026-11-08 18:23 明确说“试 AOZUMI（ARIEL）”，正在执行。
仓库目标：`ARIEL/xray-node`（公开仓库，代码里无任何密钥）。

## 里面是什么

- `Dockerfile`：多阶段构建，从官方 `ghcr.io/xtls/xray-core` 镜像拷
  `/usr/local/bin/xray`（已核对官方 Dockerfile 原文确认该路径）到
  `node:20-alpine`，非 root 用户运行（AOZUMI 会标记以 root 运行的镜像）。
- `server.js` / `package.json`：启动包装。xray 二进制已由镜像带入，
  启动时不再下载；按环境变量生成配置，跑 VLESS+WS；监听平台给的
  `$PORT`，`/` 回 200（健康检查），WS 升级才转给 xray。
  没有任何密钥、UUID、订阅链接硬编码——UUID 和 WS 路径由 AOZUMI
  控制台的生产变量传入。
- 部署时在控制台设置：`XRAY_UUID`、`WS_PATH`；Sleep 设为 Stay warm — Never。

## AOZUMI 的已知条件（2026-11-08 查官方文档原文）

- Beta 免费；部署走 GitHub 仓库或 CLI artifact，不接受直接 push 镜像；
  仓库检查会识别 Dockerfile，以 root 运行的容器镜像会被标记送审。
- 明确支持 WebSocket；Sleep 模式可设 "Stay warm — Never"（关闲置休眠），
  对 VLESS+WS 的长连接很关键——部署时必须把 Sleep 设成 Stay warm。
- 平台设 `$PORT` 环境变量，服务必须监听它，不能写死端口。
- 条款 Acceptable Use（2026-10-09）里**没找到** proxy/VPN/tunnel 字样——
  这是“没找到禁令”，不是明确允许；Beta 无 SLA，随时可能改规则或停服。
- 用真实 GitHub ARIEL 会把身份和节点连起来，和 Ample 用真实邮箱是同样的取舍，
  用户已在 2026-11-08 09:05 自己注册好 GitHub（用户名 ARIEL）。

## 部署时待核实（部署后当场记进 PROXY_SCAN_LOG.md）

1. 仓库审核是否通过、要等多久。
2.  hosted 构建是否成功（本地无 Docker，镜像构建未在本地验证）。
3. 健康检查是否只认 `/` 的 200（本包装已回 200）。
4. Sleep 是否确实设为 Stay warm — Never 并生效。
5. 实测验收仍按 DEPLOY_MEMORY：第三方实测 generate_204 返回 204、
   出口 IP/城市与实测一致，才算通；用户真机测试为最终判定。

## 本地验证记录

- `node --check server.js` 通过（语法无误）。
- 未设 `XRAY_UUID` 时启动会明确报错退出（环境变量缺失保护生效）。
- Docker 本地不可用，镜像构建未在本地验证；部署时以 AOZUMI 的 hosted build 为准。
