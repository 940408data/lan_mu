# 域名与 HTTPS 部署

## 域名

| 域名 | 用途 |
|---|---|
| `lanmuy.com` | 主域名 |
| `www.lanmuy.com` | 别名，与主域名等价（Caddy 同一反代配置，共用证书） |

DNS A 记录指向服务器公网 IP：`111.229.37.224`（腾讯云）。

---

## 架构总览

```
                     公网                             宿主机                     Docker 容器
┌─────────┐     port 443      ┌──────────┐   port 8080   ┌──────────────┐
│ 访客浏览器 │ ────HTTPS────→  │  Caddy   │ ──reverse──→  │  nginx 站点   │
│          │                  │ (宿主机)  │    proxy      │  (容器内)     │
│          │ ←───HTTPS──────  │          │ ←───────────  │              │
└─────────┘                  └──────────┘               └──────────────┘
                                  ↑
                          Let's Encrypt 自动证书
```

### 各层职责

| 层 | 组件 | 监听端口 | 职责 |
|---|---|---|---|
| **入口** | Caddy（宿主机） | 80（HTTP→HTTPS 重定向）、443（HTTPS） | TLS 终止、反向代理、自动证书 |
| **站点** | nginx（Docker 容器） | 8080 | 托管静态文件，不感知 HTTPS |

---

## Caddy 配置

配置位于宿主机 `/etc/caddy/Caddyfile`：

```caddy
lanmuy.com, www.lanmuy.com {
    reverse_proxy localhost:8080
}
```

Caddy 自动完成：

1. **监听 80 端口**：收到 HTTP 请求，返回 308 重定向到 HTTPS 同路径
2. **监听 443 端口**：接收 HTTPS 请求，解密 TLS
3. **自动证书**：通过 Let's Encrypt 为 `lanmuy.com` 和 `www.lanmuy.com` 申请并自动续期 TLS 证书
4. **反向代理**：将解密后的 HTTP 请求转发到 `localhost:8080`（Docker nginx）

---

## Docker 端口映射

Docker 容器只暴露 8080 端口给宿主机回环地址，不对外暴露：

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

所有公网流量必须经过 Caddy 转发，不能直接访问容器。

---

## 证书管理

- 证书颁发机构：Let's Encrypt
- 自动续期：Caddy 在证书到期前 30 天自动续期，无需人工干预
- 证书存储：Caddy 内部管理，路径 `/var/lib/caddy/.local/share/caddy/`

---

## 安全组（腾讯云）

服务器位于腾讯云，需在**安全组**中放行以下入站规则：

| 协议 | 端口 | 来源 | 说明 |
|---|---|---|---|
| TCP | 80 | 0.0.0.0/0 | HTTP（Caddy 重定向用） |
| TCP | 443 | 0.0.0.0/0 | HTTPS（Caddy 服务用） |

> 8080 端口**不**在安全组放行，仅本地回环可达。

操作路径：腾讯云控制台 → 安全组 → 绑定实例的安全组 → 修改入站规则。

---

## 启动与维护

```bash
# Caddy 服务管理
sudo systemctl status caddy    # 查看状态
sudo systemctl restart caddy   # 重启
sudo systemctl enable caddy    # 开机自启（已启用）

# Docker 容器管理
docker compose up -d           # 启动/重启
docker compose logs            # 查看日志
```

---

## 常见问题

**Q：为什么不用 nginx 直接对外暴露 443？**

Caddy 自动处理 Let's Encrypt 证书申请和续期，零配置。nginx 做同样的事需要额外配置 `certbot` 和定时任务。

**Q：为什么 Docker 容器不直接监听 443？**

容器内 nginx 只做静态文件托管，不处理 TLS。将 TLS 终止放在宿主机 Caddy 上，Docker 重启或重建时不会中断证书状态。

**Q：https://lanmuy.com 和 https://www.lanmuy.com 一样吗？**

Caddy 配置中两者同时生效，自动共用同一份证书，行为一致。