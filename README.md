<p align="center">
<img src="https://i.imgur.com/cqkp6fG.png" width="500" alt="CloakBrowser">
</p>

<h3 align="center">CloakBrowser 的浏览器配置管理器</h3>

<p align="center">
自托管浏览器，用来管理不限数量的账号和配置。<br>
每个配置都是一台真正独立的机器：自己的指纹、显卡、代理、Cookie 和历史记录。<br>
底层是 CloakBrowser，能通过 Cloudflare Turnstile、reCAPTCHA v3、FingerprintJS 和 BrowserScan 的隐身引擎。<br>
这些身份不只是看起来不同，而是经得起检验。
</p>

<p align="center">
Multilogin、GoLogin、AdsPower 的自托管替代。<br>
免费起步，可同时运行一个浏览器；付费方案可以提高同时运行的数量。
</p>

<p align="center">
<a href="https://github.com/CloakHQ/CloakBrowser"><img src="https://img.shields.io/github/stars/cloakhq/cloakbrowser?label=CloakBrowser" alt="Stars"></a>
<a href="https://hub.docker.com/r/cloakhq/cloakbrowser-manager"><img src="https://img.shields.io/docker/pulls/cloakhq/cloakbrowser-manager?label=docker&logo=docker&logoColor=white" alt="Docker 拉取量"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="许可证"></a>
</p>

---

<p align="center">
<img src="https://raw.githubusercontent.com/CloakHQ/CloakBrowser-Manager/main/assets/manager-macos.png" width="800" alt="macOS 上的 CloakBrowser 管理器">
</p>

打开一个配置，得到的不是一个新标签页，而是另一台电脑：独立的浏览器指纹、显卡、屏幕、时区、代理、Cookie 和历史记录。配置之间互不串数据，账号不会彼此关联，也不会关联到你本人。关掉配置，第二天再打开，还是同一个人，状态还在，可以直接用。

Windows 和 macOS 会在系统原生窗口里直接打开浏览器；Linux 仍使用 Docker/KasmVNC 的服务端方式。

### Windows 和 macOS

从[最新发行版](https://github.com/CloakHQ/CloakBrowser-Manager/releases)下载安装包并运行：

- **macOS**：打开 `.dmg`，把 **CloakBrowser Manager** 拖进「应用程序」。早期版本未签名。第一次打开时，在终端执行 `xattr -rc "/Applications/CloakBrowser Manager.app"`，或在 **系统设置 → 隐私与安全性 → 仍要打开** 里允许（英文系统为 **System Settings → Privacy & Security → Open Anyway**）。
- **Windows**：运行安装用的 `.exe`。早期版本未签名。如果 SmartScreen 提示，点 **更多信息 → 仍要运行**（英文系统为 **More info → Run anyway**）。

不需要安装 Python、Node 或 git。管理器在 `127.0.0.1:8080` 启动，并用默认浏览器打开。第一次启动会下载 CloakBrowser 引擎。配置保存在 Windows 的 `%LOCALAPPDATA%\CloakBrowser Manager`，或 macOS 的 `~/Library/Application Support/CloakBrowser Manager`。该目录下的 `logs/manager.log` 记录运行情况，排查问题时用得上。

打开右上角齿轮图标的 **设置**，填入许可证密钥，并选择稳定版或预览版通道。

#### 从源码运行（开发者）

```bash
git clone https://github.com/CloakHQ/CloakBrowser-Manager.git
cd CloakBrowser-Manager
./run-macos.sh      # macOS（Windows 上运行 run-windows.bat）
```

这条路径需要 Python 3.10+ 和 Node 24.15+。第一次运行会创建本地 Python 环境、安装依赖，并构建 React 界面，然后启动管理器。

### Linux 服务器

```bash
docker run -p 127.0.0.1:8080:8080 -v cloakprofiles:/data cloakhq/cloakbrowser-manager
```

也可以从源码构建：

```bash
git clone https://github.com/CloakHQ/CloakBrowser-Manager.git
cd CloakBrowser-Manager
docker compose up --build
```

打开 [http://localhost:8080](http://localhost:8080)，新建一个配置，然后点「启动」。

> **早期测试版。** 项目仍在积极开发，可能会遇到问题。发现后请[提交 issue](https://github.com/CloakHQ/CloakBrowser-Manager/issues)，并附上日志。Windows/macOS 的日志是数据目录里的 `logs/manager.log`（`%LOCALAPPDATA%\CloakBrowser Manager` 或 `~/Library/Application Support/CloakBrowser Manager`）。Linux/Docker 使用 `docker logs <container>`。

## CloakBrowser 许可证密钥

管理器运行在 CloakBrowser 引擎上，因此需要一把密钥。<br>
[用邮箱领取免费密钥](https://cloakbrowser.dev/free)，可以在当前版本上一次运行一个配置。<br>
[付费方案](https://cloakbrowser.dev)提高同时运行的配置数量，从几个到几千个。

密钥只需添加一次，所有配置共用。

**原生应用（Windows/macOS）：** 打开右上角齿轮图标的 **设置**，粘贴密钥，选择稳定版或预览版通道，然后保存。立即生效，不用重启。顶栏徽章会显示当前方案和二进制版本。

**Docker：** 同样打开右上角齿轮图标的 **设置**，粘贴密钥并保存。立即生效，并保存在挂载的 `/data` 卷里，重启或更新镜像后仍然还在。自动化或无界面部署可以在 `docker run` 时传入：

```bash
docker run -p 127.0.0.1:8080:8080 -v cloakprofiles:/data \
  -e CLOAKBROWSER_LICENSE_KEY=cb_your_key_here \
  -e CLOAKBROWSER_RELEASE_CHANNEL=preview \
  cloakhq/cloakbrowser-manager
```

**从源码运行（或使用 `docker compose`）：** 写在管理器根目录的 `.env` 里：

```bash
cp .env.example .env
```

```bash
# .env
CLOAKBROWSER_LICENSE_KEY=cb_your_key_here
CLOAKBROWSER_RELEASE_CHANNEL=stable   # 或 preview
```

启动时会自动加载这个文件（`docker compose` 也会读取）。修改后需要重启管理器。环境变量会覆盖界面里的设置。

## 为什么不用云端指纹浏览器？

常见的指纹浏览器解决了指纹问题，又带来一个新问题：你的每个账号、每条 Cookie、每个会话都放在别人的服务器上。而且伪装越来越难通过真实检测：指纹伪造走捷径，显卡和 WebGL 数值对不上，测试页能过，真正的网站过不了。

CloakBrowser 管理器跑在你自己的机器上，每个配置都使用 CloakBrowser 引擎，身份经得起检验。

| | 典型的云端指纹浏览器 | **CloakBrowser 管理器** |
|---|---|---|
| 计费方式 | 按配置、按席位，并迫使升级套餐 | **按同时运行数计费，配置数量不限** |
| 配置存放位置 | 对方的云 | **你的机器** |
| 指纹实现 | 往原版浏览器注入 JavaScript | **在源码层用 C++ 改过的引擎** |
| 应用本身 | 封闭产品 | **开源界面（MIT）** |
| 系统原生窗口 | 少见 | **Windows + macOS** |
| 自动化接口 | 附加功能或更高套餐 | **每个配置都内置 CDP** |
| 闲置账号的成本 | 计入额度 | **不收费** |

## 功能

- **配置数量不限，不按个收费。** 想建多少身份都可以。只为同时运行的数量付费，不为保存的数量付费。休眠账号不产生费用。
- **每个配置都是一台不同的机器。** 独立的指纹种子、显卡系列、屏幕、Cookie、localStorage、缓存和历史记录，重启后仍然保留。
- **按配置设置网络和区域。** 每个配置有自己的代理、GeoIP、时区、语言区域和屏幕。时区和语言会自动跟随代理出口 IP。
- **按平台匹配硬件配置。** 自动选择 Apple Silicon，Windows 显卡系列可配置，同一配置内保持一致。
- **配置整理：** 创建、编辑、自动启动和删除配置。按标签或「无标签」筛选，并显示数量。选中多个标签时，只匹配同时带有这些标签的配置。可搜索名称、代理和备注。标签和备注一起显示在列表里。
- **可调侧栏宽度：** 设置 `SIDEBAR_WIDTH`，不用重新构建前端。见[运行时界面配置](#运行时界面配置)。
- **连同浏览器状态一起复制。** 可以只复制设置，也可以连同 Cookie、登录会话和存储一起复制。
- **配置文件：** 把文件交给某个配置。在 Linux 服务器上，还可以保留该浏览器下载的全部文件。
- **系统原生浏览：** Windows 和 macOS 的配置在普通桌面窗口中打开。
- **Linux 服务器查看：** 通过网页界面里的 KasmVNC 操作 Docker 启动的浏览器。
- **Playwright/Puppeteer 接口：** 通过 CDP 连接任何正在运行的配置，同时实时观看同一个会话。
- **拟人操作：** 可选的、更接近真人的鼠标、键盘和滚动。
- **兼容性控制：** 未打包扩展、第三方 Cookie，以及高级 Chromium 参数。
- **剪贴板同步：** 在管理器和 Linux VNC 浏览器配置之间复制粘贴。
- **许可证和系统状态：** 顶栏显示当前方案、二进制版本和 Windows 字体状况。
- **可选身份验证：** 用一个令牌保护网页界面和 API，也可以在本机不启用验证。
- **由 CloakBrowser 驱动。** 身份不只是看起来不同，而是经得起检验：在源码层用 C++ 改过的 Chromium 引擎，针对 Cloudflare Turnstile、reCAPTCHA v3、FingerprintJS 和 BrowserScan 做过测试。

## 技术栈

- **后端：** FastAPI（Python）
- **前端：** React + Tailwind CSS
- **浏览器画面：** Windows/macOS 使用原生窗口；Linux Docker 使用 noVNC/KasmVNC
- **数据库：** SQLite
- **浏览器引擎：** [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)（隐身 Chromium 二进制）

## 开发

### 原生后端

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8080
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

### Docker

```bash
docker compose up --build
```

## 环境要求

- Windows 或 macOS 原生：Python 3.10+、Node.js 24.15+
- Linux 服务器：Docker 20.10+
- 磁盘约 2 GB（应用 + 浏览器二进制）
- 每个正在运行的配置约 512 MB 内存

## 更新

### Windows 和 macOS

拉取最新源码，再运行对应平台的启动脚本。脚本会安装有变化的依赖，并自动重新构建界面。

```bash
git pull
```

```text
Windows: run-windows.bat
macOS:   ./run-macos.sh
```

### Linux 服务器

拉取最新镜像并重建容器：

```bash
docker pull cloakhq/cloakbrowser-manager
docker stop <container-id>
docker rm <container-id>
docker run -p 127.0.0.1:8080:8080 -v cloakprofiles:/data cloakhq/cloakbrowser-manager
```

更新后，配置和会话数据仍留在原生应用的数据目录，或 Docker 卷 `cloakprofiles` 里。

## 自动化接口

每个正在运行的配置都暴露一个 CDP（Chrome DevTools Protocol）端点。用 Playwright 或 Puppeteer 连接后，可以自动化操作，同时在浏览器里实时观看。

```python
from playwright.async_api import async_playwright

async with async_playwright() as pw:
    browser = await pw.chromium.connect_over_cdp(
        "http://localhost:8080/api/profiles/<profile-id>/cdp"
    )
    page = browser.contexts[0].pages[0]
    await page.goto("https://example.com")
```

```javascript
const { chromium } = require("playwright");

const browser = await chromium.connectOverCDP(
  "http://localhost:8080/api/profiles/<profile-id>/cdp"
);
const page = browser.contexts()[0].pages()[0];
await page.goto("https://example.com");
```

CDP 地址在正在运行的配置视图里可以复制。同一个浏览器会话，在 Windows/macOS 上可以通过原生窗口访问，在 Linux Docker 上可以通过 VNC 访问，在所有平台上也可以通过 API 以编程方式访问。

## 配置文件

配置可以和外部交换文件。这在 Docker 里最有用：浏览器看不到你的文件系统，要上传到网站的文件在来宾系统的文件对话框里找不到，浏览器下载的内容也会留在容器里。

```bash
# 把文件放到该配置的浏览器能用到的位置：请求体是文件，请求头是文件名
curl --data-binary @report.csv -H "X-File-Name: report.csv" http://localhost:8080/api/profiles/<id>/files

# 这个配置目前有哪些文件
curl http://localhost:8080/api/profiles/<id>/files

# 取回一个文件（浏览器下载的文件也可以这样取）
curl -OJ http://localhost:8080/api/profiles/<id>/files/<artifact-id>

curl -X DELETE http://localhost:8080/api/profiles/<id>/files/<artifact-id>
```

上传的请求体就是文件本身，不是表单。数据直接写入该配置的存储，磁盘上只留一份。超过大小的文件会在读取任何字节之前，根据 `Content-Length` 被拒绝。`X-File-Name` 需要 URL 编码（空格写成 `%20`），直接写 UTF-8 文件名也可以。存储类型优先使用请求里真实的 `Content-Type`，否则按文件名猜测。上传结果里的 `container_path` 就是需要路径的 CDP 调用（`DOM.setFileInputFiles`、`Input.dispatchDragEvent`）交给页面的那个路径。

Docker 构建的实时画面上有一个文件按钮：从自己的电脑上传、把文件直接拖到画面上，或把文件取回来。上传的文件也会出现在来宾系统自己的文件对话框里，位于侧栏的 **上传 — <配置名>**。网站的「选择文件」因此能选到它们。浏览器下载的文件会自动捕获，并出现在同一个列表里。

原生 macOS 和 Windows 构建里，浏览器本来就能访问你的文件系统，并写入你自己的「下载」文件夹，所以侧栏快捷方式和下载捕获都不适用。上面的接口仍然可用。

下载行为是整个浏览器共用的，后设置的会覆盖先设置的。连到该配置 CDP 的自动化客户端会接管它。例如 Playwright 的 `connect_over_cdp` 在初始化时会设置自己的下载目录，或者完全关闭下载。这类客户端连接期间，下载会去它指定的位置，不会进入该配置的文件列表。管理器看不到的传输不会记录，也不取消不属于自己的传输。这类客户端断开后，Chromium 回到自己的默认下载行为，而不是管理器的行为。代理的 CDP 连接一关闭，捕获就会重新启用。

文件放在配置旁边，不放在配置里面。复制配置的浏览器状态时不会复制这些文档。删除配置会删除它的文件。文件不会自己过期。下面的限制按配置计算。大于 `ARTIFACT_MAX_BYTES` 的文件会以 `413` 拒绝。会超出该配置文件数量或总大小的上传会以 `507` 拒绝。不会为了腾位置而删除已有文件。

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `ARTIFACT_MAX_BYTES` | `268435456`（256 MiB） | 单个文件的上限 |
| `ARTIFACT_MAX_COUNT` | `200` | 每个配置的文件数量 |
| `ARTIFACT_MAX_TOTAL_BYTES` | `2147483648`（2 GiB） | 每个配置的总大小 |

## 远程访问

容器只绑定本机。要从另一台机器访问：

```bash
ssh -L 8080:localhost:8080 your-server
```

然后打开 `http://localhost:8080`。

## 身份验证

默认没有身份验证，适合本机使用。如果要在网络上托管并保护网页界面和 API，设置环境变量 `AUTH_TOKEN`：

```bash
docker run -p 127.0.0.1:8080:8080 -v cloakprofiles:/data -e AUTH_TOKEN=your-secret-token cloakhq/cloakbrowser-manager
```

或写在 `docker-compose.yml` 里：

```yaml
environment:
  - AUTH_TOKEN=your-secret-token
```

设置 `AUTH_TOKEN` 之后：

- 网页界面会显示登录页。输入令牌后解锁。
- API 调用方在 `Authorization: Bearer <token>` 请求头里带上令牌。
- VNC WebSocket 通过登录 Cookie 验证。
- `/api/health` 仍然不需要验证，供 Docker 健康检查使用，且不暴露系统细节。`/api/status`（运行数量、版本）现在需要验证。

> **注意：** 验证令牌通过 HTTP 明文传输。如果把管理器暴露到公网，请放在带 HTTPS 的反向代理后面（Caddy、nginx、Traefik）。

## 运行时界面配置

配置侧栏默认宽度是 `16rem`。不想重新构建前端、只想把侧栏调宽或调窄时，把 `SIDEBAR_WIDTH` 设成一段 CSS 长度：

```bash
docker run -p 127.0.0.1:8080:8080 -v cloakprofiles:/data -e SIDEBAR_WIDTH=20rem cloakhq/cloakbrowser-manager
```

或写在 `docker-compose.yml` 里：

```yaml
environment:
  - SIDEBAR_WIDTH=20rem
```

支持的单位是 `px`、`rem`、`em` 和 `vw`。无效值会退回 `16rem`。

## 许可证

- **本应用**（界面源码）：MIT。见 [LICENSE](LICENSE)。
- **CloakBrowser 二进制**（编译后的 Chromium）：受对应版本的订阅条款约束，不得再分发。见 [BINARY-LICENSE.md](BINARY-LICENSE.md)。

界面程序必须配合 CloakBrowser Chromium 二进制才能工作。添加许可证密钥后会自动下载该二进制，并受它自己的许可条款约束。如果你分叉或再分发本应用，你的用户必须遵守 [CloakBrowser 二进制许可证](BINARY-LICENSE.md)。

## 参与贡献

欢迎贡献。请先[提交 issue](https://github.com/CloakHQ/CloakBrowser-Manager/issues)，说明你想改什么。

### 贡献者

- [lhq1363511234-arch](https://github.com/lhq1363511234-arch)：原生 Windows 支持的基础
- [quorentindupres-dev](https://github.com/quorentindupres-dev)：原生 macOS 工作流和管理器集成的思路
- [shellus](https://github.com/shellus)：需要验证的状态接口和无需验证的健康检查、离线启动 VNC、多标签筛选，以及可配置的侧栏宽度
- [hayka-pacha](https://github.com/hayka-pacha)：配置重置接口
- [theaafofficial](https://github.com/theaafofficial)：连同浏览器状态复制配置，以及带下载捕获的配置文件
- [qjebbs](https://github.com/qjebbs)：实时画面剪贴板与断连修复

## 链接

- **CloakBrowser：** [github.com/CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser)
- **网站：** [cloakbrowser.dev](https://cloakbrowser.dev)
- **问题反馈：** [GitHub Issues](https://github.com/CloakHQ/CloakBrowser-Manager/issues)
- **联系：** cloakhq@pm.me
